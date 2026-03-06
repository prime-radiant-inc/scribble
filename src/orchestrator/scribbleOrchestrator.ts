// scribble/src/orchestrator/scribbleOrchestrator.ts
import type { SessionDatabase, MainSessionRecord, ThreadSessionRecord } from 'bot-toolkit';
import type { ClaudeSessionManagerSDK } from 'bot-toolkit';
import type { IncomingMessage, PlatformResponder, SessionCallbacks } from 'bot-toolkit';
import { Logger } from 'bot-toolkit';
import type { WebClient } from '@slack/web-api';
import type { ConversationLogger } from '../logging/conversationLogger.js';
import type { ConstitutionManager } from '../constitution/manager.js';
import { CrossChannelContext } from '../context/crossChannelContext.js';
import { parseRespondToolInput, parseDecisionLogInput, parseSlackReplyInput } from '../core/responseSchema.js';
import type { EngagementResponse, DecisionLogInput, SlackReplyInput } from '../core/responseSchema.js';
import type { SlackMessage } from '../core/types.js';

const logger = new Logger('ScribbleOrchestrator');

// Tools that mutate state — only these warrant a checkmark reaction
const WRITE_TOOLS = new Set([
  'wiki_create',
  'wiki_edit',
  'wiki_delete',
  'wiki_rename',
  'learn_behavior',
  'set_channel_instruction',
  'linear_confirm',
  'log_decision',
  'slack_reply',
]);

export interface ScribbleOrchestratorConfig {
  database: SessionDatabase;
  sessionManager: ClaudeSessionManagerSDK;
  conversationLogger: ConversationLogger;
  constitutionManager: ConstitutionManager;
  dataDir: string;
  slackClient: WebClient;
}

interface EngagementTracker {
  callbacks: SessionCallbacks;
  getResponses: () => EngagementResponse[];
  getDecisions: () => DecisionLogInput[];
  getSlackReplies: () => SlackReplyInput[];
  getToolsUsed: () => string[];
  hadFreeformText: () => boolean;
}

export class ScribbleOrchestrator {
  private database: SessionDatabase;
  private sessionManager: ClaudeSessionManagerSDK;
  private conversationLogger: ConversationLogger;
  private constitutionManager: ConstitutionManager;
  private dataDir: string;
  private slackClient: WebClient;
  private crossChannelContext: CrossChannelContext;
  private decisionLogChannelId: string | null | undefined; // undefined = not resolved yet
  private userNameCache = new Map<string, string>();

  constructor(config: ScribbleOrchestratorConfig) {
    this.database = config.database;
    this.sessionManager = config.sessionManager;
    this.conversationLogger = config.conversationLogger;
    this.constitutionManager = config.constitutionManager;
    this.dataDir = config.dataDir;
    this.slackClient = config.slackClient;
    this.crossChannelContext = new CrossChannelContext(
      config.conversationLogger,
      config.slackClient,
      config.dataDir
    );
  }

  async handleMessage(
    message: IncomingMessage,
    responder: PlatformResponder
  ): Promise<void> {
    // Deduplication
    if (this.database.isEventProcessed(message.messageId)) {
      logger.debug('Skipping already processed message', { messageId: message.messageId });
      return;
    }
    this.database.markEventProcessed(message.messageId, message.channelId);

    // Log the message
    await this.conversationLogger.logChannelMessage(
      this.toSlackMessage(message)
    );

    // Route based on thread vs channel
    if (message.threadId) {
      await this.handleThreadMessage(message, responder);
    } else {
      await this.handleChannelMessage(message, responder);
    }
  }

