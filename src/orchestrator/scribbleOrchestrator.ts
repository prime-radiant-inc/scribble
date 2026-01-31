// scribble/src/orchestrator/scribbleOrchestrator.ts
import type { SessionDatabase, MainSessionRecord, ThreadSessionRecord } from 'bot-toolkit';
import type { ClaudeSessionManagerSDK } from 'bot-toolkit';
import type { IncomingMessage, PlatformResponder, SessionCallbacks } from 'bot-toolkit';
import { Logger } from 'bot-toolkit';
import type { WebClient } from '@slack/web-api';
import type { ConversationLogger } from '../logging/conversationLogger.js';
import type { ConstitutionManager } from '../constitution/manager.js';
import { CrossChannelContext } from '../context/crossChannelContext.js';
import { ENGAGEMENT_RESPONSE_SCHEMA, parseEngagementResponse } from '../core/responseSchema.js';
import type { SlackMessage } from '../core/types.js';

const logger = new Logger('ScribbleOrchestrator');

export interface ScribbleOrchestratorConfig {
  database: SessionDatabase;
  sessionManager: ClaudeSessionManagerSDK;
  conversationLogger: ConversationLogger;
  constitutionManager: ConstitutionManager;
  dataDir: string;
  slackClient: WebClient;
}

export class ScribbleOrchestrator {
  private database: SessionDatabase;
  private sessionManager: ClaudeSessionManagerSDK;
  private conversationLogger: ConversationLogger;
  private constitutionManager: ConstitutionManager;
  private dataDir: string;
  private crossChannelContext: CrossChannelContext;

