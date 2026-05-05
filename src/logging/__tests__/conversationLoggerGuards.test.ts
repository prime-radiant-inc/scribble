import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ConversationLogger } from '../conversationLogger.js';

describe('ConversationLogger channel_id validation', () => {
  let dataDir: string;
  let logger: ConversationLogger;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scribble-test-'));
    const escapedDateDir = path.join(dataDir, 'wiki', '2026-05-05');
    fs.mkdirSync(escapedDateDir, { recursive: true });
    fs.writeFileSync(path.join(escapedDateDir, 'secret.md'), '### secret\n\nsecret content\n');
    fs.writeFileSync(path.join(escapedDateDir, 'main.md'), '### secret\n\nrecent secret content\n');
    fs.writeFileSync(path.join(escapedDateDir, 'main.json'), JSON.stringify([{
      role: 'user',
      userName: 'Eve',
      text: 'secret content',
      timestamp: '2026-05-05T00:00:00.000Z',
      messageTs: '1772816645.224219',
    }], null, 2));
    fs.writeFileSync(path.join(escapedDateDir, '1.0.json'), JSON.stringify([{
      role: 'user',
      userName: 'Eve',
      text: 'thread secret content',
      timestamp: '2026-05-05T00:00:00.000Z',
      messageTs: '1772816645.224219',
    }], null, 2));
    logger = new ConversationLogger(dataDir);
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('search rejects path-traversal channel_id', async () => {
    const results = await logger.search('secret', { channelId: '../wiki' });
    expect(results).toEqual([]);
  });

  it('search rejects malformed channel_id (lowercase)', async () => {
    const results = await logger.search('secret', { channelId: 'c123abc' });
    expect(results).toEqual([]);
  });

  it('search rejects empty channel_id', async () => {
    const results = await logger.search('secret', { channelId: '' });
    expect(results).toEqual([]);
  });

  it('search still works with omitted channel_id (global search)', async () => {
    const results = await logger.search('anything');
    expect(Array.isArray(results)).toBe(true);
  });

  it('getChannelContext rejects path-traversal channel_id', async () => {
    const results = await logger.getChannelContext('../wiki');
    expect(results).toEqual([]);
  });

  it('getThreadMessages rejects path-traversal channel_id', async () => {
    const results = await logger.getThreadMessages('../wiki', '1.0');
    expect(results).toEqual([]);
  });

  it('getRecentMessages rejects path-traversal channel_id', async () => {
    const results = await logger.getRecentMessages('../wiki');
    expect(results).toEqual([]);
  });

  it('logChannelMessage rejects path-traversal channel_id', async () => {
    const escapedMain = path.join(dataDir, 'wiki', '2026-05-05', 'main.md');
    const before = fs.readFileSync(escapedMain, 'utf-8');

    await logger.logChannelMessage({
      channelId: '../wiki',
      userId: 'U123',
      userName: 'Mallory',
      text: 'write escape content',
      messageTs: '1772816645.224219',
    });

    expect(fs.readFileSync(escapedMain, 'utf-8')).toBe(before);
  });

  it('logChannelMessage rejects malformed thread_ts', async () => {
    await logger.logChannelMessage({
      channelId: 'C0A93A7H820',
      userId: 'U123',
      userName: 'Mallory',
      text: 'thread escape content',
      messageTs: '1772816645.224219',
      threadTs: '../escape',
    });

    expect(fs.existsSync(path.join(dataDir, 'conversations', 'C0A93A7H820', 'escape.md'))).toBe(false);
    expect(fs.existsSync(path.join(dataDir, 'conversations', 'C0A93A7H820', 'escape.json'))).toBe(false);
  });

  it('logBotResponse rejects path-traversal channel_id', async () => {
    const escapedThread = path.join(dataDir, 'wiki', '2026-05-05', '1.0.json');
    const before = fs.readFileSync(escapedThread, 'utf-8');

    await logger.logBotResponse('../wiki', '1.0', 'response escape content', '1772816646.224219');

    expect(fs.readFileSync(escapedThread, 'utf-8')).toBe(before);
  });

  it('getThreadMessages rejects malformed thread_ts', async () => {
    const channelDir = path.join(dataDir, 'conversations', 'C0A93A7H820');
    fs.mkdirSync(channelDir, { recursive: true });
    fs.writeFileSync(path.join(channelDir, 'escape.json'), JSON.stringify([{
      role: 'user',
      userName: 'Mallory',
      text: 'escaped thread',
      timestamp: '2026-05-05T00:00:00.000Z',
      messageTs: '1772816645.224219',
    }], null, 2));

    const results = await logger.getThreadMessages('C0A93A7H820', '../escape');
    expect(results).toEqual([]);
  });

  it('valid Slack-shaped channel_id passes through', async () => {
    const results = await logger.search('anything', { channelId: 'C0A93A7H820' });
    expect(Array.isArray(results)).toBe(true);
  });
});
