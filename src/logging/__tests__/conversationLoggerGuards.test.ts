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

  it('valid Slack-shaped channel_id passes through', async () => {
    const results = await logger.search('anything', { channelId: 'C0A93A7H820' });
    expect(Array.isArray(results)).toBe(true);
  });
});
