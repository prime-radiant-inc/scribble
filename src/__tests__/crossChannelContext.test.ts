import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CrossChannelContext, CrossChannelContextOptions } from '../context/crossChannelContext.js';
import { ConversationLogger } from '../logging/conversationLogger.js';
import type { WebClient } from '@slack/web-api';
import * as fs from 'fs';
import * as path from 'path';

const TEST_DIR = '/tmp/scribble-test-cross-channel';

// Helper to create a mock WebClient
function createMockSlackClient(channels: Array<{ id: string; name: string; is_member: boolean }>): WebClient {
  return {
    conversations: {
      list: vi.fn().mockResolvedValue({
        ok: true,
        channels: channels.map(c => ({
          id: c.id,
          name: c.name,
          is_member: c.is_member,
        })),
      }),
    },
    users: {
      info: vi.fn().mockImplementation(async ({ user }: { user: string }) => {
        const users: Record<string, { name: string; is_bot: boolean }> = {
          'U001': { name: 'Jesse', is_bot: false },
          'U002': { name: 'Drew', is_bot: false },
          'U003': { name: 'Scribble', is_bot: true },
        };
        const userInfo = users[user];
        if (userInfo) {
          return {
            ok: true,
            user: {
              id: user,
              real_name: userInfo.name,
              is_bot: userInfo.is_bot,
            },
          };
        }
        return { ok: false };
      }),
    },
  } as unknown as WebClient;
}

// Helper to write a conversation log file
function writeConversationLog(
  channelId: string,
  dateStr: string,
  threadTs: string,
  messages: Array<{ userId: string; userName: string; text: string; messageTs: string; role?: 'user' | 'assistant' }>
) {
  const dir = path.join(TEST_DIR, 'conversations', channelId, dateStr);
  fs.mkdirSync(dir, { recursive: true });

  const storedMessages = messages.map(m => ({
    role: m.role ?? 'user',
    userId: m.userId,
    userName: m.userName,
    text: m.text,
    timestamp: new Date(parseFloat(m.messageTs) * 1000).toISOString(),
    messageTs: m.messageTs,
  }));

  const jsonPath = path.join(dir, `${threadTs}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(storedMessages, null, 2));

  // Also write markdown for completeness
  const mdPath = path.join(dir, `${threadTs}.md`);
  const mdContent = messages.map(m => {
    const ts = new Date(parseFloat(m.messageTs) * 1000).toISOString();
    return `### ${m.userName} (${ts})\n\n${m.text}\n\n---\n\n`;
  }).join('');
  fs.writeFileSync(mdPath, mdContent);
}

