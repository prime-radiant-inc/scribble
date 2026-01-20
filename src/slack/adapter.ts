import { App, LogLevel } from '@slack/bolt';
import { WebClient } from '@slack/web-api';
import { Logger } from '../utils/logger.js';
import { SlackMessage, SlackFile } from '../core/types.js';
import { ChannelManager } from './channelManager.js';
import { SlackResponder } from './responder.js';
import { StateStore } from '../state/stateStore.js';
import { ScribbleOrchestrator } from '../core/orchestrator.js';
import * as fs from 'fs';
import * as path from 'path';

const logger = new Logger('SlackAdapter');

const SLACK_DM_PREFIX = 'D';

export interface SlackAdapterConfig {
  botToken: string;
  appToken: string;
  stateStore: StateStore;
  orchestrator: ScribbleOrchestrator;
  dataDir: string;
}

export class SlackAdapter {
  private app: App;
  private client: WebClient;
  private channelManager: ChannelManager;
  private stateStore: StateStore;
  private orchestrator: ScribbleOrchestrator;
  private dataDir: string;
  private botToken: string;

  constructor(config: SlackAdapterConfig) {
    this.stateStore = config.stateStore;
    this.orchestrator = config.orchestrator;
    this.dataDir = config.dataDir;
    this.botToken = config.botToken;

    this.app = new App({
      token: config.botToken,
      appToken: config.appToken,
      socketMode: true,
      logLevel: LogLevel.INFO,
    });

    this.client = this.app.client;
    this.channelManager = new ChannelManager(this.client, this.stateStore);

    this.setupListeners();
  }

  private setupListeners(): void {
    // Listen to ALL messages (not just DMs/@mentions)
    this.app.message(async ({ message }) => {
      // Type guard for message with user
      if (!('user' in message) || !('ts' in message)) return;
      if ((message as any).subtype) return; // Ignore edited, deleted, etc.
      if ((message as any).bot_id) return; // Ignore messages from bots/apps

      const userId = (message as any).user;
      const channelId = (message as any).channel;

      // Skip Slack Connect users
      if (await this.channelManager.isSlackConnectUser(userId)) {
        logger.debug('Skipping Slack Connect user', { userId });
        return;
      }

      // Skip bot's own messages
      if (userId === this.channelManager.userId) return;

      await this.handleMessage(message as any);
    });

    // Listen to @mentions (for interactive responses)
    this.app.event('app_mention', async ({ event }) => {
      await this.handleMention(event as any);
    });

    // Handle channel events
    this.app.event('member_joined_channel', async ({ event }) => {
      if ((event as any).user === this.channelManager.userId) {
        const info = await this.channelManager.getChannelInfo((event as any).channel);
        if (info) {
          await this.channelManager.handleChannelJoined((event as any).channel, info.name);
        }
      }
    });

    this.app.event('channel_left', async ({ event }) => {
      await this.channelManager.handleChannelLeft((event as any).channel);
    });
  }

  async start(): Promise<void> {
    // Initialize channel manager first
    await this.channelManager.initialize();

    // Set the bot user ID in the orchestrator now that we have it
    if (this.channelManager.userId) {
      this.orchestrator.setBotUserId(this.channelManager.userId);
    }

    // Start the Slack app
    await this.app.start();
    logger.info('Slack adapter started');

    // Auto-join all public channels
    await this.channelManager.autoJoinAllChannels();
  }

  async stop(): Promise<void> {
    await this.app.stop();
    logger.info('Slack adapter stopped');
  }

  /**
   * Handle any message (for logging and background mining)
   */
  private async handleMessage(event: {
    user: string;
    channel: string;
    ts: string;
    thread_ts?: string;
    text?: string;
    files?: any[];
  }): Promise<void> {
    const messageTs = event.ts;
    const channelId = event.channel;

    // Check deduplication
    if (this.stateStore.isMessageProcessed(messageTs)) {
      return;
    }

    // Mark as processed immediately
    this.stateStore.markMessageProcessed(messageTs, channelId);

    // Get user and channel info
    const userInfo = await this.channelManager.getUserInfo(event.user);
    const channelInfo = await this.channelManager.getChannelInfo(channelId);

    const isDm = channelId.startsWith(SLACK_DM_PREFIX);
    const text = event.text || '';

    // Check if bot is mentioned
    const isMention = this.channelManager.userId
      ? text.includes(`<@${this.channelManager.userId}>`)
      : false;

    // Build message object
    const message: SlackMessage = {
      channelId,
      channelName: channelInfo?.name || channelId,
      threadTs: event.thread_ts ?? null,
      messageTs,
      userId: event.user,
      userName: userInfo?.realName || event.user,
      text,
      files: event.files?.map(f => ({
        id: f.id,
        name: f.name,
        mimetype: f.mimetype,
        size: f.size,
        urlPrivate: f.url_private,
      })),
      isMention,
      isDm,
    };

    // Download any attachments
    if (message.files && message.files.length > 0) {
      await this.downloadAttachments(message);
    }

    // Create responder for potential response
    const responder = new SlackResponder(
      this.client,
      channelId,
      event.thread_ts ?? messageTs,
      messageTs
    );

    // Use the new unified pipeline - it handles logging, extraction, and response
    await this.orchestrator.processMessage(message, responder);
  }

  /**
   * Handle @mention events (explicit interaction)
   */
  private async handleMention(event: {
    user: string;
    channel: string;
    ts: string;
    thread_ts?: string;
    text?: string;
    files?: any[];
  }): Promise<void> {
    // The regular message handler will also see this message,
    // but we handle it here too in case it wasn't caught
    // (e.g., if the message handler didn't run yet)

    const messageTs = event.ts;
    const channelId = event.channel;

    // Check if already processed
    if (this.stateStore.isMessageProcessed(messageTs)) {
      return;
    }

    // Process as interactive message
    await this.handleMessage(event);
  }

  /**
   * Download file attachments
   */
  private async downloadAttachments(message: SlackMessage): Promise<void> {
    if (!message.files) return;

    const downloadDir = path.join(this.dataDir, 'downloads', message.channelId);
    if (!fs.existsSync(downloadDir)) {
      fs.mkdirSync(downloadDir, { recursive: true });
    }

    for (const file of message.files) {
      try {
        const timestamp = Date.now();
        const safeFilename = `${timestamp}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const downloadPath = path.join(downloadDir, safeFilename);

        const response = await fetch(file.urlPrivate, {
          headers: {
            Authorization: `Bearer ${this.botToken}`,
          },
        });

        const buffer = Buffer.from(await response.arrayBuffer());
        fs.writeFileSync(downloadPath, buffer);

        file.localPath = downloadPath;
        logger.debug('Downloaded file', { name: file.name, path: downloadPath });
      } catch (error) {
        logger.error('Failed to download file', { file: file.name, error });
      }
    }
  }
}
