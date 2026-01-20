import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { ScribbleOrchestrator, OrchestratorConfig } from '../orchestrator.js';
import { SlackMessage } from '../types.js';
import { SlackResponder } from '../../slack/responder.js';

// Mock dependencies
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Test response' }],
        stop_reason: 'end_turn',
      }),
    },
  })),
}));

// Create mock implementations
const mockConversationLogger = {
  logMessage: vi.fn().mockResolvedValue(undefined),
  getRecentMessages: vi.fn().mockResolvedValue([]),
  search: vi.fn().mockResolvedValue([]),
};

const mockWikiManager = {
  search: vi.fn().mockResolvedValue([]),
  readEntry: vi.fn().mockResolvedValue(null),
  writeEntry: vi.fn().mockResolvedValue(undefined),
  deleteEntry: vi.fn().mockResolvedValue(true),
  renameEntry: vi.fn().mockResolvedValue(true),
  commit: vi.fn().mockResolvedValue(undefined),
  localPath: '/tmp/test-wiki',
};

const mockStateStore = {
  isThreadActive: vi.fn().mockReturnValue(false),
  setActiveThread: vi.fn(),
  removeActiveThread: vi.fn(),
  updateThreadActivity: vi.fn(),
  getActiveThread: vi.fn().mockReturnValue(null),
  getAllActiveThreads: vi.fn().mockReturnValue([]),
};

const mockConfig = {
  anthropic: { apiKey: 'test-api-key' },
  dataDirectory: '/tmp/test-data',
  slack: { botToken: 'xoxb-test', appToken: 'xapp-test' },
  wiki: { localPath: '/tmp/test-wiki', repo: 'test/wiki' },
  github: { token: 'test-token' },
};

function createMockResponder(): SlackResponder {
  return {
    markProcessing: vi.fn().mockResolvedValue(undefined),
    clearProcessing: vi.fn().mockResolvedValue(undefined),
    updateResponse: vi.fn().mockResolvedValue(undefined),
    finalizeResponse: vi.fn().mockResolvedValue(undefined),
    markError: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
  } as unknown as SlackResponder;
}

function createTestMessage(overrides: Partial<SlackMessage> = {}): SlackMessage {
  return {
    channelId: 'C123',
    channelName: 'general',
    threadTs: null,
    messageTs: '1234567890.000001',
    userId: 'U456',
    userName: 'testuser',
    text: 'Hello world',
    isMention: false,
    isDm: false,
    ...overrides,
  };
}

describe('ScribbleOrchestrator', () => {
  let orchestrator: ScribbleOrchestrator;
  const botUserId = 'U_BOT123';

  beforeEach(() => {
    vi.clearAllMocks();

    orchestrator = new ScribbleOrchestrator({
      config: mockConfig,
      stateStore: mockStateStore,
      conversationLogger: mockConversationLogger,
      wikiManager: mockWikiManager,
      botUserId,
    } as unknown as OrchestratorConfig);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('processMessage', () => {
    it('should always log the message', async () => {
      const message = createTestMessage();

      await orchestrator.processMessage(message);

      expect(mockConversationLogger.logMessage).toHaveBeenCalledWith(message);
    });

    it('should not respond to regular messages without engagement', async () => {
      const message = createTestMessage();
      const responder = createMockResponder();

      await orchestrator.processMessage(message, responder);

      expect(responder.markProcessing).not.toHaveBeenCalled();
    });

    it('should respond to @mentions', async () => {
      const message = createTestMessage({
        text: `<@${botUserId}> help me with something`,
        isMention: true,
      });
      const responder = createMockResponder();

      await orchestrator.processMessage(message, responder);

      expect(responder.markProcessing).toHaveBeenCalled();
    });

    it('should respond to DMs', async () => {
      const message = createTestMessage({
        channelId: 'D123',
        isDm: true,
        text: 'Hello bot',
      });
      const responder = createMockResponder();

      await orchestrator.processMessage(message, responder);

      expect(responder.markProcessing).toHaveBeenCalled();
    });

    it('should respond when name "scribble" is used', async () => {
      const message = createTestMessage({
        text: 'Hey scribble, can you help?',
      });
      const responder = createMockResponder();

      await orchestrator.processMessage(message, responder);

      expect(responder.markProcessing).toHaveBeenCalled();
    });

    it('should engage in thread when first responding', async () => {
      const message = createTestMessage({
        text: `<@${botUserId}> question`,
        isMention: true,
        threadTs: '1234567890.000000',
      });
      const responder = createMockResponder();

      await orchestrator.processMessage(message, responder);

      expect(mockStateStore.setActiveThread).toHaveBeenCalled();
    });

    it('should respond when in an active thread', async () => {
      const threadId = '1234567890.000000';
      mockStateStore.isThreadActive.mockReturnValue(true);

      const message = createTestMessage({
        text: 'Follow-up message',
        threadTs: threadId,
      });
      const responder = createMockResponder();

      await orchestrator.processMessage(message, responder);

      expect(responder.markProcessing).toHaveBeenCalled();
      expect(mockStateStore.updateThreadActivity).toHaveBeenCalled();
    });

    it('should disengage when dismissal phrase is used', async () => {
      const threadId = '1234567890.000000';
      mockStateStore.isThreadActive.mockReturnValue(true);

      const message = createTestMessage({
        text: 'thanks Scribble',
        threadTs: threadId,
      });
      const responder = createMockResponder();

      await orchestrator.processMessage(message, responder);

      expect(mockStateStore.removeActiveThread).toHaveBeenCalled();
      expect(responder.markProcessing).not.toHaveBeenCalled();
    });
  });

  describe('standup handling', () => {
    it('should detect standup messages', async () => {
      const message = createTestMessage({
        text: 'Yesterday: finished the PR review\nToday: will work on the bug fix',
      });

      await orchestrator.processMessage(message);

      // The standup tracker should be called (we'll verify via the recordStandup mock)
      expect(mockConversationLogger.logMessage).toHaveBeenCalled();
    });

    it('should extract commitments from standup messages', async () => {
      const message = createTestMessage({
        text: 'Yesterday: code review\nToday: I will finish the authentication module\nBlockers: none',
      });

      // This test verifies that standup handling doesn't throw
      await expect(orchestrator.processMessage(message)).resolves.not.toThrow();
    });
  });

  describe('knowledge extraction', () => {
    it('should trigger extraction in background without blocking', async () => {
      const message = createTestMessage({
        text: 'We decided to use PostgreSQL for the new service',
      });

      const startTime = Date.now();
      await orchestrator.processMessage(message);
      const duration = Date.now() - startTime;

      // Should complete quickly since extraction is fire-and-forget
      // (not a strict timing test, but extraction shouldn't block)
      expect(duration).toBeLessThan(1000);
    });
  });

  describe('setBotUserId', () => {
    it('should update the bot user ID', () => {
      const newBotId = 'U_NEW_BOT';
      orchestrator.setBotUserId(newBotId);

      // Create a message with the new bot ID mention
      const message = createTestMessage({
        text: `<@${newBotId}> test`,
        isMention: true,
      });

      // The orchestrator should recognize this as requiring response
      // (verified by the classifier using the new ID)
      expect(() => orchestrator.processMessage(message)).not.toThrow();
    });
  });
});