  private async handleChannelMessage(
    message: IncomingMessage,
    responder: PlatformResponder
  ): Promise<void> {
    try {
      // Get or create main session
      const mainSession = this.database.getMainSession(message.channelId);
      const resumeSession = mainSession
        ? { sessionId: mainSession.session_id, compactionCount: mainSession.compaction_count }
        : undefined;

      // Build system prompt with constitution
      const constitution = this.constitutionManager.getFullConstitution();
      const channelInstructions = this.constitutionManager.getInstructionsForChannel({ channelId: message.channelId, channelName: message.channelName });

      // Gather cross-channel context
      const crossChannelContextStr = await this.crossChannelContext.gather({
        excludeChannelId: message.channelId,
        excludeThreadTs: message.threadId ?? undefined,
        windowHours: 24,
        maxPerThread: 10,
      });

      // Append all context to system prompt
      const systemPromptAppend = constitution + channelInstructions + '\n\n' + crossChannelContextStr;

      // Use engagement callbacks to capture respond tool calls
      const tracker = this.createEngagementCallbacks();

      // Send to Claude - no outputFormat, engagement is via respond tool
      const result = await this.sessionManager.sendMessage(
        message.channelId,
        await this.buildMessageText(message),
        message.platform,
        message.channelName,
        tracker.callbacks,
        resumeSession,
        {
          systemPrompt: { type: 'preset', preset: 'claude_code', append: systemPromptAppend },
        }
      );

      // Save main session
      if (result.sessionId) {
        this.database.saveMainSession(message.channelId, {
          sessionId: result.sessionId,
          contextTokens: result.stats.contextTokens,
          compactionCount: result.stats.compactionCount,
        });
      }

      // Process engagement from respond tool calls (with retry if needed)
      const responses = await this.processEngagement(
        tracker,
        result.sessionId,
        message,
        resumeSession,
        systemPromptAppend,
      );

      // Post any decisions to #decision-log
      await this.postDecisions(tracker.getDecisions(), message);
      await this.postSlackReplies(tracker.getSlackReplies());

      // Find the first respond(true) with a message
      const positiveResponse = responses.find(r => r.shouldRespond && r.message);

      // Log engagement decision
      logger.info('Engagement decision', {
        channelId: message.channelId,
        respondCalls: responses.length,
        shouldRespond: !!positiveResponse,
        reason: responses[0]?.reason,
        hasMessage: !!positiveResponse?.message,
      });

      if (positiveResponse) {
        await responder.markProcessing();
        await this.forkAndRespond(message, responder, result.sessionId!, positiveResponse.message!);
        await responder.clearProcessing();
      }

      await responder.updateChannelStats(result.stats);
    } catch (error) {
      logger.error('Error handling channel message', { error, messageId: message.messageId });
      await responder.markError();
    }
  }

  private async handleThreadMessage(
    message: IncomingMessage,
    responder: PlatformResponder
  ): Promise<void> {
    try {
      const threadId = message.threadId!;

      // Check for existing thread session - if we have one, we're already engaged
      const threadSession = this.database.getThreadSession(threadId);

      if (threadSession) {
        await this.handleEngagedThreadMessage(message, responder, threadSession);
      } else {
        await this.handleNewThreadMessage(message, responder);
      }
    } catch (error) {
      logger.error('Error handling thread message', { error, messageId: message.messageId });
      await responder.markError();
    }
  }

