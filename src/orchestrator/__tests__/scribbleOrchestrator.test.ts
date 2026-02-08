// scribble/src/orchestrator/__tests__/scribbleOrchestrator.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScribbleOrchestrator } from '../scribbleOrchestrator.js';
import type { SessionCallbacks } from 'bot-toolkit';

// Helper: create a mock sendMessage that invokes callbacks to simulate tool use
function createMockSendMessage() {
  // Each call stores a handler that tests can use to simulate callbacks
  const calls: Array<{
    callbacks: SessionCallbacks;
    resolve: (result: any) => void;
  }> = [];

  const fn = vi.fn().mockImplementation(
    async (
      _roomId: string,
      _userMessage: string,
      _platform: string,
      _contextName: string,
      callbacks: SessionCallbacks,
      _resumeSession?: any,
      _options?: any,
    ) => {
      // Return a promise that the test can control
      return new Promise((resolve) => {
        calls.push({ callbacks, resolve });
      });
    },
  );

  return { fn, calls };
}

// Helper: simulate a respond tool call via callbacks, then resolve the session
async function simulateRespondAndResolve(
  call: { callbacks: SessionCallbacks; resolve: (result: any) => void },
  respondInput: { directed_at_me: boolean; reason: string; message?: string },
  sessionId = 'sess_123',
) {
  await call.callbacks.onToolUse('respond', respondInput);
  call.resolve({
    sessionId,
    text: '', // No structured output text when using tool-based engagement
    stats: { contextTokens: 100, outputTokens: 50, costUsd: 0.01, durationMs: 500, compactionCount: 0 },
  });
}

// Helper: resolve a session with no tool calls and no text (silent)
function resolveQuietly(
  call: { callbacks: SessionCallbacks; resolve: (result: any) => void },
  sessionId = 'sess_123',
) {
  call.resolve({
    sessionId,
    text: '',
    stats: { contextTokens: 100, outputTokens: 50, costUsd: 0.01, durationMs: 500, compactionCount: 0 },
  });
}

function createMocks() {
  const mockDatabase = {
    getMainSession: vi.fn(),
    saveMainSession: vi.fn(),
    getThreadSession: vi.fn(),
    saveThreadSession: vi.fn(),
    isEventProcessed: vi.fn().mockReturnValue(false),
    markEventProcessed: vi.fn(),
  };

  const mockConversationLogger = {
    logChannelMessage: vi.fn(),
  };

  const mockConstitutionManager = {
    getFullConstitution: vi.fn().mockReturnValue('You are Scribble...'),
    getInstructionsForChannel: vi.fn().mockReturnValue(''),
  };

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
    addReaction: vi.fn(),
  };

  const mockSlackClient = {} as any;

  return { mockDatabase, mockConversationLogger, mockConstitutionManager, mockResponder, mockSlackClient };
}

function makeChannelMessage(overrides: Partial<any> = {}) {
  return {
    platform: 'slack' as const,
    channelId: 'C123',
    channelName: 'general',
    threadId: null,
    messageId: '123.456',
    senderId: 'U789',
    text: 'Hello room',
    attachments: [],
    ...overrides,
  };
}

function makeThreadMessage(overrides: Partial<any> = {}) {
  return {
    platform: 'slack' as const,
    channelId: 'C123',
    channelName: 'general',
    threadId: '100.000',
    messageId: '123.456',
    senderId: 'U789',
    text: 'Follow up question',
    attachments: [],
    ...overrides,
  };
}

