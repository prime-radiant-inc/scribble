// scribble/src/orchestrator/__tests__/scribbleOrchestrator.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ScribbleOrchestrator } from '../scribbleOrchestrator.js';
import { Logger, type SessionCallbacks } from '@primeradiant/bot-toolkit';

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

  const mockSlackClient = {
    conversations: {
      list: vi.fn().mockResolvedValue({
        channels: [
          { id: 'C_DECISION', name: 'decision-log' },
          { id: 'C_GENERAL', name: 'general' },
        ],
      }),
    },
    chat: {
      getPermalink: vi.fn().mockResolvedValue({ permalink: 'https://slack.com/archives/C123/p123456' }),
      postMessage: vi.fn().mockResolvedValue({ ok: true }),
    },
    users: {
      info: vi.fn().mockResolvedValue({
        user: { real_name: 'Test User', profile: { display_name: 'testuser' }, name: 'testuser' },
      }),
    },
  } as any;

  return { mockDatabase, mockConversationLogger, mockConstitutionManager, mockResponder, mockSlackClient };
}

/** Format a Slack ts the same way the orchestrator does, for test assertions. */
function formatTestTimestamp(slackTs: string): string {
  const seconds = parseFloat(slackTs);
  if (isNaN(seconds)) return '';
  const tz = process.env.TZ || 'America/Los_Angeles';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: tz,
  }).format(new Date(seconds * 1000));
}

const DEFAULT_MESSAGE_ID = '1738368000.000100'; // Jan 31, 2025

