import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConversationLogger } from '../conversationLogger.js';
import * as fs from 'fs';
import * as path from 'path';

const TEST_DIR = '/tmp/scribble-test-conversations';

describe('ConversationLogger - Main/Thread Split', () => {
  let logger: ConversationLogger;
  const channelId = 'C0A93A7H820';

  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
    logger = new ConversationLogger(TEST_DIR);
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
  });

  describe('channel messages', () => {
    it('should log channel messages to main.md', async () => {
      await logger.logChannelMessage({
        channelId,
        channelName: 'general',
        threadTs: null,
        messageTs: '1234567890.000001',
        userId: 'U456',
        userName: 'Alice',
        text: 'Hello everyone!',
        isMention: false,
        isDm: false,
      });

      const dateStr = new Date().toISOString().split('T')[0];
      const mainFile = path.join(TEST_DIR, 'conversations', channelId, dateStr, 'main.md');
      expect(fs.existsSync(mainFile)).toBe(true);
      const content = fs.readFileSync(mainFile, 'utf-8');
      expect(content).toContain('Alice');
      expect(content).toContain('Hello everyone!');
    });

    it('should log thread messages to thread file', async () => {
      await logger.logChannelMessage({
        channelId,
        channelName: 'general',
        threadTs: '1234567890.000001',
        messageTs: '1234567890.000002',
        userId: 'U456',
        userName: 'Bob',
        text: 'Thread reply',
        isMention: false,
        isDm: false,
      });

      const dateStr = new Date().toISOString().split('T')[0];
      const threadFile = path.join(TEST_DIR, 'conversations', channelId, dateStr, '1234567890.000001.md');
      expect(fs.existsSync(threadFile)).toBe(true);
      const content = fs.readFileSync(threadFile, 'utf-8');
      expect(content).toContain('Bob');
      expect(content).toContain('Thread reply');
    });
  });

  describe('getChannelContext', () => {
    it('should retrieve recent channel messages', async () => {
      await logger.logChannelMessage({
        channelId,
        channelName: 'general',
        threadTs: null,
        messageTs: '1234567890.000001',
        userId: 'U1',
        userName: 'Alice',
        text: 'First message',
        isMention: false,
        isDm: false,
      });

      await logger.logChannelMessage({
        channelId,
        channelName: 'general',
        threadTs: null,
        messageTs: '1234567890.000002',
        userId: 'U2',
        userName: 'Bob',
        text: 'Second message',
        isMention: false,
        isDm: false,
      });

      const context = await logger.getChannelContext(channelId, 10);
      expect(context).toHaveLength(2);
      expect(context[0].text).toBe('First message');
      expect(context[1].text).toBe('Second message');
    });
  });
});