  /**
   * Handle a message in a thread we're already engaged in.
   * Claude decides whether to respond verbally, take action silently, or stay quiet.
   */
  private async handleEngagedThreadMessage(
    message: IncomingMessage,
    responder: PlatformResponder,
    threadSession: { session_id: string; compaction_count: number }
  ): Promise<void> {
    const threadId = message.threadId!;

    const resumeSession = {
      sessionId: threadSession.session_id,
      compactionCount: threadSession.compaction_count,
    };

    // Build system prompt
    const constitution = this.constitutionManager.getFullConstitution();
    const channelInstructions = this.constitutionManager.getInstructionsForChannel({ channelId: message.channelId, channelName: message.channelName });

    // Gather cross-channel context
    const crossChannelContextStr = await this.crossChannelContext.gather({
      excludeChannelId: message.channelId,
      excludeThreadTs: threadId,
      windowHours: 24,
      maxPerThread: 10,
    });

    // Append all context to system prompt
    const systemPromptAppend = constitution + channelInstructions + '\n\n' + crossChannelContextStr;

    // Use engagement callbacks to capture respond tool calls and other tool usage
    const tracker = this.createEngagementCallbacks();

    // Send to Claude - no outputFormat
    const result = await this.sessionManager.sendMessage(
      message.channelId,
      await this.buildMessageText(message),
      message.platform,
      message.channelName,
      tracker.callbacks,
      resumeSession,
      {
        systemPrompt: { type: 'preset', preset: 'claude_code', append: systemPromptAppend },
      }
    );

    // Update thread session
    if (result.sessionId) {
      this.database.saveThreadSession(threadId, {
        channelId: message.channelId,
        sessionId: result.sessionId,
        forkedFromSessionId: threadSession.session_id,
        contextTokens: result.stats.contextTokens,
        compactionCount: result.stats.compactionCount,
      });
    }

    // Process engagement from respond tool calls (with retry if needed)
    const responses = await this.processEngagement(
      tracker,
      result.sessionId,
      message,
      resumeSession,
      systemPromptAppend,
    );

    // Post any decisions to #decision-log
    await this.postDecisions(tracker.getDecisions(), message);
    await this.postSlackReplies(tracker.getSlackReplies());

    const toolsUsed = tracker.getToolsUsed();
    const positiveResponses = responses.filter(r => r.shouldRespond && r.message);

    // Log engagement decision
    logger.info('Engaged thread decision', {
      channelId: message.channelId,
      threadId,
      respondCalls: responses.length,
      positiveResponses: positiveResponses.length,
      reason: responses[0]?.reason,
      toolsUsed: toolsUsed.length > 0 ? toolsUsed : undefined,
    });

    if (positiveResponses.length > 0) {
      // Send each positive response as a separate message
      await responder.markProcessing();
      for (const response of positiveResponses) {
        await responder.updateResponse(response.message!);
        await responder.finalizeResponse();
      }
      await responder.clearProcessing();
    } else if (toolsUsed.some(t => WRITE_TOOLS.has(t))) {
      // Write tools were used but no verbal response - add a checkmark
      await this.addReactionIfSupported(responder, 'white_check_mark');
    }
    // Otherwise stay silent

    await responder.updateChannelStats(result.stats);
  }

  /**
   * Handle a message in a thread we're NOT yet engaged in.
   * Check if we should engage before responding.
   */
  private async handleNewThreadMessage(
    message: IncomingMessage,
    responder: PlatformResponder
  ): Promise<void> {
    const threadId = message.threadId!;

    // Get main session to check engagement decision
    const mainSession = this.database.getMainSession(message.channelId);
    const resumeSession = mainSession
      ? { sessionId: mainSession.session_id, compactionCount: mainSession.compaction_count }
      : undefined;

    // Build system prompt with constitution
    const constitution = this.constitutionManager.getFullConstitution();
    const channelInstructions = this.constitutionManager.getInstructionsForChannel({ channelId: message.channelId, channelName: message.channelName });

    // Gather cross-channel context
    const crossChannelContextStr = await this.crossChannelContext.gather({
      excludeChannelId: message.channelId,
      excludeThreadTs: threadId,
      windowHours: 24,
      maxPerThread: 10,
    });

    // Append all context to system prompt
    const systemPromptAppend = constitution + channelInstructions + '\n\n' + crossChannelContextStr;

    // Use engagement callbacks to capture respond tool calls
    const tracker = this.createEngagementCallbacks();

    // Send to Claude - no outputFormat
    const result = await this.sessionManager.sendMessage(
      message.channelId,
      await this.buildMessageText(message),
      message.platform,
      message.channelName,
      tracker.callbacks,
      resumeSession,
      {
        systemPrompt: { type: 'preset', preset: 'claude_code', append: systemPromptAppend },
      }
    );

    // Process engagement from respond tool calls (with retry if needed)
    const responses = await this.processEngagement(
      tracker,
      result.sessionId,
      message,
      resumeSession,
      systemPromptAppend,
    );

    // Post any decisions to #decision-log
    await this.postDecisions(tracker.getDecisions(), message);
    await this.postSlackReplies(tracker.getSlackReplies());

    const positiveResponse = responses.find(r => r.shouldRespond && r.message);

    // Log engagement decision
    logger.info('Thread engagement decision', {
      channelId: message.channelId,
      threadId,
      respondCalls: responses.length,
      shouldRespond: !!positiveResponse,
      reason: responses[0]?.reason,
      hasMessage: !!positiveResponse?.message,
    });

    if (positiveResponse) {
      // Show processing indicator since we're going to respond
      await responder.markProcessing();

      // Post the response
      await responder.updateResponse(positiveResponse.message!);
      await responder.finalizeResponse();

      // Fork session for this thread
      const silentCallbacks = this.createSilentCallbacks();
      const forkResult = await this.sessionManager.sendMessage(
        message.channelId,
        `[System: You responded to the user with: "${positiveResponse.message}". The conversation continues in this thread.]`,
        message.platform,
        message.channelName,
        silentCallbacks,
        resumeSession,
        {
          systemPrompt: { type: 'preset', preset: 'claude_code', append: constitution },
          forkSession: true,
        }
      );

      // Save the thread session
      if (forkResult.sessionId) {
        this.database.saveThreadSession(threadId, {
          channelId: message.channelId,
          sessionId: forkResult.sessionId,
          forkedFromSessionId: resumeSession?.sessionId ?? null,
          contextTokens: forkResult.stats.contextTokens,
          compactionCount: forkResult.stats.compactionCount,
        });
      }

      await responder.clearProcessing();
    }
    // If not engaging, don't show any indicator or response
  }

