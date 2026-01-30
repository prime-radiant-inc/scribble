// scribble/src/orchestrator/scribbleOrchestrator.ts
import type { SessionDatabase, MainSessionRecord, ThreadSessionRecord } from 'bot-toolkit';
import type { ClaudeSessionManagerSDK } from 'bot-toolkit';
import type { IncomingMessage, PlatformResponder, SessionCallbacks } from 'bot-toolkit';
import { Logger } from 'bot-toolkit';
import type { ConversationLogger } from '../logging/conversationLogger.js';
import type { ConstitutionManager } from '../constitution/manager.js';
import { ENGAGEMENT_RESPONSE_SCHEMA, parseEngagementResponse } from '../core/responseSchema.js';
import type { SlackMessage } from '../core/types.js';

const logger = new Logger('ScribbleOrchestrator');

export interface ScribbleOrchestratorConfig {
  database: SessionDatabase;
  sessionManager: ClaudeSessionManagerSDK;
  conversationLogger: ConversationLogger;
  constitutionManager: ConstitutionManager;
  dataDir: string;
}

export class ScribbleOrchestrator {
  private database: SessionDatabase;
  private sessionManager: ClaudeSessionManagerSDK;
  private conversationLogger: ConversationLogger;
  private constitutionManager: ConstitutionManager;
  private dataDir: string;

  constructor(config: ScribbleOrchestratorConfig) {
    this.database = config.database;
    this.sessionManager = config.sessionManager;
    this.conversationLogger = config.conversationLogger;
    this.constitutionManager = config.constitutionManager;
    this.dataDir = config.dataDir;
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
    await responder.markProcessing();
    await responder.setTyping(true);

    try {
      // Get or create main session
      const mainSession = this.database.getMainSession(message.channelId);
      const resumeSession = mainSession
        ? { sessionId: mainSession.session_id, compactionCount: mainSession.compaction_count }
        : undefined;

      // Build system prompt with constitution
      const constitution = this.constitutionManager.getFullConstitution();
      const channelInstructions = this.constitutionManager.getInstructionsForChannel(message.channelName);
      const systemPromptAppend = constitution + channelInstructions;

      // Create callbacks
      const callbacks = this.createCallbacks(responder);

      // Send to Claude with engagement decision format
      const result = await this.sessionManager.sendMessage(
        message.channelId,
        message.text,
        message.platform,
        message.channelName,
        callbacks,
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
      });

      if (engagement.shouldRespond && engagement.message) {
        // Fork session and create thread
        await this.forkAndRespond(message, responder, result.sessionId!, engagement.message);
      }

      await responder.setTyping(false);
      await responder.clearProcessing();
      await responder.updateChannelStats(result.stats);
    } catch (error) {
      logger.error('Error handling channel message', { error, messageId: message.messageId });
      await responder.setTyping(false);
      await responder.clearProcessing();
      await responder.markError();
    }
  }

  private async handleThreadMessage(
    message: IncomingMessage,
    responder: PlatformResponder
  ): Promise<void> {
    await responder.markProcessing();
    await responder.setTyping(true);

    try {
      const threadId = message.threadId!;
      let resumeSession: { sessionId: string; compactionCount: number } | undefined;
      let forkSession = false;

      // Check for existing thread session
      const threadSession = this.database.getThreadSession(threadId);
      if (threadSession) {
        resumeSession = {
          sessionId: threadSession.session_id,
          compactionCount: threadSession.compaction_count,
        };
      } else {
        // Fork from main session
        const mainSession = this.database.getMainSession(message.channelId);
        if (mainSession) {
          resumeSession = {
            sessionId: mainSession.session_id,
            compactionCount: mainSession.compaction_count,
          };
          forkSession = true;
        }
      }

      // Build system prompt
      const constitution = this.constitutionManager.getFullConstitution();
      const channelInstructions = this.constitutionManager.getInstructionsForChannel(message.channelName);
      const systemPromptAppend = constitution + channelInstructions;

      const callbacks = this.createCallbacks(responder);

      // Send to Claude (threads always get a response)
      const result = await this.sessionManager.sendMessage(
        message.channelId,
        message.text,
        message.platform,
        message.channelName,
        callbacks,
        resumeSession,
        {
          systemPrompt: { type: 'preset', preset: 'claude_code', append: systemPromptAppend },
          forkSession,
        }
      );

      // Save thread session
      if (result.sessionId) {
        this.database.saveThreadSession(threadId, {
          channelId: message.channelId,
          sessionId: result.sessionId,
          forkedFromSessionId: resumeSession?.sessionId ?? null,
          contextTokens: result.stats.contextTokens,
          compactionCount: result.stats.compactionCount,
        });
      }

      await responder.finalizeResponse();
      await responder.setTyping(false);
      await responder.clearProcessing();
      await responder.updateChannelStats(result.stats);
    } catch (error) {
      logger.error('Error handling thread message', { error, messageId: message.messageId });
      await responder.setTyping(false);
      await responder.clearProcessing();
      await responder.markError();
    }
  }

  private async forkAndRespond(
    message: IncomingMessage,
    responder: PlatformResponder,
    mainSessionId: string,
    responseMessage: string
  ): Promise<void> {
    // Create a new thread with the response message
    const threadId = await responder.createThreadStarter(responseMessage);

    // Fork session for the new thread
    // Use silent callbacks since this is internal session setup, not user-visible output
    const constitution = this.constitutionManager.getFullConstitution();
    const silentCallbacks = this.createSilentCallbacks();

    const result = await this.sessionManager.sendMessage(
      message.channelId,
      `[System: You just started a new thread with this message: "${responseMessage}". The user may reply.]`,
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
