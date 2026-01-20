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

    it('should list all active threads with correct content', () => {
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

      // Verify actual content of returned threads
      const foundThread1 = active.find(t => t.threadId === '111.111');
      const foundThread2 = active.find(t => t.threadId === '222.222');

      expect(foundThread1).toBeDefined();
      expect(foundThread1?.channelId).toBe('C123');
      expect(foundThread1?.channelName).toBe('general');
      expect(foundThread1?.topicSummary).toBe('Topic 1');
      expect(foundThread1?.participants).toEqual(['U123']);

      expect(foundThread2).toBeDefined();
      expect(foundThread2?.channelId).toBe('C456');
      expect(foundThread2?.channelName).toBe('random');
      expect(foundThread2?.topicSummary).toBe('Topic 2');
      expect(foundThread2?.participants).toEqual(['U456']);
    });

    it('should update thread activity timestamp', async () => {
      const initialTime = Date.now();
      const thread: ActiveThread = {
        threadId: '123.456',
        channelId: 'C123',
        channelName: 'general',
        engagedAt: initialTime,
        lastActivity: initialTime,
        topicSummary: 'Test thread',
        participants: ['U123'],
      };

      store.setActiveThread(thread);

      // Wait a small amount to ensure time difference
      await new Promise(resolve => setTimeout(resolve, 10));

      store.updateThreadActivity('C123', '123.456');

      const updated = store.getActiveThread('C123', '123.456');
      expect(updated).not.toBeNull();
      expect(updated!.lastActivity).toBeGreaterThan(initialTime);
      // Other fields should remain unchanged
      expect(updated!.engagedAt).toBe(initialTime);
      expect(updated!.topicSummary).toBe('Test thread');
    });

    it('should handle corrupted active-threads.json gracefully', () => {
      // Write invalid JSON to the active-threads file
      const activeThreadsPath = path.join(TEST_DIR, 'state', 'active-threads.json');
      fs.writeFileSync(activeThreadsPath, 'not valid json {{{');

      // Methods should not crash and return empty/graceful fallback
      expect(store.getAllActiveThreads()).toEqual([]);
      expect(store.isThreadActive('C123', '123.456')).toBe(false);
      expect(store.getActiveThread('C123', '123.456')).toBeNull();

      // Should be able to set a new thread (overwrites corrupted file)
      const thread: ActiveThread = {
        threadId: '123.456',
        channelId: 'C123',
        channelName: 'general',
        engagedAt: Date.now(),
        lastActivity: Date.now(),
        topicSummary: 'New thread',
        participants: ['U123'],
      };
      store.setActiveThread(thread);
      expect(store.getActiveThread('C123', '123.456')).toEqual(thread);
    });
  });
});