  private async forkAndRespond(
    message: IncomingMessage,
    responder: PlatformResponder,
    mainSessionId: string,
    responseMessage: string
  ): Promise<void> {
    // Reply in a thread under the user's message
    await responder.updateResponse(responseMessage);
    await responder.finalizeResponse();

    // Use the user's message as the thread ID
    const threadId = message.messageId;

    // Fork session for the new thread
    const constitution = this.constitutionManager.getFullConstitution();
    const silentCallbacks = this.createSilentCallbacks();

    const result = await this.sessionManager.sendMessage(
      message.channelId,
      `[System: You responded to the user with: "${responseMessage}". The conversation continues in this thread.]`,
      message.platform,
      message.channelName,
      silentCallbacks,
      { sessionId: mainSessionId, compactionCount: 0 },
      {
        systemPrompt: { type: 'preset', preset: 'claude_code', append: constitution },
        forkSession: true,
      }
    );

    // Save the thread session
    if (result.sessionId) {
      this.database.saveThreadSession(threadId, {
        channelId: message.channelId,
        sessionId: result.sessionId,
        forkedFromSessionId: mainSessionId,
        contextTokens: result.stats.contextTokens,
        compactionCount: result.stats.compactionCount,
      });
    }
  }

  /**
   * Process engagement decisions from the tracker.
   * If Claude generated freeform text but never called respond, retry once.
   * Returns the collected respond calls (may be empty for safe-default silence).
   */
  private async processEngagement(
    tracker: EngagementTracker,
    sessionId: string | undefined,
    message: IncomingMessage,
    resumeSession: { sessionId: string; compactionCount: number } | undefined,
    systemPromptAppend: string,
  ): Promise<EngagementResponse[]> {
    const responses = tracker.getResponses();

    if (responses.length > 0) {
      return responses;
    }

    // No respond calls - check if Claude generated freeform text (needs retry)
    if (!tracker.hadFreeformText()) {
      // No text, no tool calls = safe silent default
      return [];
    }

    // Freeform text without respond call - retry once
    if (!sessionId) {
      logger.warn('Freeform text without respond call, but no session to retry');
      return [];
    }

    logger.info('Freeform text without respond call, retrying with system-reminder', {
      channelId: message.channelId,
    });

    const retryTracker = this.createEngagementCallbacks();
    await this.sessionManager.sendMessage(
      message.channelId,
      '<system-reminder>CRITICAL: Your previous text output was NOT visible to the user. You MUST call the `respond` tool to communicate. Call respond with directed_at_me=true and your message, or directed_at_me=false if you should stay silent. Do it now.</system-reminder>',
      message.platform,
      message.channelName,
      retryTracker.callbacks,
      { sessionId, compactionCount: resumeSession?.compactionCount ?? 0 },
      {
        systemPrompt: { type: 'preset', preset: 'claude_code', append: systemPromptAppend },
      }
    );

    return retryTracker.getResponses();
  }

