// scribble/src/__tests__/integration.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ScribbleOrchestrator } from '../orchestrator/scribbleOrchestrator.js';
import { ConversationLogger } from '../logging/conversationLogger.js';
import { ConstitutionManager } from '../constitution/manager.js';
import { CrossChannelContext } from '../context/crossChannelContext.js';
import { SessionDatabase } from '@primeradiant/bot-toolkit';
import * as fs from 'fs';

const TEST_DIR = '/tmp/scribble-integration-test';
const TEST_DB = `${TEST_DIR}/sessions.db`;

describe('Scribble Integration', () => {
  let database: SessionDatabase;
  let conversationLogger: ConversationLogger;
  let constitutionManager: ConstitutionManager;

  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
    fs.mkdirSync(`${TEST_DIR}/wiki/_scribble`, { recursive: true });

    database = new SessionDatabase(TEST_DB);
    conversationLogger = new ConversationLogger(TEST_DIR);
    constitutionManager = new ConstitutionManager(`${TEST_DIR}/wiki`);
  });

  afterEach(() => {
    database.close();
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
  });

  it('should save main session after channel message', async () => {
    // This test verifies the database integration
    database.saveMainSession('C123', {
      sessionId: 'sess_test',
      contextTokens: 1000,
      compactionCount: 0,
    });

    const session = database.getMainSession('C123');
    expect(session).not.toBeNull();
    expect(session!.session_id).toBe('sess_test');
  });

  it('should log channel messages to main.json', async () => {
    await conversationLogger.logChannelMessage({
      channelId: 'C123',
      channelName: 'general',
      threadTs: null,
      messageTs: '1234567890.000001',
      userId: 'U456',
      userName: 'Test User',
      text: 'Test message',
      isMention: false,
      isDm: false,
    });

    const context = await conversationLogger.getChannelContext('C123', 10);
    expect(context).toHaveLength(1);
    expect(context[0].text).toBe('Test message');
  });

  it('should build constitution with learned behaviors', () => {
    constitutionManager.addLearnedBehavior('Test behavior', 'U123', 'Testing');

    const constitution = constitutionManager.getFullConstitution();
    expect(constitution).toContain('Test behavior');
    expect(constitution).toContain('diligent colleague'); // Base constitution
  });
});

