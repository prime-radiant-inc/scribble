import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StateStore } from '../stateStore.js';
import { ActiveThread } from '../types.js';
import * as fs from 'fs';
import * as path from 'path';

const TEST_DIR = '/tmp/scribble-test-state';

describe('StateStore', () => {
  let store: StateStore;

  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
    fs.mkdirSync(TEST_DIR, { recursive: true });
    store = new StateStore(TEST_DIR);
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true });
  });

  it('should track processed messages', () => {
    expect(store.isMessageProcessed('123.456')).toBe(false);
    store.markMessageProcessed('123.456', 'C123');
    expect(store.isMessageProcessed('123.456')).toBe(true);
  });

  it('should track channel membership', () => {
    expect(store.getJoinedChannels()).toEqual([]);
    store.markChannelJoined('C123', 'general');
    expect(store.getJoinedChannels()).toContain('C123');
    store.markChannelLeft('C123');
    expect(store.getJoinedChannels()).not.toContain('C123');
  });

  it('should delete old processed message files', () => {
    const processedDir = path.join(TEST_DIR, 'state', 'processed');

    // Create an old file (45 days ago)
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 45);
    const oldDateStr = oldDate.toISOString().split('T')[0];
    const oldFile = path.join(processedDir, `${oldDateStr}.json`);
    fs.writeFileSync(oldFile, JSON.stringify({ '123.456': { messageTs: '123.456', channelId: 'C123', processedAt: Date.now() } }));

    // Create a recent file (5 days ago)
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 5);
    const recentDateStr = recentDate.toISOString().split('T')[0];
    const recentFile = path.join(processedDir, `${recentDateStr}.json`);
    fs.writeFileSync(recentFile, JSON.stringify({ '789.012': { messageTs: '789.012', channelId: 'C456', processedAt: Date.now() } }));

    // Clean with 30-day retention
    store.cleanOldMessages(30);

    // Old file should be deleted, recent file should remain
    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(recentFile)).toBe(true);
  });

  describe('ActiveThread tracking', () => {
    it('should track active threads', () => {
      const thread: ActiveThread = {
        threadId: '123.456',
        channelId: 'C123',
        channelName: 'general',
        engagedAt: Date.now(),
        lastActivity: Date.now(),
        topicSummary: 'Discussing wiki setup',
        participants: ['U123', 'U456'],
      };

      store.setActiveThread(thread);
      expect(store.getActiveThread('C123', '123.456')).toEqual(thread);
      expect(store.isThreadActive('C123', '123.456')).toBe(true);
    });

    it('should remove inactive threads', () => {
      const thread: ActiveThread = {
        threadId: '123.456',
        channelId: 'C123',
        channelName: 'general',
        engagedAt: Date.now(),
        lastActivity: Date.now(),
        topicSummary: 'Test',
        participants: ['U123'],
      };

      store.setActiveThread(thread);
      store.removeActiveThread('C123', '123.456');
      expect(store.isThreadActive('C123', '123.456')).toBe(false);
    });

    it('should list all active threads', () => {
      const thread1: ActiveThread = {
        threadId: '111.111',
        channelId: 'C123',
        channelName: 'general',
        engagedAt: Date.now(),
        lastActivity: Date.now(),
        topicSummary: 'Topic 1',
        participants: ['U123'],
      };
      const thread2: ActiveThread = {
        threadId: '222.222',
        channelId: 'C456',
        channelName: 'random',
        engagedAt: Date.now(),
        lastActivity: Date.now(),
        topicSummary: 'Topic 2',
        participants: ['U456'],
      };

      store.setActiveThread(thread1);
      store.setActiveThread(thread2);

      const active = store.getAllActiveThreads();
      expect(active).toHaveLength(2);
    });
  });
});
