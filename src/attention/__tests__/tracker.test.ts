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
    });

    it('should disengage on explicit dismissal', () => {
      tracker.engage('C123', '111.222', 'general', 'Test');
      const shouldDisengage = tracker.checkDisengagement(
        'C123',
        '111.222',
        'Scribble, be quiet'
      );
      expect(shouldDisengage).toBe(true);
    });
  });
});
