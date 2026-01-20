import { describe, it, expect, beforeEach } from 'vitest';
import { MessageClassifier } from '../classifier.js';
import { SlackMessage } from '../../core/types.js';

describe('MessageClassifier', () => {
  let classifier: MessageClassifier;

  beforeEach(() => {
    classifier = new MessageClassifier('U_SCRIBBLE');
  });

  const makeMessage = (overrides: Partial<SlackMessage> = {}): SlackMessage => ({
    channelId: 'C123',
    channelName: 'general',
    threadTs: null,
    messageTs: '123.456',
    userId: 'U123',
    userName: 'testuser',
    text: 'Hello world',
    isMention: false,
    isDm: false,
    ...overrides,
  });

  describe('isStandup', () => {
    it('should detect standup format', () => {
      const msg = makeMessage({
        text: 'Yesterday: Fixed bugs\nToday: Working on feature\nBlockers: None',
      });
      expect(classifier.isStandup(msg)).toBe(true);
    });

    it('should detect commitment language', () => {
      const msg = makeMessage({
        text: "I'll finish the auth refactor today",
      });
      expect(classifier.hasCommitment(msg)).toBe(true);
    });
  });

  describe('engagement classification', () => {
    it('should classify @mention', () => {
      const msg = makeMessage({
        text: 'Hey <@U_SCRIBBLE> can you help?',
        isMention: true,
      });
      const result = classifier.classify(msg);
      expect(result.requiresResponse).toBe(true);
      expect(result.engagementType).toBe('mention');
    });

    it('should classify DM', () => {
      const msg = makeMessage({ isDm: true });
      const result = classifier.classify(msg);
      expect(result.requiresResponse).toBe(true);
      expect(result.engagementType).toBe('dm');
    });

    it('should classify passive message', () => {
      const msg = makeMessage({ text: 'Anyone want coffee?' });
      const result = classifier.classify(msg);
      expect(result.requiresResponse).toBe(false);
    });
  });
});
