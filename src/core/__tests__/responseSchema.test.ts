// scribble/src/core/__tests__/responseSchema.test.ts
import { describe, it, expect } from 'vitest';
import { parseRespondToolInput, parseDecisionLogInput, parseSlackReplyInput } from '../responseSchema.js';

describe('parseRespondToolInput', () => {
  it('parses directed_at_me=false with reason', () => {
    const result = parseRespondToolInput({
      directed_at_me: false,
      reason: 'not addressed',
    });
    expect(result).not.toBeNull();
    expect(result!.shouldRespond).toBe(false);
    expect(result!.reason).toBe('not addressed');
    expect(result!.message).toBeUndefined();
  });

  it('parses directed_at_me=true with message', () => {
    const result = parseRespondToolInput({
      directed_at_me: true,
      reason: 'asked a question',
      message: 'Here is the answer.',
    });
    expect(result).not.toBeNull();
    expect(result!.shouldRespond).toBe(true);
    expect(result!.reason).toBe('asked a question');
    expect(result!.message).toBe('Here is the answer.');
  });

  it('returns null when directed_at_me is missing', () => {
    expect(parseRespondToolInput({ reason: 'no flag' })).toBeNull();
  });

  it('returns null on non-object input', () => {
    expect(parseRespondToolInput('a string')).toBeNull();
    expect(parseRespondToolInput(42)).toBeNull();
  });

  it('returns null on null input', () => {
    expect(parseRespondToolInput(null)).toBeNull();
  });

  it('returns null on undefined input', () => {
    expect(parseRespondToolInput(undefined)).toBeNull();
  });

  it('handles directed_at_me=true without message', () => {
    const result = parseRespondToolInput({
      directed_at_me: true,
      reason: 'mentioned by name',
    });
    expect(result).not.toBeNull();
    expect(result!.shouldRespond).toBe(true);
    expect(result!.message).toBeUndefined();
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

  it('rejects empty decision', () => {
    expect(parseDecisionLogInput({
      decision: '',
      tags: ['eng'],
    })).toBeNull();
  });

  it('rejects whitespace-only decision', () => {
    expect(parseDecisionLogInput({
      decision: '   \n',
      tags: ['eng'],
    })).toBeNull();
  });

  it('clamps oversized decision text to 4096 chars', () => {
    const huge = 'a'.repeat(5000);
    const result = parseDecisionLogInput({
      decision: huge,
      tags: ['eng'],
    });
    expect(result).not.toBeNull();
    expect(result!.decision.length).toBe(4096);
  });

  it('rejects when any tag is not a string', () => {
    expect(parseDecisionLogInput({
      decision: 'use postgres',
      tags: ['eng', 42],
    })).toBeNull();
  });

  it('clamps tag count to 16', () => {
    const tags = Array.from({ length: 25 }, (_, i) => `tag${i}`);
    const result = parseDecisionLogInput({
      decision: 'use postgres',
      tags,
    });
    expect(result).not.toBeNull();
    expect(result!.tags.length).toBe(16);
  });

  it('clamps per-tag length to 64 chars', () => {
    const longTag = 'x'.repeat(100);
    const result = parseDecisionLogInput({
      decision: 'use postgres',
      tags: [longTag, 'short'],
    });
    expect(result).not.toBeNull();
    expect(result!.tags[0].length).toBe(64);
    expect(result!.tags[1]).toBe('short');
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
