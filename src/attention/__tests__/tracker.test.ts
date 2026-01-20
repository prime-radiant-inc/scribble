import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AttentionTracker } from '../tracker.js';
import { StateStore } from '../../state/stateStore.js';
import * as fs from 'fs';

const TEST_DIR = '/tmp/scribble-test-attention';

describe('AttentionTracker', () => {
  let tracker: AttentionTracker;
  let stateStore: StateStore;

  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
    fs.mkdirSync(TEST_DIR, { recursive: true });
    stateStore = new StateStore(TEST_DIR);
    tracker = new AttentionTracker(stateStore, 'U_SCRIBBLE');
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true });
  });

  describe('engagement detection', () => {
    it('should detect @mention', () => {
      const result = tracker.shouldEngage({
        text: 'Hey <@U_SCRIBBLE> can you help?',
        channelId: 'C123',
        threadTs: null,
      });
      expect(result.shouldEngage).toBe(true);
      expect(result.reason).toBe('mention');
    });

    it('should detect name usage', () => {
      const result = tracker.shouldEngage({
        text: 'Scribble, what do you think?',
        channelId: 'C123',
        threadTs: null,
      });
      expect(result.shouldEngage).toBe(true);
      expect(result.reason).toBe('name');
    });

    it('should detect active thread', () => {
      tracker.engage('C123', '111.222', 'general', 'Test topic');
      const result = tracker.shouldEngage({
        text: 'What about this approach?',
        channelId: 'C123',
        threadTs: '111.222',
      });
      expect(result.shouldEngage).toBe(true);
      expect(result.reason).toBe('active_thread');
    });

    it('should not engage on random messages', () => {
      const result = tracker.shouldEngage({
        text: 'Hey team, lunch at noon?',
        channelId: 'C123',
        threadTs: null,
      });
      expect(result.shouldEngage).toBe(false);
    });
  });

  describe('disengagement', () => {
    it('should disengage on dismissal', () => {
      tracker.engage('C123', '111.222', 'general', 'Test');
      expect(tracker.isEngaged('C123', '111.222')).toBe(true);

      const shouldDisengage = tracker.checkDisengagement(
        'C123',
        '111.222',
        'Thanks Scribble, that helps!'
      );
      expect(shouldDisengage).toBe(true);
      expect(tracker.isEngaged('C123', '111.222')).toBe(false);
    });

    it('should disengage on explicit dismissal', () => {
      tracker.engage('C123', '111.222', 'general', 'Test');
      expect(tracker.isEngaged('C123', '111.222')).toBe(true);

      const shouldDisengage = tracker.checkDisengagement(
        'C123',
        '111.222',
        'Scribble, be quiet'
      );
      expect(shouldDisengage).toBe(true);
      expect(tracker.isEngaged('C123', '111.222')).toBe(false);
    });
  });

  describe('name detection edge cases', () => {
    it('should NOT engage for scribble in URL path', () => {
      const result = tracker.shouldEngage({
        text: 'Check out foo.com/scribble for more info',
        channelId: 'C123',
        threadTs: null,
      });
      expect(result.shouldEngage).toBe(false);
    });

    it('should NOT engage for scribble in URL subdomain', () => {
      const result = tracker.shouldEngage({
        text: 'Visit scribble.example.com',
        channelId: 'C123',
        threadTs: null,
      });
      expect(result.shouldEngage).toBe(false);
    });

    it('should NOT engage for scribbled (suffix)', () => {
      const result = tracker.shouldEngage({
        text: 'I scribbled some notes',
        channelId: 'C123',
        threadTs: null,
      });
      expect(result.shouldEngage).toBe(false);
    });

    it('should NOT engage for the-scribbling (hyphenated)', () => {
      const result = tracker.shouldEngage({
        text: 'Check out the-scribbling project',
        channelId: 'C123',
        threadTs: null,
      });
      expect(result.shouldEngage).toBe(false);
    });

    it('should NOT engage for scribble as part of identifier', () => {
      const result = tracker.shouldEngage({
        text: 'The scribble_bot variable is set',
        channelId: 'C123',
        threadTs: null,
      });
      expect(result.shouldEngage).toBe(false);
    });

    it('should engage for scribble at start of message', () => {
      const result = tracker.shouldEngage({
        text: 'Scribble, can you help?',
        channelId: 'C123',
        threadTs: null,
      });
      expect(result.shouldEngage).toBe(true);
      expect(result.reason).toBe('name');
    });

    it('should engage for scribble at end of message', () => {
      const result = tracker.shouldEngage({
        text: 'What do you think, scribble',
        channelId: 'C123',
        threadTs: null,
      });
      expect(result.shouldEngage).toBe(true);
      expect(result.reason).toBe('name');
    });

    it('should engage for scribble mid-sentence with spaces', () => {
      const result = tracker.shouldEngage({
        text: 'Hey scribble how are you',
        channelId: 'C123',
        threadTs: null,
      });
      expect(result.shouldEngage).toBe(true);
      expect(result.reason).toBe('name');
    });

    it('should engage for scribble with punctuation', () => {
      const result = tracker.shouldEngage({
        text: 'Thanks, scribble!',
        channelId: 'C123',
        threadTs: null,
      });
      expect(result.shouldEngage).toBe(true);
      expect(result.reason).toBe('name');
    });
  });

  describe('stale thread cleanup', () => {
    it('should clean up threads inactive for too long', () => {
      // Create a thread that's been inactive
      tracker.engage('C123', '111.222', 'general', 'Old topic');

      // Manually set lastActivity to 5 hours ago
      const thread = tracker.getActiveThread('C123', '111.222')!;
      thread.lastActivity = Date.now() - (5 * 60 * 60 * 1000);
      stateStore.setActiveThread(thread);

      // Cleanup threads older than 4 hours
      tracker.cleanupStaleThreads(4 * 60 * 60 * 1000);

      expect(tracker.isEngaged('C123', '111.222')).toBe(false);
    });

    it('should keep recent threads', () => {
      tracker.engage('C123', '333.444', 'general', 'Recent topic');

      tracker.cleanupStaleThreads(4 * 60 * 60 * 1000);

      expect(tracker.isEngaged('C123', '333.444')).toBe(true);
    });
  });
});