describe('ScribbleOrchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create orchestrator with dependencies', () => {
    const { mockDatabase, mockConversationLogger, mockConstitutionManager, mockSlackClient } = createMocks();
    const { fn: sendMessage } = createMockSendMessage();

    const orchestrator = new ScribbleOrchestrator({
      database: mockDatabase as any,
      sessionManager: { sendMessage } as any,
      conversationLogger: mockConversationLogger as any,
      constitutionManager: mockConstitutionManager as any,
      dataDir: '/tmp/test',
      slackClient: mockSlackClient,
    });

    expect(orchestrator).toBeDefined();
  });

  it('should not pass outputFormat to sendMessage', async () => {
    const { mockDatabase, mockConversationLogger, mockConstitutionManager, mockResponder, mockSlackClient } = createMocks();
    const { fn: sendMessage, calls } = createMockSendMessage();

    const orchestrator = new ScribbleOrchestrator({
      database: mockDatabase as any,
      sessionManager: { sendMessage } as any,
      conversationLogger: mockConversationLogger as any,
      constitutionManager: mockConstitutionManager as any,
      dataDir: '/tmp/test',
      slackClient: mockSlackClient,
    });

    const handlePromise = orchestrator.handleMessage(makeChannelMessage(), mockResponder as any);

    // Wait for sendMessage to be called
    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));

    // Simulate respond(false) and resolve
    await simulateRespondAndResolve(calls[0], { directed_at_me: false, reason: 'not addressed' });
    await handlePromise;

    // Verify outputFormat is NOT passed
    const callArgs = sendMessage.mock.calls[0];
    expect(callArgs[6]?.outputFormat).toBeUndefined();
  });

  it('should stay silent when respond(directed_at_me=false)', async () => {
    const { mockDatabase, mockConversationLogger, mockConstitutionManager, mockResponder, mockSlackClient } = createMocks();
    const { fn: sendMessage, calls } = createMockSendMessage();

    const orchestrator = new ScribbleOrchestrator({
      database: mockDatabase as any,
      sessionManager: { sendMessage } as any,
      conversationLogger: mockConversationLogger as any,
      constitutionManager: mockConstitutionManager as any,
      dataDir: '/tmp/test',
      slackClient: mockSlackClient,
    });

    const handlePromise = orchestrator.handleMessage(makeChannelMessage(), mockResponder as any);
    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));

    await simulateRespondAndResolve(calls[0], { directed_at_me: false, reason: 'not addressed' });
    await handlePromise;

    expect(mockResponder.updateResponse).not.toHaveBeenCalled();
    expect(mockResponder.markProcessing).not.toHaveBeenCalled();
  });

  it('should send message when respond(directed_at_me=true) on channel message', async () => {
    const { mockDatabase, mockConversationLogger, mockConstitutionManager, mockResponder, mockSlackClient } = createMocks();
    const { fn: sendMessage, calls } = createMockSendMessage();

    const orchestrator = new ScribbleOrchestrator({
      database: mockDatabase as any,
      sessionManager: { sendMessage } as any,
      conversationLogger: mockConversationLogger as any,
      constitutionManager: mockConstitutionManager as any,
      dataDir: '/tmp/test',
      slackClient: mockSlackClient,
    });

    const handlePromise = orchestrator.handleMessage(makeChannelMessage(), mockResponder as any);
    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));

    // Simulate respond(true) with a message
    await simulateRespondAndResolve(calls[0], {
      directed_at_me: true,
      reason: 'asked a question',
      message: 'Here is the answer.',
    });

    // Wait for the fork session call
    await vi.waitFor(() => expect(calls.length).toBe(2));

    // Resolve the fork call silently
    resolveQuietly(calls[1], 'sess_fork');

    await handlePromise;

    expect(mockResponder.markProcessing).toHaveBeenCalled();
    expect(mockResponder.updateResponse).toHaveBeenCalledWith('Here is the answer.');
    expect(mockResponder.finalizeResponse).toHaveBeenCalled();
    expect(mockResponder.clearProcessing).toHaveBeenCalled();
  });

  it('should stay silent when no respond call and no text (safe default)', async () => {
    const { mockDatabase, mockConversationLogger, mockConstitutionManager, mockResponder, mockSlackClient } = createMocks();
    const { fn: sendMessage, calls } = createMockSendMessage();

    const orchestrator = new ScribbleOrchestrator({
      database: mockDatabase as any,
      sessionManager: { sendMessage } as any,
      conversationLogger: mockConversationLogger as any,
      constitutionManager: mockConstitutionManager as any,
      dataDir: '/tmp/test',
      slackClient: mockSlackClient,
    });

    const handlePromise = orchestrator.handleMessage(makeChannelMessage(), mockResponder as any);
    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));

    // No tool calls, no text - resolve immediately
    resolveQuietly(calls[0]);
    await handlePromise;

    expect(mockResponder.updateResponse).not.toHaveBeenCalled();
    expect(mockResponder.markProcessing).not.toHaveBeenCalled();
  });

  it('should add checkmark when write tools used but no verbal response in engaged thread', async () => {
    const { mockDatabase, mockConversationLogger, mockConstitutionManager, mockResponder, mockSlackClient } = createMocks();
    const { fn: sendMessage, calls } = createMockSendMessage();

    // Simulate an existing thread session
    mockDatabase.getThreadSession.mockReturnValue({ session_id: 'sess_thread', compaction_count: 0 });

    const orchestrator = new ScribbleOrchestrator({
      database: mockDatabase as any,
      sessionManager: { sendMessage } as any,
      conversationLogger: mockConversationLogger as any,
      constitutionManager: mockConstitutionManager as any,
      dataDir: '/tmp/test',
      slackClient: mockSlackClient,
    });

    const handlePromise = orchestrator.handleMessage(makeThreadMessage(), mockResponder as any);
    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));

    // Simulate write tool use (wiki_create) then respond(false)
    await calls[0].callbacks.onToolUse('wiki_create', { path: 'test.md', content: '# Test' });
    await simulateRespondAndResolve(calls[0], { directed_at_me: false, reason: 'created wiki entry silently' });
    await handlePromise;

    expect(mockResponder.addReaction).toHaveBeenCalledWith('white_check_mark');
    expect(mockResponder.updateResponse).not.toHaveBeenCalled();
  });

  it('should NOT add checkmark for read-only tools in engaged thread', async () => {
    const { mockDatabase, mockConversationLogger, mockConstitutionManager, mockResponder, mockSlackClient } = createMocks();
    const { fn: sendMessage, calls } = createMockSendMessage();

    // Simulate an existing thread session
    mockDatabase.getThreadSession.mockReturnValue({ session_id: 'sess_thread', compaction_count: 0 });

    const orchestrator = new ScribbleOrchestrator({
      database: mockDatabase as any,
      sessionManager: { sendMessage } as any,
      conversationLogger: mockConversationLogger as any,
      constitutionManager: mockConstitutionManager as any,
      dataDir: '/tmp/test',
      slackClient: mockSlackClient,
    });

    const handlePromise = orchestrator.handleMessage(makeThreadMessage(), mockResponder as any);
    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));

    // Simulate read-only tool use (wiki_search) then respond(false)
    await calls[0].callbacks.onToolUse('wiki_search', { query: 'test' });
    await calls[0].callbacks.onToolUse('conversation_search', { query: 'test' });
    await simulateRespondAndResolve(calls[0], { directed_at_me: false, reason: 'just gathering context' });
    await handlePromise;

    expect(mockResponder.addReaction).not.toHaveBeenCalled();
    expect(mockResponder.updateResponse).not.toHaveBeenCalled();
  });

  it('should send multiple messages for multiple respond(true) calls in engaged thread', async () => {
    const { mockDatabase, mockConversationLogger, mockConstitutionManager, mockResponder, mockSlackClient } = createMocks();
    const { fn: sendMessage, calls } = createMockSendMessage();

    // Simulate an existing thread session
    mockDatabase.getThreadSession.mockReturnValue({ session_id: 'sess_thread', compaction_count: 0 });

    const orchestrator = new ScribbleOrchestrator({
      database: mockDatabase as any,
      sessionManager: { sendMessage } as any,
      conversationLogger: mockConversationLogger as any,
      constitutionManager: mockConstitutionManager as any,
      dataDir: '/tmp/test',
      slackClient: mockSlackClient,
    });

    const handlePromise = orchestrator.handleMessage(makeThreadMessage(), mockResponder as any);
    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));

    // Simulate two respond(true) calls
    await calls[0].callbacks.onToolUse('respond', {
      directed_at_me: true,
      reason: 'initial ack',
      message: 'Let me check...',
    });
    await calls[0].callbacks.onToolUse('wiki_search', { query: 'project status' });
    await calls[0].callbacks.onToolUse('respond', {
      directed_at_me: true,
      reason: 'found info',
      message: 'Here is what I found.',
    });

    calls[0].resolve({
      sessionId: 'sess_thread',
      text: '',
      stats: { contextTokens: 100, outputTokens: 50, costUsd: 0.01, durationMs: 500, compactionCount: 0 },
    });

    await handlePromise;

    // Should have sent both messages
    expect(mockResponder.updateResponse).toHaveBeenCalledTimes(2);
    expect(mockResponder.updateResponse).toHaveBeenCalledWith('Let me check...');
    expect(mockResponder.updateResponse).toHaveBeenCalledWith('Here is what I found.');
    expect(mockResponder.finalizeResponse).toHaveBeenCalledTimes(2);
  });

  it('should retry with system-reminder when freeform text but no respond call', async () => {
    const { mockDatabase, mockConversationLogger, mockConstitutionManager, mockResponder, mockSlackClient } = createMocks();
    const { fn: sendMessage, calls } = createMockSendMessage();

    const orchestrator = new ScribbleOrchestrator({
      database: mockDatabase as any,
      sessionManager: { sendMessage } as any,
      conversationLogger: mockConversationLogger as any,
      constitutionManager: mockConstitutionManager as any,
      dataDir: '/tmp/test',
      slackClient: mockSlackClient,
    });

    const handlePromise = orchestrator.handleMessage(makeChannelMessage(), mockResponder as any);
    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));

    // First call: Claude generates text but doesn't call respond
    await calls[0].callbacks.onText('I think I should help with this.');
    calls[0].resolve({
      sessionId: 'sess_123',
      text: 'I think I should help with this.',
      stats: { contextTokens: 100, outputTokens: 50, costUsd: 0.01, durationMs: 500, compactionCount: 0 },
    });

    // Wait for retry call
    await vi.waitFor(() => expect(calls.length).toBe(2));

    // Verify the retry message contains system-reminder about using respond tool
    const retryMessageArg = sendMessage.mock.calls[1][1];
    expect(retryMessageArg).toContain('respond tool');

    // Retry: Claude properly calls respond this time
    await simulateRespondAndResolve(calls[1], { directed_at_me: false, reason: 'not addressed' }, 'sess_123');

    await handlePromise;

    // Should stay silent since respond(false)
    expect(mockResponder.updateResponse).not.toHaveBeenCalled();
  });
});
