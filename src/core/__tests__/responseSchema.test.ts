// scribble/src/core/__tests__/responseSchema.test.ts
import { describe, it, expect } from 'vitest';
import { parseRespondToolInput, type EngagementResponse } from '../responseSchema.js';

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