describe('ConversationLogger search enhancements', () => {
  let conversationLogger: ConversationLogger;

  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
    fs.mkdirSync(TEST_DIR, { recursive: true });
    conversationLogger = new ConversationLogger(TEST_DIR);
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
  });

  it('should filter search results by date', async () => {
    // Create test data in specific date directories
    const channelDir = `${TEST_DIR}/conversations/C123`;
    fs.mkdirSync(`${channelDir}/2026-01-29`, { recursive: true });
    fs.mkdirSync(`${channelDir}/2026-01-30`, { recursive: true });
    fs.mkdirSync(`${channelDir}/2026-01-31`, { recursive: true });

    // Write messages to different dates
    fs.writeFileSync(`${channelDir}/2026-01-29/main.md`, '### User (2026-01-29)\n\nOld searchable message\n\n---\n');
    fs.writeFileSync(`${channelDir}/2026-01-30/main.md`, '### User (2026-01-30)\n\nMiddle searchable message\n\n---\n');
    fs.writeFileSync(`${channelDir}/2026-01-31/main.md`, '### User (2026-01-31)\n\nNew searchable message\n\n---\n');

    // Search with single date filter - should only find that day
    const results = await conversationLogger.search('searchable', { date: '2026-01-30' });

    expect(results).toHaveLength(1);
    expect(results[0].date).toBe('2026-01-30');
    expect(results[0].snippet).toContain('Middle searchable message');
  });

  it('should filter search results by date range', async () => {
    // Create test data in specific date directories
    const channelDir = `${TEST_DIR}/conversations/C123`;
    fs.mkdirSync(`${channelDir}/2026-01-28`, { recursive: true });
    fs.mkdirSync(`${channelDir}/2026-01-29`, { recursive: true });
    fs.mkdirSync(`${channelDir}/2026-01-30`, { recursive: true });
    fs.mkdirSync(`${channelDir}/2026-01-31`, { recursive: true });

    // Write messages to different dates
    fs.writeFileSync(`${channelDir}/2026-01-28/main.md`, '### User (2026-01-28)\n\nToo old searchable message\n\n---\n');
    fs.writeFileSync(`${channelDir}/2026-01-29/main.md`, '### User (2026-01-29)\n\nStart range searchable message\n\n---\n');
    fs.writeFileSync(`${channelDir}/2026-01-30/main.md`, '### User (2026-01-30)\n\nEnd range searchable message\n\n---\n');
    fs.writeFileSync(`${channelDir}/2026-01-31/main.md`, '### User (2026-01-31)\n\nToo new searchable message\n\n---\n');

    // Search with date range filter - should find inclusive range
    const results = await conversationLogger.search('searchable', { date: '2026-01-29:2026-01-30' });

    expect(results).toHaveLength(2);
    const dates = results.map(r => r.date).sort();
    expect(dates).toEqual(['2026-01-29', '2026-01-30']);
  });

  it('should return context messages around search match', async () => {
    // Create test data with multiple messages in JSON format
    const channelDir = `${TEST_DIR}/conversations/C123`;
    fs.mkdirSync(`${channelDir}/2026-01-30`, { recursive: true });

    // Create markdown file for search to find
    fs.writeFileSync(`${channelDir}/2026-01-30/main.md`, '### User\n\nTarget keyword here\n\n---\n');

    // Create JSON file with message context
    const messages = [
      { role: 'user', userName: 'Alice', text: 'First context message', timestamp: '2026-01-30T10:00:00Z', messageTs: '1738234800.000001' },
      { role: 'assistant', userName: 'Scribble', text: 'Second context message', timestamp: '2026-01-30T10:01:00Z', messageTs: '1738234860.000001' },
      { role: 'user', userName: 'Bob', text: 'Target keyword here', timestamp: '2026-01-30T10:02:00Z', messageTs: '1738234920.000001' },
      { role: 'assistant', userName: 'Scribble', text: 'Fourth context message', timestamp: '2026-01-30T10:03:00Z', messageTs: '1738234980.000001' },
      { role: 'user', userName: 'Charlie', text: 'Fifth context message', timestamp: '2026-01-30T10:04:00Z', messageTs: '1738235040.000001' },
    ];
    fs.writeFileSync(`${channelDir}/2026-01-30/main.json`, JSON.stringify(messages, null, 2));

    // Search with context=1 should return 1 message before and 1 after the match
    const results = await conversationLogger.search('Target keyword', { context: 1 });

    expect(results).toHaveLength(1);
    expect(results[0].contextMessages).toBeDefined();
    expect(results[0].contextMessages).toHaveLength(3); // 1 before + match + 1 after
    expect(results[0].contextMessages![0].text).toBe('Second context message');
    expect(results[0].contextMessages![1].text).toBe('Target keyword here');
    expect(results[0].contextMessages![2].text).toBe('Fourth context message');
  });
});

describe('Cross-channel context integration', () => {
  let conversationLogger: ConversationLogger;

  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
    fs.mkdirSync(TEST_DIR, { recursive: true });
    conversationLogger = new ConversationLogger(TEST_DIR);
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
  });

  it('should gather context from other channels when responding', async () => {
    // Create conversation data in multiple channels
    const today = new Date().toISOString().split('T')[0];

    // Channel 1 - where the conversation is happening
    fs.mkdirSync(`${TEST_DIR}/conversations/C001/${today}`, { recursive: true });
    fs.writeFileSync(`${TEST_DIR}/conversations/C001/${today}/main.json`, JSON.stringify([
      { role: 'user', userId: 'U001', userName: 'Jesse', text: 'Current conversation', timestamp: new Date().toISOString(), messageTs: (Date.now() / 1000).toString() },
    ]));

    // Channel 2 - other activity
    fs.mkdirSync(`${TEST_DIR}/conversations/C002/${today}`, { recursive: true });
    fs.writeFileSync(`${TEST_DIR}/conversations/C002/${today}/main.json`, JSON.stringify([
      { role: 'user', userId: 'U002', userName: 'Drew', text: 'Activity in ops', timestamp: new Date().toISOString(), messageTs: (Date.now() / 1000).toString() },
    ]));

    // Mock Slack client
    const mockClient = {
      conversations: {
        list: async () => ({
          ok: true,
          channels: [
            { id: 'C001', name: 'general', is_member: true },
            { id: 'C002', name: 'ops', is_member: true },
          ],
        }),
      },
      users: {
        info: async ({ user }: { user: string }) => ({
          ok: true,
          user: { id: user, real_name: 'Test User', is_bot: false },
        }),
      },
    };

    const crossChannelContext = new CrossChannelContext(
      conversationLogger,
      mockClient as any,
      TEST_DIR
    );

    const context = await crossChannelContext.gather({
      excludeChannelId: 'C001',
      windowHours: 24,
      maxPerThread: 10,
    });

    expect(context).toContain('#ops');
    expect(context).toContain('Activity in ops');
    expect(context).not.toContain('Current conversation');
    expect(context).toContain('conversation_search');
  });
});
