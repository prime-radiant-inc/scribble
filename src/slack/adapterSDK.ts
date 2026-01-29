// src/slack/adapterSDK.ts
// SlackAdapter using bot-toolkit components and Agent SDK
// This wraps bot-toolkit's SlackAdapter implementation to work with Scribble's
// import structure (bot-toolkit instead of @primeradiant/bot-toolkit)

import * as fs from 'node:fs';
import type {
  Attachment,
  EngagementConfig,
  WakeupPayload,
  RoomInfo,
  IncomingMessage,
  PlatformResponder,
} from 'bot-toolkit';
import {
  AttentionTracker,
  BaseAdapter,
  type BaseAdapterConfig,
  getRoomDirectory,
  Logger,
  SessionDatabase,
} from 'bot-toolkit';
import { App, LogLevel } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import { SlackResponderSDK } from './responderSDK.js';

/** Slack channel ID prefixes */
const SLACK_DM_PREFIX = 'D'; // Direct messages

const logger = new Logger('SlackAdapterSDK');

/**
 * Generic orchestrator interface that both ConversationOrchestrator and ScribbleOrchestrator satisfy.
 * This allows Scribble to use its own orchestrator implementation.
 */
export interface MessageOrchestrator {
  handleMessage(message: IncomingMessage, responder: PlatformResponder): Promise<void>;
}

export interface SlackAdapterSDKConfig extends Omit<BaseAdapterConfig, 'orchestrator'> {
  orchestrator: MessageOrchestrator;
  botToken: string;
  appToken: string;
  /** Database for attention tracking (shared with session management) */
  database?: SessionDatabase;
  /** Engagement configuration for name mentions, active threads, etc. */
  engagement?: EngagementConfig;
}

export class SlackAdapterSDK extends BaseAdapter {
  readonly platform = 'slack' as const;
  private app: App;
  private client: WebClient;
  private botToken: string;
  private attentionTracker: AttentionTracker | null = null;
  private engagementConfig: EngagementConfig | undefined;

  constructor(config: SlackAdapterSDKConfig) {
    // Cast orchestrator to satisfy BaseAdapter's type requirement
    // Both ConversationOrchestrator and ScribbleOrchestrator implement handleMessage
    super(config as unknown as BaseAdapterConfig);
    this.botToken = config.botToken;
    this.engagementConfig = config.engagement;

    // Initialize attention tracker if engagement config and database provided
    if (config.engagement && config.database) {
      this.attentionTracker = new AttentionTracker(
        config.database.db,
        config.engagement
      );
    }

    this.app = new App({
      token: config.botToken,
      appToken: config.appToken,
      socketMode: true,
      logLevel: LogLevel.INFO,
    });

    this.client = this.app.client;

    this.setupListeners();
  }

  private setupListeners(): void {
    // Listen to ALL messages - engagement decision happens in Claude via constitution
    this.app.message(async ({ message }) => {
      if (!('user' in message) || !('ts' in message)) return;
      // biome-ignore lint/suspicious/noExplicitAny: Slack SDK types don't expose subtype
      if ((message as any).subtype) return;

      // biome-ignore lint/suspicious/noExplicitAny: Slack SDK types don't expose channel_type
      const channelType = (message as any).channel_type;
      const isDm = channelType === 'im';

      // biome-ignore lint/suspicious/noExplicitAny: Slack SDK event types don't match our handler signature
      await this.handleMessageWithEngagement(message as any, isDm, false);
    });

    // Also listen to @mentions
    this.app.event('app_mention', async ({ event }) => {
      // biome-ignore lint/suspicious/noExplicitAny: Slack SDK event types don't match our handler signature
      await this.handleMessageWithEngagement(event as any, false, true);
    });
  }

  async start(): Promise<void> {
    await this.app.start();
    logger.info('Slack adapter started', {
      hasEngagement: !!this.engagementConfig,
    });
  }

  async stop(): Promise<void> {
    await this.app.stop();
    logger.info('Slack adapter stopped');
  }

  /**
   * Get detailed room info for a Slack channel, including user display name for DMs.
   */
  private async getRoomInfo(
    channelId: string,
    senderId?: string
  ): Promise<RoomInfo> {
    const isDm = channelId.startsWith(SLACK_DM_PREFIX);
    let channelName = channelId;
    let userDisplayName: string | undefined;

    try {
      const info = await this.client.conversations.info({ channel: channelId });
      // biome-ignore lint/suspicious/noExplicitAny: Slack SDK Channel type doesn't expose name property
      channelName = (info.channel as any)?.name || channelId;
    } catch {
      // Use ID if we can't get name
    }

    // For DMs, try to get the user's display name
    if (isDm && senderId) {
      try {
        const userInfo = await this.client.users.info({ user: senderId });
        // biome-ignore lint/suspicious/noExplicitAny: Slack SDK User type doesn't expose these properties
        const user = userInfo.user as any;
        userDisplayName =
          user?.real_name || user?.profile?.display_name || user?.name;
      } catch {
        // Use sender ID if we can't get name
        userDisplayName = senderId;
      }
    }

    return {
      platform: 'slack',
      channelId,
      channelName,
      channelType: isDm ? 'dm' : 'channel',
      userDisplayName,
    };
  }

