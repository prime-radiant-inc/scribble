// scribble/src/orchestrator/__tests__/scribbleOrchestrator.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScribbleOrchestrator } from '../scribbleOrchestrator.js';

describe('ScribbleOrchestrator', () => {
  const mockDatabase = {
    getMainSession: vi.fn(),
    saveMainSession: vi.fn(),
    getThreadSession: vi.fn(),
    saveThreadSession: vi.fn(),
    isEventProcessed: vi.fn().mockReturnValue(false),
    markEventProcessed: vi.fn(),
  };

  const mockSessionManager = {
    sendMessage: vi.fn(),
  };

  const mockConversationLogger = {
    logChannelMessage: vi.fn(),
  };

  const mockConstitutionManager = {
    getFullConstitution: vi.fn().mockReturnValue('You are Scribble...'),
    getInstructionsForChannel: vi.fn().mockReturnValue(''),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create orchestrator with dependencies', () => {
    const orchestrator = new ScribbleOrchestrator({
      database: mockDatabase as any,
      sessionManager: mockSessionManager as any,
      conversationLogger: mockConversationLogger as any,
      constitutionManager: mockConstitutionManager as any,
      dataDir: '/tmp/test',
    });

    expect(orchestrator).toBeDefined();
  });

  it('should route channel messages to main session', async () => {
    mockSessionManager.sendMessage.mockResolvedValue({
      sessionId: 'sess_main',
      text: '{"shouldRespond": false, "reason": "not addressed"}',
      stats: { contextTokens: 100, outputTokens: 50, costUsd: 0.01, durationMs: 500, compactionCount: 0 },
    });

    const orchestrator = new ScribbleOrchestrator({
      database: mockDatabase as any,
      sessionManager: mockSessionManager as any,
      conversationLogger: mockConversationLogger as any,
      constitutionManager: mockConstitutionManager as any,
      dataDir: '/tmp/test',
    });

    const mockResponder = {
      markProcessing: vi.fn(),
      clearProcessing: vi.fn(),
      setTyping: vi.fn(),
      updateResponse: vi.fn(),
      finalizeResponse: vi.fn(),
      sendNotice: vi.fn(),
      updateChannelStats: vi.fn(),
      markError: vi.fn(),
      createThreadStarter: vi.fn(),
      sendFile: vi.fn(),
    };

    await orchestrator.handleMessage(
      {
        platform: 'slack',
        channelId: 'C123',
        channelName: 'general',
        threadId: null,
        messageId: '123.456',
        senderId: 'U789',
        text: 'Hello room',
        attachments: [],
      },
      mockResponder as any
    );

    // Should have logged the message
    expect(mockConversationLogger.logChannelMessage).toHaveBeenCalled();

    // Should have called sendMessage with main session resume
    expect(mockSessionManager.sendMessage).toHaveBeenCalled();
    const callArgs = mockSessionManager.sendMessage.mock.calls[0];
    expect(callArgs[6]?.systemPrompt).toBeDefined(); // Should have systemPrompt
    expect(callArgs[6]?.outputFormat).toBeDefined(); // Should have outputFormat for engagement
  });
});