  /**
   * Add a reaction to the message if the responder supports it.
   */
  private async addReactionIfSupported(
    responder: PlatformResponder,
    reaction: string
  ): Promise<void> {
    if ('addReaction' in responder && typeof responder.addReaction === 'function') {
      await (responder as { addReaction: (name: string) => Promise<void> }).addReaction(reaction);
    }
  }

  /**
   * Create callbacks that capture respond tool calls and track other tool usage.
   */
  private createEngagementCallbacks(): EngagementTracker {
    const responses: EngagementResponse[] = [];
    const decisions: DecisionLogInput[] = [];
    const slackReplies: SlackReplyInput[] = [];
    const toolsUsed: string[] = [];
    let freeformText = false;

    const callbacks: SessionCallbacks = {
      onSessionStart: async () => {},
      onCompaction: async () => {},
      onText: async () => {
        freeformText = true;
      },
      onTextDelta: async () => {
        freeformText = true;
      },
      onToolUse: async (name, input) => {
        // SDK prefixes MCP tool names: mcp__{server}__{tool} → extract tool name
        const toolName = name.includes('__') ? name.split('__').pop()! : name;

        if (toolName === 'respond') {
          responses.push(parseRespondToolInput(input));
          logger.debug('Respond tool captured', { name, input });
        } else if (toolName === 'log_decision') {
          const parsed = parseDecisionLogInput(input);
          if (parsed) {
            decisions.push(parsed);
          } else {
            logger.warn('Invalid log_decision input, skipping', { input });
          }
          toolsUsed.push(toolName);
        } else if (toolName === 'slack_reply') {
          const parsed = parseSlackReplyInput(input);
          if (parsed) {
            slackReplies.push(parsed);
          } else {
            logger.warn('Invalid slack_reply input, skipping', { input });
          }
          toolsUsed.push(toolName);
        } else {
          toolsUsed.push(toolName);
          logger.debug('Tool use tracked', { name, toolName });
        }
      },
      onFileSend: async () => {},
    };

    return {
      callbacks,
      getResponses: () => responses,
      getDecisions: () => decisions,
      getSlackReplies: () => slackReplies,
      getToolsUsed: () => toolsUsed,
      hadFreeformText: () => freeformText,
    };
  }

  private async postSlackReplies(replies: SlackReplyInput[]): Promise<void> {
    for (const reply of replies) {
      try {
        await this.slackClient.chat.postMessage({
          channel: reply.channelId,
          thread_ts: reply.threadTs,
          text: reply.message,
        });
        logger.info('Posted slack_reply', { channelId: reply.channelId, threadTs: reply.threadTs });
      } catch (error) {
        logger.error('Failed to post slack_reply', { error, channelId: reply.channelId, threadTs: reply.threadTs });
      }
    }
  }

  private async postDecisions(decisions: DecisionLogInput[], message: IncomingMessage): Promise<void> {
    if (decisions.length === 0) return;

    const channelId = await this.resolveDecisionLogChannel();
    if (!channelId) return;

    for (const decision of decisions) {
      try {
        const permalink = await this.slackClient.chat.getPermalink({
          channel: message.channelId,
          message_ts: message.messageId,
        });

        const tags = decision.tags.map(t => `\`${t}\``).join(', ');
        const text = `*Decision:* ${decision.decision}\n*Tags:* ${tags}\n*Source:* <${permalink.permalink}|View in #${message.channelName}>`;

        await this.slackClient.chat.postMessage({
          channel: channelId,
          text,
        });
      } catch (error) {
        logger.error('Failed to post decision to #decision-log', { error, decision: decision.decision });
      }
    }
  }