  async handleWakeup(channelId: string, payload: WakeupPayload): Promise<void> {
    const roomInfo = await this.getRoomInfo(channelId);
    const roomDir = getRoomDirectory(
      this.dataDir,
      channelId,
      'slack',
      roomInfo
    );

    const message = this.buildIncomingMessage({
      channelId,
      channelName: roomInfo.channelName,
      threadId: payload.thread_id ?? null,
      messageId: `wakeup-${payload.idempotency_key}`,
      senderId: 'system',
      text: payload.prompt,
      attachments: [],
    });

    const threadTs = payload.thread_id ?? message.messageId;
    const responder = new SlackResponderSDK(
      this.client,
      channelId,
      threadTs,
      message.messageId,
    );

    // Engage with thread if tracking is enabled
    if (this.attentionTracker && payload.thread_id) {
      this.attentionTracker.engage(payload.thread_id, channelId);
    }

    await this.orchestrator.handleMessage(message, responder);
  }

  protected async sendUnauthorizedResponse(
    channelId: string,
    messageId: string,
    threadId: string | null
  ): Promise<void> {
    await this.client.chat.postMessage({
      channel: channelId,
      thread_ts: threadId ?? messageId,
      text: 'This bot is restricted to authorized users only.',
    });
  }

  /**
   * Handle all messages - engagement decision happens in Claude
   */
  private async handleMessageWithEngagement(
    event: {
      user: string;
      channel: string;
      ts: string;
      thread_ts?: string;
      text?: string;
      // biome-ignore lint/suspicious/noExplicitAny: Slack SDK file type is complex and varies
      files?: any[];
    },
    isDm: boolean,
    isMention: boolean
  ): Promise<void> {
    const channelId = event.channel;
    const messageTs = event.ts;
    const threadId = event.thread_ts ?? null;
    const text = event.text || '';

    // Keep dismissal handling for immediate UX feedback
    if (this.attentionTracker && threadId) {
      const effectiveThreadId = threadId ?? messageTs;
      if (this.attentionTracker.isDismissal(text)) {
        logger.info('Dismissal detected, disengaging', { channelId, threadId: effectiveThreadId });
        this.attentionTracker.disengage(effectiveThreadId);
        // Still don't respond to dismissals
        return;
      }
    }

    // Forward all messages to orchestrator
    await this.handleMessage(event);
  }

  /**
   * Standard message handling (authorization, build message, send to orchestrator)
   */
  private async handleMessage(event: {
    user: string;
    channel: string;
    ts: string;
    thread_ts?: string;
    text?: string;
    // biome-ignore lint/suspicious/noExplicitAny: Slack SDK file type is complex and varies
    files?: any[];
  }): Promise<void> {
    const sender = event.user;
    const channelId = event.channel;
    const messageTs = event.ts;

    // Authorization check
    const authorized = await this.checkAuthorizationAndRespond(
      sender,
      channelId,
      messageTs,
      event.thread_ts ?? null
    );
    if (!authorized) {
      return;
    }

    // Get channel/room info including user display name for DMs
    const roomInfo = await this.getRoomInfo(channelId, sender);
    const threadTs = event.thread_ts ?? messageTs;
    const roomDir = getRoomDirectory(this.dataDir, channelId, 'slack', roomInfo);

    const message = this.buildIncomingMessage({
      channelId,
      channelName: roomInfo.channelName,
      threadId: event.thread_ts ?? null,
      messageId: messageTs,
      senderId: sender,
      text: event.text || '',
      attachments: await this.downloadAttachments(event.files, roomDir),
    });

    const responder = new SlackResponderSDK(
      this.client,
      channelId,
      threadTs,
      messageTs,
    );

    await this.orchestrator.handleMessage(message, responder);

    // Update activity after successful response
    if (this.attentionTracker) {
      const effectiveThreadId = event.thread_ts ?? messageTs;
      this.attentionTracker.updateActivity(effectiveThreadId);
    }
  }

  private async downloadAttachments(
    // biome-ignore lint/suspicious/noExplicitAny: Slack SDK file type is complex and varies
    files: any[] | undefined,
    roomDir: string
  ): Promise<Attachment[]> {
    if (!files || files.length === 0) return [];

    const attachments: Attachment[] = [];

    for (const file of files) {
      const attachment = await this.downloadAttachment(
        file.url_private,
        file.name,
        roomDir,
        file.size,
        file.mimetype,
        async (url, savePath) => {
          const response = await fetch(url, {
            headers: { Authorization: `Bearer ${this.botToken}` },
          });
          const buffer = Buffer.from(await response.arrayBuffer());
          fs.writeFileSync(savePath, buffer);
        }
      );

      if (attachment) {
        attachments.push(attachment);
      }
    }

    return attachments;
  }

  /**
   * Clean up timed-out threads (call periodically)
   */
  cleanupTimedOutThreads(): number {
    if (!this.attentionTracker) return 0;
    return this.attentionTracker.cleanupTimedOutThreads();
  }
}
