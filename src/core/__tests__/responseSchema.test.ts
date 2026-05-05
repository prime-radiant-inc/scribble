// scribble/src/core/__tests__/responseSchema.test.ts
import { describe, it, expect } from 'vitest';
import { parseRespondToolInput, parseDecisionLogInput, parseSlackReplyInput, type EngagementResponse } from '../responseSchema.js';

describe('parseRespondToolInput', () => {
  it('should parse directed_at_me=false with reason', () => {
    const result = parseRespondToolInput({
      directed_at_me: false,
      reason: 'not addressed',
    });
    expect(result.shouldRespond).toBe(false);
    expect(result.reason).toBe('not addressed');
    expect(result.message).toBeUndefined();
  });

  it('should parse directed_at_me=true with message', () => {
    const result = parseRespondToolInput({
      directed_at_me: true,
      reason: 'asked a question',
      message: 'Here is the answer.',
    });
    expect(result.shouldRespond).toBe(true);
    expect(result.reason).toBe('asked a question');
    expect(result.message).toBe('Here is the answer.');
  });

  it('should default to not responding when directed_at_me is missing', () => {
    const result = parseRespondToolInput({ reason: 'no flag' });
    expect(result.shouldRespond).toBe(false);
    expect(result.reason).toContain('missing directed_at_me');
  });

  it('should default to not responding on non-object input', () => {
    const result = parseRespondToolInput('a string');
    expect(result.shouldRespond).toBe(false);
    expect(result.reason).toContain('non-object');
  });

  it('should default to not responding on null input', () => {
    const result = parseRespondToolInput(null);
    expect(result.shouldRespond).toBe(false);
    expect(result.reason).toContain('non-object');
  });

  it('should default to not responding on undefined input', () => {
    const result = parseRespondToolInput(undefined);
    expect(result.shouldRespond).toBe(false);
    expect(result.reason).toContain('non-object');
  });

  it('should handle directed_at_me=true without message gracefully', () => {
    const result = parseRespondToolInput({
      directed_at_me: true,
      reason: 'mentioned by name',
    });
    expect(result.shouldRespond).toBe(true);
    expect(result.message).toBeUndefined();
  });
});

describe('parseDecisionLogInput', () => {
  it('should parse valid input with decision and tags', () => {
    const result = parseDecisionLogInput({
      decision: 'We will use Postgres for the new service',
      tags: ['engineering', 'infrastructure'],
    });
    expect(result).toEqual({
      decision: 'We will use Postgres for the new service',
      tags: ['engineering', 'infrastructure'],
    });
  });

  it('should return null when decision is missing', () => {
    const result = parseDecisionLogInput({
      tags: ['engineering'],
    });
    expect(result).toBeNull();
  });

  it('should return null when tags is missing', () => {
    const result = parseDecisionLogInput({
      decision: 'Use Postgres',
    });
    expect(result).toBeNull();
  });

  it('should return null when tags is not an array', () => {
    const result = parseDecisionLogInput({
      decision: 'Use Postgres',
      tags: 'engineering',
    });
    expect(result).toBeNull();
  });

  it('should return null for non-object input', () => {
    expect(parseDecisionLogInput('a string')).toBeNull();
    expect(parseDecisionLogInput(42)).toBeNull();
  });

  it('should return null for null input', () => {
    expect(parseDecisionLogInput(null)).toBeNull();
  });

  it('should return null for undefined input', () => {
    expect(parseDecisionLogInput(undefined)).toBeNull();
  });
});

describe('parseSlackReplyInput', () => {
  it('should parse valid input with channel_id, thread_ts, and message', () => {
    const result = parseSlackReplyInput({
      channel_id: 'C0A93A7H820',
      thread_ts: '1772816645.224219',
      message: 'How did yesterday go?',
    });
    expect(result).toEqual({
      channelId: 'C0A93A7H820',
      threadTs: '1772816645.224219',
      message: 'How did yesterday go?',
    });
  });

  it('should return null when channel_id is missing', () => {
    expect(parseSlackReplyInput({
      thread_ts: '1772816645.224219',
      message: 'Hello',
    })).toBeNull();
  });

  it('should return null when thread_ts is missing', () => {
    expect(parseSlackReplyInput({
      channel_id: 'C123ABC',
      message: 'Hello',
    })).toBeNull();
  });

  it('should return null when message is missing', () => {
    expect(parseSlackReplyInput({
      channel_id: 'C123ABC',
      thread_ts: '1772816645.224219',
    })).toBeNull();
  });

  it('should return null for non-object input', () => {
    expect(parseSlackReplyInput('a string')).toBeNull();
    expect(parseSlackReplyInput(42)).toBeNull();
    expect(parseSlackReplyInput(null)).toBeNull();
    expect(parseSlackReplyInput(undefined)).toBeNull();
  });

  it('rejects malformed channel_id (too short)', () => {
    expect(parseSlackReplyInput({
      channel_id: 'C123',
      thread_ts: '1772816645.224219',
      message: 'hi',
    })).toBeNull();
  });

  it('rejects malformed channel_id (path traversal)', () => {
    expect(parseSlackReplyInput({
      channel_id: '../wiki',
      thread_ts: '1772816645.224219',
      message: 'hi',
    })).toBeNull();
  });

  it('rejects malformed channel_id (lowercase)', () => {
    expect(parseSlackReplyInput({
      channel_id: 'c0a93a7h820',
      thread_ts: '1772816645.224219',
      message: 'hi',
    })).toBeNull();
  });

  it('rejects malformed thread_ts (no dot)', () => {
    expect(parseSlackReplyInput({
      channel_id: 'C0A93A7H820',
      thread_ts: '1772816645224219',
      message: 'hi',
    })).toBeNull();
  });

  it('rejects empty message', () => {
    expect(parseSlackReplyInput({
      channel_id: 'C0A93A7H820',
      thread_ts: '1772816645.224219',
      message: '',
    })).toBeNull();
  });

  it('rejects whitespace-only message', () => {
    expect(parseSlackReplyInput({
      channel_id: 'C0A93A7H820',
      thread_ts: '1772816645.224219',
      message: '   \n  ',
    })).toBeNull();
  });
});