  constructor(config: ScribbleOrchestratorConfig) {
    this.database = config.database;
    this.sessionManager = config.sessionManager;
    this.conversationLogger = config.conversationLogger;
    this.constitutionManager = config.constitutionManager;
    this.dataDir = config.dataDir;
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
    // Don't show processing indicator until we decide to engage
    // This prevents the 👀 reaction on messages we won't respond to

    try {
      // Get or create main session
      const mainSession = this.database.getMainSession(message.channelId);
      const resumeSession = mainSession
        ? { sessionId: mainSession.session_id, compactionCount: mainSession.compaction_count }
        : undefined;

      // Build system prompt with constitution
      const constitution = this.constitutionManager.getFullConstitution();
      const channelInstructions = this.constitutionManager.getInstructionsForChannel(message.channelName);

      // Gather cross-channel context
      const crossChannelContextStr = await this.crossChannelContext.gather({
        excludeChannelId: message.channelId,
        excludeThreadTs: message.threadId ?? undefined,
        windowHours: 24,
        maxPerThread: 10,
      });

      // Append all context to system prompt
      const systemPromptAppend = constitution + channelInstructions + '\n\n' + crossChannelContextStr;

      // Use silent callbacks for engagement decision - don't stream to Slack
      // until we know Claude decided to respond
      const silentCallbacks = this.createSilentCallbacks();

      // Send to Claude with engagement decision format
      const result = await this.sessionManager.sendMessage(
        message.channelId,
        message.text,
        message.platform,
        message.channelName,
        silentCallbacks,
        resumeSession,
        {
          systemPrompt: { type: 'preset', preset: 'claude_code', append: systemPromptAppend },
          outputFormat: { type: 'json_schema', schema: ENGAGEMENT_RESPONSE_SCHEMA },
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

      // Parse engagement decision
      const engagement = parseEngagementResponse(result.text);
      logger.info('Engagement decision', {
        channelId: message.channelId,
        shouldRespond: engagement.shouldRespond,
        reason: engagement.reason,
        hasMessage: !!engagement.message,
      });

      if (engagement.shouldRespond && engagement.message) {
        // Now show processing indicator since we're going to respond
        await responder.markProcessing();
        // Fork session and create thread
        await this.forkAndRespond(message, responder, result.sessionId!, engagement.message);
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
        // We're already engaged in this thread - respond directly
        await this.handleEngagedThreadMessage(message, responder, threadSession);
      } else {
        // Not engaged in this thread yet - check if we should engage
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

    // Don't show processing indicator yet - wait for engagement decision

    const resumeSession = {
      sessionId: threadSession.session_id,
      compactionCount: threadSession.compaction_count,
    };

    // Build system prompt
    const constitution = this.constitutionManager.getFullConstitution();
    const channelInstructions = this.constitutionManager.getInstructionsForChannel(message.channelName);

    // Gather cross-channel context
    const crossChannelContextStr = await this.crossChannelContext.gather({
      excludeChannelId: message.channelId,
      excludeThreadTs: threadId,
      windowHours: 24,
      maxPerThread: 10,
    });

    // Append all context to system prompt
    const systemPromptAppend = constitution + channelInstructions + '\n\n' + crossChannelContextStr;

    // Track tool usage during this turn
    const toolsUsed: string[] = [];
    const trackingCallbacks = this.createTrackingCallbacks(toolsUsed);

    // Send to Claude with engagement decision format
    // Claude can use tools AND decide whether to respond verbally
    const result = await this.sessionManager.sendMessage(
      message.channelId,
      message.text,
      message.platform,
      message.channelName,
      trackingCallbacks,
      resumeSession,
      {
        systemPrompt: { type: 'preset', preset: 'claude_code', append: systemPromptAppend },
        outputFormat: { type: 'json_schema', schema: ENGAGEMENT_RESPONSE_SCHEMA },
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

    // Parse engagement decision
    const engagement = parseEngagementResponse(result.text);
    logger.info('Engaged thread decision', {
      channelId: message.channelId,
      threadId,
      shouldRespond: engagement.shouldRespond,
      reason: engagement.reason,
      hasMessage: !!engagement.message,
      toolsUsed: toolsUsed.length > 0 ? toolsUsed : undefined,
    });

    if (engagement.shouldRespond && engagement.message) {
      // Verbal response requested
      await responder.markProcessing();
      await responder.updateResponse(engagement.message);
      await responder.finalizeResponse();
      await responder.clearProcessing();
    } else if (toolsUsed.length > 0) {
      // Tools were used but no verbal response - add a checkmark
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
    const channelInstructions = this.constitutionManager.getInstructionsForChannel(message.channelName);

    // Gather cross-channel context
    const crossChannelContextStr = await this.crossChannelContext.gather({
      excludeChannelId: message.channelId,
      excludeThreadTs: threadId,
      windowHours: 24,
      maxPerThread: 10,
    });

    // Append all context to system prompt
    const systemPromptAppend = constitution + channelInstructions + '\n\n' + crossChannelContextStr;

    // Use silent callbacks for engagement decision
    const silentCallbacks = this.createSilentCallbacks();

    // Send to Claude with engagement decision format
    const result = await this.sessionManager.sendMessage(
      message.channelId,
      message.text,
      message.platform,
      message.channelName,
      silentCallbacks,
      resumeSession,
      {
        systemPrompt: { type: 'preset', preset: 'claude_code', append: systemPromptAppend },
        outputFormat: { type: 'json_schema', schema: ENGAGEMENT_RESPONSE_SCHEMA },
      }
    );

    // Parse engagement decision
    const engagement = parseEngagementResponse(result.text);
    logger.info('Thread engagement decision', {
      channelId: message.channelId,
      threadId,
      shouldRespond: engagement.shouldRespond,
      reason: engagement.reason,
      hasMessage: !!engagement.message,
    });

    if (engagement.shouldRespond && engagement.message) {
      // Show processing indicator since we're going to respond
      await responder.markProcessing();

      // Post the response
      await responder.updateResponse(engagement.message);
      await responder.finalizeResponse();

      // Fork session for this thread
      const forkResult = await this.sessionManager.sendMessage(
        message.channelId,
        `[System: You responded to the user with: "${engagement.message}". The conversation continues in this thread.]`,
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
    // The responder is already configured with threadTs = message.messageId
    await responder.updateResponse(responseMessage);
    await responder.finalizeResponse();

    // Use the user's message as the thread ID
    const threadId = message.messageId;

    // Fork session for the new thread
    // Use silent callbacks since this is internal session setup, not user-visible output
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
   * Add a reaction to the message if the responder supports it.
   */
  private async addReactionIfSupported(
    responder: PlatformResponder,
    reaction: string
  ): Promise<void> {
    // Check if responder has addReaction method (SlackResponderSDK does)
    if ('addReaction' in responder && typeof responder.addReaction === 'function') {
      await (responder as { addReaction: (name: string) => Promise<void> }).addReaction(reaction);
    }
  }

  /**
   * Create callbacks that track tool usage but don't stream to Slack.
   */
  private createTrackingCallbacks(toolsUsed: string[]): SessionCallbacks {
    return {
      onSessionStart: async () => {},
      onCompaction: async () => {},
      onText: async () => {},
      onTextDelta: async () => {},
      onToolUse: async (name) => {
        toolsUsed.push(name);
        logger.debug('Tool use tracked', { name });
      },
      onFileSend: async () => {},
    };
  }

  private createSilentCallbacks(): SessionCallbacks {
    // Silent callbacks for internal operations (e.g., session forking)
    // that shouldn't produce user-visible output
    return {
      onSessionStart: async () => {},
      onCompaction: async () => {},
      onText: async () => {},
      onTextDelta: async () => {},
      onToolUse: async () => {},
      onFileSend: async () => {},
    };
  }

  private createCallbacks(responder: PlatformResponder): SessionCallbacks {
    return {
      onSessionStart: async (sessionId) => {
        logger.debug('Session started', { sessionId });
      },
      onCompaction: async ({ preTokens, trigger }) => {
        const notice = `Context compacted (was ${Math.round(preTokens / 1000)}k tokens, trigger: ${trigger})`;
        await responder.sendNotice(notice);
      },
      onText: async (text) => {
        await responder.updateResponse(text);
      },
      onTextDelta: async (text) => {
        await responder.updateResponse(text);
      },
      onToolUse: async (name) => {
        logger.debug('Tool use', { name });
      },
      onFileSend: async (localPath) => {
        await responder.sendFile(localPath);
      },
    };
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