function makeChannelMessage(overrides: Partial<any> = {}) {
  return {
    platform: 'slack' as const,
    channelId: 'C123',
    channelName: 'general',
    threadId: null,
    messageId: DEFAULT_MESSAGE_ID,
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
    messageId: DEFAULT_MESSAGE_ID,
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

  afterEach(() => {
    vi.restoreAllMocks();
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

  it('should post formatted message to #decision-log when log_decision is called', async () => {
    const { mockDatabase, mockConversationLogger, mockConstitutionManager, mockResponder, mockSlackClient } = createMocks();
    const { fn: sendMessage, calls } = createMockSendMessage();

    // Simulate an existing thread session so we go through handleEngagedThreadMessage
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

    // Simulate log_decision tool call then respond(false)
    await calls[0].callbacks.onToolUse('log_decision', {
      decision: 'We will use Postgres for the new service',
      tags: ['engineering', 'infrastructure'],
    });
    await simulateRespondAndResolve(calls[0], { directed_at_me: false, reason: 'logging decision silently' });
    await handlePromise;

    // Should have resolved channel and posted
    expect(mockSlackClient.conversations.list).toHaveBeenCalled();
    expect(mockSlackClient.chat.getPermalink).toHaveBeenCalledWith({
      channel: 'C123',
      message_ts: DEFAULT_MESSAGE_ID,
    });
    expect(mockSlackClient.chat.postMessage).toHaveBeenCalledWith({
      channel: 'C_DECISION',
      text: expect.stringContaining('We will use Postgres for the new service'),
    });
    // Verify format includes tags and permalink
    const postedText = mockSlackClient.chat.postMessage.mock.calls[0][0].text;
    expect(postedText).toContain('`engineering`');
    expect(postedText).toContain('`infrastructure`');
    expect(postedText).toContain('https://slack.com/archives/C123/p123456');
  });

  it('should silently skip log_decision with invalid input', async () => {
    const { mockDatabase, mockConversationLogger, mockConstitutionManager, mockResponder, mockSlackClient } = createMocks();
    const { fn: sendMessage, calls } = createMockSendMessage();

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

    // Simulate log_decision with invalid input (missing tags)
    await calls[0].callbacks.onToolUse('log_decision', {
      decision: 'Use Postgres',
    });
    await simulateRespondAndResolve(calls[0], { directed_at_me: false, reason: 'tried to log' });
    await handlePromise;

    // Should NOT have posted anything
    expect(mockSlackClient.chat.postMessage).not.toHaveBeenCalled();
  });

  it('should not crash when #decision-log channel is not found', async () => {
    const { mockDatabase, mockConversationLogger, mockConstitutionManager, mockResponder, mockSlackClient } = createMocks();
    const { fn: sendMessage, calls } = createMockSendMessage();

    // Override conversations.list to return no matching channel
    mockSlackClient.conversations.list.mockResolvedValue({ channels: [{ id: 'C_OTHER', name: 'random' }] });

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

    // Simulate log_decision
    await calls[0].callbacks.onToolUse('log_decision', {
      decision: 'Use Postgres',
      tags: ['engineering'],
    });
    await simulateRespondAndResolve(calls[0], { directed_at_me: false, reason: 'logging' });

    // Should complete without crashing
    await handlePromise;
    expect(mockSlackClient.chat.postMessage).not.toHaveBeenCalled();
  });

  it('should post decisions from channel messages (not just threads)', async () => {
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

    // Simulate log_decision then respond(false)
    await calls[0].callbacks.onToolUse('log_decision', {
      decision: 'Approved the Q3 budget',
      tags: ['finance'],
    });
    await simulateRespondAndResolve(calls[0], { directed_at_me: false, reason: 'logging decision' });
    await handlePromise;

    expect(mockSlackClient.chat.postMessage).toHaveBeenCalledWith({
      channel: 'C_DECISION',
      text: expect.stringContaining('Approved the Q3 budget'),
    });
  });

  it('should include attachment metadata in message sent to Claude', async () => {
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

    const message = makeChannelMessage({
      text: 'Can you review this transcript?',
      attachments: [
        {
          localPath: '/data/rooms/slack-C123/downloads/123-meeting-notes.txt',
          originalName: 'meeting-notes.txt',
          mimeType: 'text/plain',
          size: 4096,
        },
      ],
    });

    const handlePromise = orchestrator.handleMessage(message, mockResponder as any);
    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));

    // Verify the message sent to Claude includes sender prefix and attachment info
    const sentMessage = sendMessage.mock.calls[0][1];
    expect(sentMessage).toMatch(/^\[Test User \| .+\]: Can you review this transcript\?/);
    expect(sentMessage).toContain('<attachment>');
    expect(sentMessage).toContain('meeting-notes.txt');
    expect(sentMessage).toContain('text/plain');
    expect(sentMessage).toContain('4096');
    expect(sentMessage).toContain('/data/rooms/slack-C123/downloads/123-meeting-notes.txt');

    await simulateRespondAndResolve(calls[0], { directed_at_me: false, reason: 'not addressed' });
    await handlePromise;
  });

  it('should include multiple attachments in message sent to Claude', async () => {
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

    const message = makeChannelMessage({
      text: 'Here are two files',
      attachments: [
        {
          localPath: '/data/rooms/slack-C123/downloads/report.pdf',
          originalName: 'report.pdf',
          mimeType: 'application/pdf',
          size: 102400,
        },
        {
          localPath: '/data/rooms/slack-C123/downloads/data.csv',
          originalName: 'data.csv',
          mimeType: 'text/csv',
          size: 2048,
        },
      ],
    });

    const handlePromise = orchestrator.handleMessage(message, mockResponder as any);
    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));

    const sentMessage = sendMessage.mock.calls[0][1];
    expect(sentMessage).toContain('report.pdf');
    expect(sentMessage).toContain('data.csv');
    // Should have two attachment blocks
    expect(sentMessage.match(/<attachment>/g)?.length).toBe(2);

    await simulateRespondAndResolve(calls[0], { directed_at_me: false, reason: 'not addressed' });
    await handlePromise;
  });

  it('should include attachments in thread messages sent to Claude', async () => {
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

    const message = makeThreadMessage({
      text: 'Here is the file you asked for',
      attachments: [
        {
          localPath: '/data/rooms/slack-C123/downloads/spec.md',
          originalName: 'spec.md',
          mimeType: 'text/markdown',
          size: 8192,
        },
      ],
    });

    const handlePromise = orchestrator.handleMessage(message, mockResponder as any);
    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));

    const sentMessage = sendMessage.mock.calls[0][1];
    expect(sentMessage).toContain('spec.md');
    expect(sentMessage).toContain('<attachment>');

    await simulateRespondAndResolve(calls[0], { directed_at_me: false, reason: 'not addressed' });
    await handlePromise;
  });

  it('should not add attachment tags when message has no attachments', async () => {
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

    const sentMessage = sendMessage.mock.calls[0][1];
    const ts = formatTestTimestamp(DEFAULT_MESSAGE_ID);
    expect(sentMessage).toBe(`[Test User | ${ts}]: Hello room`);
    expect(sentMessage).not.toContain('<attachment>');

    await simulateRespondAndResolve(calls[0], { directed_at_me: false, reason: 'not addressed' });
    await handlePromise;
  });

  it('should prefix messages with sender display name', async () => {
    const { mockDatabase, mockConversationLogger, mockConstitutionManager, mockResponder, mockSlackClient } = createMocks();
    const { fn: sendMessage, calls } = createMockSendMessage();

    mockSlackClient.users.info.mockResolvedValue({
      user: { real_name: 'Jesse Kriss', profile: { display_name: 'jesse' }, name: 'jesse' },
    });

    const orchestrator = new ScribbleOrchestrator({
      database: mockDatabase as any,
      sessionManager: { sendMessage } as any,
      conversationLogger: mockConversationLogger as any,
      constitutionManager: mockConstitutionManager as any,
      dataDir: '/tmp/test',
      slackClient: mockSlackClient,
    });

    const handlePromise = orchestrator.handleMessage(
      makeChannelMessage({ senderId: 'U_JESSE', text: 'Hey scribble, what do you think?' }),
      mockResponder as any,
    );
    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));

    const sentMessage = sendMessage.mock.calls[0][1];
    const ts = formatTestTimestamp(DEFAULT_MESSAGE_ID);
    expect(sentMessage).toBe(`[Jesse Kriss | ${ts}]: Hey scribble, what do you think?`);

    await simulateRespondAndResolve(calls[0], { directed_at_me: false, reason: 'not addressed' });
    await handlePromise;
  });

  it('should resolve @mentions in message text to display names', async () => {
    const { mockDatabase, mockConversationLogger, mockConstitutionManager, mockResponder, mockSlackClient } = createMocks();
    const { fn: sendMessage, calls } = createMockSendMessage();

    // Mock different responses for different user IDs
    mockSlackClient.users.info.mockImplementation(async ({ user }: { user: string }) => {
      if (user === 'U_JESSE') return { user: { real_name: 'Jesse Kriss', profile: { display_name: 'jesse' }, name: 'jesse' } };
      if (user === 'U_DREW') return { user: { real_name: 'Drew', profile: { display_name: 'drew' }, name: 'drew' } };
      throw new Error('User not found');
    });

    const orchestrator = new ScribbleOrchestrator({
      database: mockDatabase as any,
      sessionManager: { sendMessage } as any,
      conversationLogger: mockConversationLogger as any,
      constitutionManager: mockConstitutionManager as any,
      dataDir: '/tmp/test',
      slackClient: mockSlackClient,
    });

    const handlePromise = orchestrator.handleMessage(
      makeChannelMessage({
        senderId: 'U_JESSE',
        text: 'Hey <@U_DREW> do you need me to do something?',
      }),
      mockResponder as any,
    );
    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));

    const sentMessage = sendMessage.mock.calls[0][1];
    const ts = formatTestTimestamp(DEFAULT_MESSAGE_ID);
    expect(sentMessage).toBe(`[Jesse Kriss | ${ts}]: Hey @Drew (<@U_DREW>) do you need me to do something?`);

    await simulateRespondAndResolve(calls[0], { directed_at_me: false, reason: 'not addressed' });
    await handlePromise;
  });

  it('should fall back to user ID when name lookup fails', async () => {
    const { mockDatabase, mockConversationLogger, mockConstitutionManager, mockResponder, mockSlackClient } = createMocks();
    const { fn: sendMessage, calls } = createMockSendMessage();

    mockSlackClient.users.info.mockRejectedValue(new Error('API error'));

    const orchestrator = new ScribbleOrchestrator({
      database: mockDatabase as any,
      sessionManager: { sendMessage } as any,
      conversationLogger: mockConversationLogger as any,
      constitutionManager: mockConstitutionManager as any,
      dataDir: '/tmp/test',
      slackClient: mockSlackClient,
    });

    const handlePromise = orchestrator.handleMessage(
      makeChannelMessage({ senderId: 'U_UNKNOWN', text: 'Hello' }),
      mockResponder as any,
    );
    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));

    const sentMessage = sendMessage.mock.calls[0][1];
    const ts = formatTestTimestamp(DEFAULT_MESSAGE_ID);
    expect(sentMessage).toBe(`[U_UNKNOWN | ${ts}]: Hello`);

    await simulateRespondAndResolve(calls[0], { directed_at_me: false, reason: 'not addressed' });
    await handlePromise;
  });

  it('should cache user name lookups across messages', async () => {
    const { mockDatabase, mockConversationLogger, mockConstitutionManager, mockResponder, mockSlackClient } = createMocks();
    const { fn: sendMessage, calls } = createMockSendMessage();

    mockSlackClient.users.info.mockResolvedValue({
      user: { real_name: 'Jesse Kriss', profile: { display_name: 'jesse' }, name: 'jesse' },
    });

    const orchestrator = new ScribbleOrchestrator({
      database: mockDatabase as any,
      sessionManager: { sendMessage } as any,
      conversationLogger: mockConversationLogger as any,
      constitutionManager: mockConstitutionManager as any,
      dataDir: '/tmp/test',
      slackClient: mockSlackClient,
    });

    // First message
    const handlePromise1 = orchestrator.handleMessage(
      makeChannelMessage({ senderId: 'U_JESSE', text: 'Hello' }),
      mockResponder as any,
    );
    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));
    await simulateRespondAndResolve(calls[0], { directed_at_me: false, reason: 'not addressed' });
    await handlePromise1;

    // Second message from same user
    const handlePromise2 = orchestrator.handleMessage(
      makeChannelMessage({ senderId: 'U_JESSE', text: 'How are things?', messageId: '124.456' }),
      mockResponder as any,
    );
    await vi.waitFor(() => expect(calls.length).toBe(2));
    await simulateRespondAndResolve(calls[1], { directed_at_me: false, reason: 'not addressed' });
    await handlePromise2;

    // Should have called users.info only once despite two messages
    expect(mockSlackClient.users.info).toHaveBeenCalledTimes(1);
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
    expect(retryMessageArg).toContain('`respond` tool');

    // Retry: Claude properly calls respond this time
    await simulateRespondAndResolve(calls[1], { directed_at_me: false, reason: 'not addressed' }, 'sess_123');

    await handlePromise;

    // Should stay silent since respond(false)
    expect(mockResponder.updateResponse).not.toHaveBeenCalled();
  });

  it('retries when respond is called with invalid input and freeform text was emitted', async () => {
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

    await calls[0].callbacks.onText('I think I should help with this.');
    await calls[0].callbacks.onToolUse('respond', { foo: 'bar' });
    calls[0].resolve({
      sessionId: 'sess_123',
      text: 'I think I should help with this.',
      stats: { contextTokens: 100, outputTokens: 50, costUsd: 0.01, durationMs: 500, compactionCount: 0 },
    });

    await vi.waitFor(() => expect(calls.length).toBe(2));

    const retryMessageArg = sendMessage.mock.calls[1][1];
    expect(retryMessageArg).toContain('<system-reminder>');
    expect(retryMessageArg).toContain('`respond` tool');

    await simulateRespondAndResolve(calls[1], { directed_at_me: false, reason: 'silent' }, 'sess_123');

    await handlePromise;

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(mockResponder.updateResponse).not.toHaveBeenCalled();
  });

  it('should post threaded reply when slack_reply tool is called', async () => {
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

    // Simulate slack_reply tool call then respond(false)
    await calls[0].callbacks.onToolUse('slack_reply', {
      channel_id: 'C0STANDUP1',
      thread_ts: '1772816645.224219',
      message: 'How did yesterday go?',
    });
    await simulateRespondAndResolve(calls[0], { directed_at_me: false, reason: 'replied in thread' });
    await handlePromise;

    // Should have posted a threaded reply via Slack client
    expect(mockSlackClient.chat.postMessage).toHaveBeenCalledWith({
      channel: 'C0STANDUP1',
      thread_ts: '1772816645.224219',
      text: 'How did yesterday go?',
    });
  });

  it('should post multiple threaded replies from a single message', async () => {
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

    // Simulate two slack_reply calls to different threads
    await calls[0].callbacks.onToolUse('slack_reply', {
      channel_id: 'C0STANDUP1',
      thread_ts: '1772816645.224219',
      message: 'How did yesterday go, Drew?',
    });
    await calls[0].callbacks.onToolUse('slack_reply', {
      channel_id: 'C0STANDUP1',
      thread_ts: '1772817545.941279',
      message: 'How did yesterday go, Jesse?',
    });
    await simulateRespondAndResolve(calls[0], { directed_at_me: false, reason: 'replied to standups' });
    await handlePromise;

    expect(mockSlackClient.chat.postMessage).toHaveBeenCalledTimes(2);
    expect(mockSlackClient.chat.postMessage).toHaveBeenCalledWith({
      channel: 'C0STANDUP1',
      thread_ts: '1772816645.224219',
      text: 'How did yesterday go, Drew?',
    });
    expect(mockSlackClient.chat.postMessage).toHaveBeenCalledWith({
      channel: 'C0STANDUP1',
      thread_ts: '1772817545.941279',
      text: 'How did yesterday go, Jesse?',
    });
  });

  it('should silently skip slack_reply with invalid input', async () => {
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

    // Missing thread_ts
    await calls[0].callbacks.onToolUse('slack_reply', {
      channel_id: 'C0STANDUP1',
      message: 'Hello',
    });
    await simulateRespondAndResolve(calls[0], { directed_at_me: false, reason: 'tried to reply' });
    await handlePromise;

    expect(mockSlackClient.chat.postMessage).not.toHaveBeenCalled();
  });

  describe('orchestrator log scrubbing', () => {
    it('Respond tool captured log omits raw input, includes name and lengths', async () => {
      const debugSpy = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});
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
      await simulateRespondAndResolve(calls[0], {
        directed_at_me: false,
        reason: 'asked a question',
        message: 'Here is the answer.',
      });
      await handlePromise;

      const captured = debugSpy.mock.calls.find(call => String(call[0]).includes('Respond tool captured'));
      expect(captured).toBeDefined();
      const meta = captured![1] as Record<string, unknown>;
      expect(meta).not.toHaveProperty('input');
      expect(meta).toHaveProperty('name');
      expect(meta).toHaveProperty('directedAtMe');
      expect(meta).toHaveProperty('messageLength', 'Here is the answer.'.length);
    });

    it('Invalid log_decision warn omits raw input, includes keys and lengths', async () => {
      const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
      const { mockDatabase, mockConversationLogger, mockConstitutionManager, mockResponder, mockSlackClient } = createMocks();
      const { fn: sendMessage, calls } = createMockSendMessage();

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
      await calls[0].callbacks.onToolUse('log_decision', {
        decision: 'Sensitive decision text',
      });
      await simulateRespondAndResolve(calls[0], { directed_at_me: false, reason: 'tried to log' });
      await handlePromise;

      const captured = warnSpy.mock.calls.find(call => String(call[0]).includes('Invalid log_decision'));
      expect(captured).toBeDefined();
      const meta = captured![1] as Record<string, unknown>;
      expect(meta).not.toHaveProperty('input');
      expect(meta).toHaveProperty('keys');
      expect(meta).toHaveProperty('inputType');
      expect(meta).toHaveProperty('decisionLength', 'Sensitive decision text'.length);
    });

    it('Invalid slack_reply warn omits raw input, includes keys and lengths', async () => {
      const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
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
      await calls[0].callbacks.onToolUse('slack_reply', {
        channel_id: 'C0STANDUP1',
        message: 'Sensitive reply text',
      });
      await simulateRespondAndResolve(calls[0], { directed_at_me: false, reason: 'tried to reply' });
      await handlePromise;

      const captured = warnSpy.mock.calls.find(call => String(call[0]).includes('Invalid slack_reply'));
      expect(captured).toBeDefined();
      const meta = captured![1] as Record<string, unknown>;
      expect(meta).not.toHaveProperty('input');
      expect(meta).toHaveProperty('keys');
      expect(meta).toHaveProperty('channelIdPresent', true);
      expect(meta).toHaveProperty('threadTsPresent', false);
      expect(meta).toHaveProperty('messageLength', 'Sensitive reply text'.length);
    });

    it('Failed to post decision error omits decision text', async () => {
      const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      const { mockDatabase, mockConversationLogger, mockConstitutionManager, mockResponder, mockSlackClient } = createMocks();
      const { fn: sendMessage, calls } = createMockSendMessage();
      const decision = 'Sensitive decision text';

      mockDatabase.getThreadSession.mockReturnValue({ session_id: 'sess_thread', compaction_count: 0 });
      mockSlackClient.chat.postMessage.mockRejectedValue(new Error('Slack unavailable'));

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
      await calls[0].callbacks.onToolUse('log_decision', {
        decision,
        tags: ['engineering', 'infrastructure'],
      });
      await simulateRespondAndResolve(calls[0], { directed_at_me: false, reason: 'logging decision' });
      await handlePromise;

      const captured = errorSpy.mock.calls.find(call => String(call[0]).includes('Failed to post decision'));
      expect(captured).toBeDefined();
      const meta = captured![1] as Record<string, unknown>;
      expect(meta).not.toHaveProperty('decision');
      expect(meta).toHaveProperty('error');
      expect(meta).toHaveProperty('decisionLength', decision.length);
      expect(meta).toHaveProperty('tagCount', 2);
    });
  });
});