describe('CrossChannelContext', () => {
  let conversationLogger: ConversationLogger;
  let mockSlackClient: WebClient;

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

  describe('gather', () => {
    it('excludes current channel from context', async () => {
      mockSlackClient = createMockSlackClient([
        { id: 'C001', name: 'general', is_member: true },
        { id: 'C002', name: 'ops', is_member: true },
      ]);

      const today = new Date().toISOString().split('T')[0];
      const recentTs = (Date.now() / 1000 - 3600).toString(); // 1 hour ago

      // Write messages in both channels
      writeConversationLog('C001', today, 'main', [
        { userId: 'U001', userName: 'Jesse', text: 'Hello general', messageTs: recentTs },
      ]);
      writeConversationLog('C002', today, 'main', [
        { userId: 'U002', userName: 'Drew', text: 'Hello ops', messageTs: recentTs },
      ]);

      const context = new CrossChannelContext(conversationLogger, mockSlackClient, TEST_DIR);
      const result = await context.gather({
        excludeChannelId: 'C001',
        windowHours: 24,
        maxPerThread: 10,
      });

      // Should include C002 but not C001
      expect(result).toContain('#ops (C002)');
      expect(result).toContain('Drew (U002)');
      expect(result).toContain('Hello ops');
      expect(result).not.toContain('#general (C001)');
      expect(result).not.toContain('Hello general');
    });

    it('formats messages with Name (ID) and timestamp', async () => {
      mockSlackClient = createMockSlackClient([
        { id: 'C001', name: 'general', is_member: true },
        { id: 'C002', name: 'ops', is_member: true },
      ]);

      const today = new Date().toISOString().split('T')[0];
      const recentTs = (Date.now() / 1000 - 3600).toString(); // 1 hour ago

      writeConversationLog('C002', today, 'main', [
        { userId: 'U001', userName: 'Jesse', text: 'Test message', messageTs: recentTs },
      ]);

      const context = new CrossChannelContext(conversationLogger, mockSlackClient, TEST_DIR);
      const result = await context.gather({
        excludeChannelId: 'C001',
        windowHours: 24,
        maxPerThread: 10,
      });

      // Should format as "Name (ID) [timestamp]: message"
      expect(result).toMatch(/Jesse \(U001\) \[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\]: Test message/);
    });

    it('truncates long messages', async () => {
      mockSlackClient = createMockSlackClient([
        { id: 'C001', name: 'general', is_member: true },
        { id: 'C002', name: 'ops', is_member: true },
      ]);

      const today = new Date().toISOString().split('T')[0];
      const longMessage = 'a'.repeat(600);
      const recentTs = (Date.now() / 1000 - 3600).toString(); // 1 hour ago

      writeConversationLog('C002', today, 'main', [
        { userId: 'U001', userName: 'Jesse', text: longMessage, messageTs: recentTs },
      ]);

      const context = new CrossChannelContext(conversationLogger, mockSlackClient, TEST_DIR);
      const result = await context.gather({
        excludeChannelId: 'C001',
        windowHours: 24,
        maxPerThread: 10,
      });

      // Should be truncated (not contain full 600 a's)
      expect(result).not.toContain('a'.repeat(600));
      // Should contain truncation indicator
      expect(result).toContain('[100 chars]');
    });

    it('limits messages per thread to maxPerThread', async () => {
      mockSlackClient = createMockSlackClient([
        { id: 'C001', name: 'general', is_member: true },
        { id: 'C002', name: 'ops', is_member: true },
      ]);

      const today = new Date().toISOString().split('T')[0];
      const baseTs = Date.now() / 1000 - 3600; // 1 hour ago

      // Write 15 messages in a thread
      const messages = Array.from({ length: 15 }, (_, i) => ({
        userId: 'U001',
        userName: 'Jesse',
        text: `Message ${i + 1}`,
        messageTs: `${baseTs + i}`,
      }));

      const threadTs = `${baseTs}`;
      writeConversationLog('C002', today, threadTs, messages);

      const context = new CrossChannelContext(conversationLogger, mockSlackClient, TEST_DIR);
      const result = await context.gather({
        excludeChannelId: 'C001',
        windowHours: 24,
        maxPerThread: 5,
      });

      // Should only contain the last 5 messages (11-15)
      expect(result).toContain('Message 15');
      expect(result).toContain('Message 11');
      expect(result).not.toContain('Message 1:');
      expect(result).not.toContain('Message 10:');
    });

    it('includes conversation_search hint', async () => {
      mockSlackClient = createMockSlackClient([
        { id: 'C001', name: 'general', is_member: true },
        { id: 'C002', name: 'ops', is_member: true },
      ]);

      const today = new Date().toISOString().split('T')[0];
      const recentTs = (Date.now() / 1000 - 3600).toString(); // 1 hour ago

      writeConversationLog('C002', today, 'main', [
        { userId: 'U001', userName: 'Jesse', text: 'Test', messageTs: recentTs },
      ]);

      const context = new CrossChannelContext(conversationLogger, mockSlackClient, TEST_DIR);
      const result = await context.gather({
        excludeChannelId: 'C001',
        windowHours: 24,
        maxPerThread: 10,
      });

      expect(result).toContain('conversation_search');
      expect(result).toContain('<background-context');
    });

    it('groups threads under channel', async () => {
      mockSlackClient = createMockSlackClient([
        { id: 'C001', name: 'general', is_member: true },
        { id: 'C002', name: 'ops', is_member: true },
      ]);

      const today = new Date().toISOString().split('T')[0];
      const baseTs = Date.now() / 1000 - 3600; // 1 hour ago

      // Main channel message
      writeConversationLog('C002', today, 'main', [
        { userId: 'U001', userName: 'Jesse', text: 'Main channel message', messageTs: `${baseTs}` },
      ]);

      // Thread message
      const threadTs = `${baseTs + 100}`;
      writeConversationLog('C002', today, threadTs, [
        { userId: 'U002', userName: 'Drew', text: 'CI is failing again', messageTs: `${baseTs + 100}` },
        { userId: 'U001', userName: 'Jesse', text: 'I will check it', messageTs: `${baseTs + 200}` },
      ]);

      const context = new CrossChannelContext(conversationLogger, mockSlackClient, TEST_DIR);
      const result = await context.gather({
        excludeChannelId: 'C001',
        windowHours: 24,
        maxPerThread: 10,
      });

      // Should have channel header
      expect(result).toContain('#ops (C002)');
      // Should have thread indicator with first 30 chars of first message
      expect(result).toContain('Thread:');
      expect(result).toContain('CI is failing again');
    });

    it('excludes messages outside time window', async () => {
      mockSlackClient = createMockSlackClient([
        { id: 'C001', name: 'general', is_member: true },
        { id: 'C002', name: 'ops', is_member: true },
      ]);

      // Create a date 2 days ago
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
      const oldDate = twoDaysAgo.toISOString().split('T')[0];
      const today = new Date().toISOString().split('T')[0];

      // Write old message
      writeConversationLog('C002', oldDate, 'main', [
        { userId: 'U001', userName: 'Jesse', text: 'Old message', messageTs: '1706600000.000001' },
      ]);

      // Write recent message
      const recentTs = (Date.now() / 1000 - 3600).toString(); // 1 hour ago
      writeConversationLog('C002', today, 'main', [
        { userId: 'U002', userName: 'Drew', text: 'Recent message', messageTs: recentTs },
      ]);

      const context = new CrossChannelContext(conversationLogger, mockSlackClient, TEST_DIR);
      const result = await context.gather({
        excludeChannelId: 'C001',
        windowHours: 24,
        maxPerThread: 10,
      });

      expect(result).toContain('Recent message');
      expect(result).not.toContain('Old message');
    });

    it('filters messages after afterTimestamps when provided', async () => {
      mockSlackClient = createMockSlackClient([
        { id: 'C001', name: 'general', is_member: true },
        { id: 'C002', name: 'ops', is_member: true },
      ]);

      const today = new Date().toISOString().split('T')[0];
      const baseTs = Date.now() / 1000 - 3600; // 1 hour ago

      writeConversationLog('C002', today, 'main', [
        { userId: 'U001', userName: 'Jesse', text: 'First message', messageTs: `${baseTs}` },
        { userId: 'U002', userName: 'Drew', text: 'Second message', messageTs: `${baseTs + 100}` },
        { userId: 'U001', userName: 'Jesse', text: 'Third message', messageTs: `${baseTs + 200}` },
      ]);

      const context = new CrossChannelContext(conversationLogger, mockSlackClient, TEST_DIR);

      // Set afterTimestamps to after the first message
      const afterTimestamps = new Map<string, string>();
      afterTimestamps.set('C002:main', `${baseTs + 50}`);

      const result = await context.gather({
        excludeChannelId: 'C001',
        afterTimestamps,
        windowHours: 24,
        maxPerThread: 10,
      });

      expect(result).not.toContain('First message');
      expect(result).toContain('Second message');
      expect(result).toContain('Third message');
    });

    it('returns empty string when no channels have activity', async () => {
      mockSlackClient = createMockSlackClient([
        { id: 'C001', name: 'general', is_member: true },
      ]);

      const context = new CrossChannelContext(conversationLogger, mockSlackClient, TEST_DIR);
      const result = await context.gather({
        excludeChannelId: 'C001',
        windowHours: 24,
        maxPerThread: 10,
      });

      expect(result).toBe('');
    });

    it('only includes channels where bot is a member', async () => {
      mockSlackClient = createMockSlackClient([
        { id: 'C001', name: 'general', is_member: true },
        { id: 'C002', name: 'ops', is_member: true },
        { id: 'C003', name: 'private', is_member: false },
      ]);

      const today = new Date().toISOString().split('T')[0];
      const recentTs = (Date.now() / 1000 - 3600).toString();

      // Write messages in all channels
      writeConversationLog('C002', today, 'main', [
        { userId: 'U001', userName: 'Jesse', text: 'Ops message', messageTs: recentTs },
      ]);
      writeConversationLog('C003', today, 'main', [
        { userId: 'U001', userName: 'Jesse', text: 'Private message', messageTs: recentTs },
      ]);

      const context = new CrossChannelContext(conversationLogger, mockSlackClient, TEST_DIR);
      const result = await context.gather({
        excludeChannelId: 'C001',
        windowHours: 24,
        maxPerThread: 10,
      });

      expect(result).toContain('Ops message');
      expect(result).not.toContain('Private message');
    });

    it('includes source file path in output', async () => {
      mockSlackClient = createMockSlackClient([
        { id: 'C001', name: 'general', is_member: true },
        { id: 'C002', name: 'ops', is_member: true },
      ]);

      const today = new Date().toISOString().split('T')[0];
      const recentTs = (Date.now() / 1000 - 3600).toString();

      writeConversationLog('C002', today, 'main', [
        { userId: 'U001', userName: 'Jesse', text: 'Test message', messageTs: recentTs },
      ]);

      const context = new CrossChannelContext(conversationLogger, mockSlackClient, TEST_DIR);
      const result = await context.gather({
        excludeChannelId: 'C001',
        windowHours: 24,
        maxPerThread: 10,
      });

      expect(result).toContain('Source:');
      expect(result).toContain('main.md');
    });

    it('excludes current thread when excludeThreadTs is provided', async () => {
      mockSlackClient = createMockSlackClient([
        { id: 'C001', name: 'general', is_member: true },
        { id: 'C002', name: 'ops', is_member: true },
      ]);

      const today = new Date().toISOString().split('T')[0];
      const recentTs = (Date.now() / 1000 - 3600).toString();

      // Write to C002 main
      writeConversationLog('C002', today, 'main', [
        { userId: 'U001', userName: 'Jesse', text: 'Main ops message', messageTs: recentTs },
      ]);

      // Write to a thread in C002
      writeConversationLog('C002', today, '1706720100.000001', [
        { userId: 'U002', userName: 'Drew', text: 'Thread message to exclude', messageTs: recentTs },
      ]);

      const context = new CrossChannelContext(conversationLogger, mockSlackClient, TEST_DIR);
      const result = await context.gather({
        excludeChannelId: 'C001',
        excludeThreadTs: '1706720100.000001',
        windowHours: 24,
        maxPerThread: 10,
      });

      expect(result).toContain('Main ops message');
      expect(result).not.toContain('Thread message to exclude');
    });
  });
});