  private async resolveDecisionLogChannel(): Promise<string | null> {
    if (this.decisionLogChannelId !== undefined) {
      return this.decisionLogChannelId;
    }

    try {
      const result = await this.slackClient.conversations.list({ types: 'public_channel' });
      const channel = result.channels?.find((c: { name?: string }) => c.name === 'decision-log');
      this.decisionLogChannelId = channel?.id ?? null;
      if (!this.decisionLogChannelId) {
        logger.warn('Could not find #decision-log channel');
      }
      return this.decisionLogChannelId;
    } catch (error) {
      logger.error('Failed to resolve #decision-log channel', { error });
      this.decisionLogChannelId = null;
      return null;
    }
  }

  private createSilentCallbacks(): SessionCallbacks {
    return {
      onSessionStart: async () => {},
      onCompaction: async () => {},
      onText: async () => {},
      onTextDelta: async () => {},
      onToolUse: async () => {},
      onFileSend: async () => {},
    };
  }

  /**
   * Resolve a Slack user ID to a display name, with caching.
   */
  private async resolveUserName(userId: string): Promise<string> {
    const cached = this.userNameCache.get(userId);
    if (cached) return cached;

    try {
      const result = await this.slackClient.users.info({ user: userId });
      // biome-ignore lint/suspicious/noExplicitAny: Slack SDK User type doesn't expose these properties
      const user = result.user as any;
      const name = user?.real_name || user?.profile?.display_name || user?.name || userId;
      this.userNameCache.set(userId, name);
      return name;
    } catch {
      this.userNameCache.set(userId, userId);
      return userId;
    }
  }

  /**
   * Replace Slack @mention tokens (<@U123>) with readable @DisplayName.
   */
  private async resolveUserMentions(text: string): Promise<string> {
    const mentionPattern = /<@(U[A-Z0-9_]+)>/g;
    const matches = [...text.matchAll(mentionPattern)];
    if (matches.length === 0) return text;

    let resolved = text;
    for (const match of matches) {
      const userId = match[1];
      const name = await this.resolveUserName(userId);
      resolved = resolved.replace(match[0], name !== userId ? `@${name} (${match[0]})` : match[0]);
    }
    return resolved;
  }

  /**
   * Format a Slack message timestamp (e.g. '1738234800.000100') into a
   * human-readable string like 'Feb 9, 2:30 PM'.
   */
  private formatTimestamp(slackTs: string): string {
    const seconds = parseFloat(slackTs);
    if (isNaN(seconds)) return '';
    const date = new Date(seconds * 1000);
    const tz = process.env.TZ || 'America/Los_Angeles';
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: tz,
    }).format(date);
  }

  /**
   * Build message text with sender name, timestamp, and attachment metadata.
   * Prefixes with [SenderName | timestamp]: so Claude can track who's speaking
   * and when in multi-person channels.
   */
  private async buildMessageText(message: IncomingMessage): Promise<string> {
    const senderName = await this.resolveUserName(message.senderId);
    const timestamp = this.formatTimestamp(message.messageId);
    let text = await this.resolveUserMentions(message.text);
    const prefix = timestamp ? `${senderName} | ${timestamp}` : senderName;
    let result = `[${prefix}]: ${text}`;
    for (const attachment of message.attachments) {
      result += `\n\n<attachment>\nFile: ${attachment.originalName}\nType: ${attachment.mimeType}\nSize: ${attachment.size} bytes\nLocal path: ${attachment.localPath}\n</attachment>`;
    }
    return result;
  }

  private toSlackMessage(message: IncomingMessage): SlackMessage {
    return {
      channelId: message.channelId,
      channelName: message.channelName,
      threadTs: message.threadId,
      messageTs: message.messageId,
      userId: message.senderId,
      userName: message.senderId, // Will be resolved by adapter
      text: message.text,
      isMention: false,
      isDm: false,
    };
  }
}
