import { describe, it, expect } from 'vitest';
import { normalizeConversationSearchArgs } from '../conversationSearchArgs.js';

describe('normalizeConversationSearchArgs', () => {
  it('returns null for empty query', () => {
    expect(normalizeConversationSearchArgs({ query: '' })).toBeNull();
  });

  it('returns null for whitespace-only query', () => {
    expect(normalizeConversationSearchArgs({ query: '   \n' })).toBeNull();
  });

  it('returns null for malformed channel_id', () => {
    expect(normalizeConversationSearchArgs({
      query: 'hi',
      channel_id: '../wiki',
    })).toBeNull();
  });

  it('clamps limit to 50', () => {
    const result = normalizeConversationSearchArgs({ query: 'hi', limit: 1000 });
    expect(result).not.toBeNull();
    expect(result!.limit).toBe(50);
  });

  it('clamps context to 5', () => {
    const result = normalizeConversationSearchArgs({ query: 'hi', context: 100 });
    expect(result).not.toBeNull();
    expect(result!.context).toBe(5);
  });

  it('passes through valid args unchanged', () => {
    const result = normalizeConversationSearchArgs({
      query: 'hi',
      channel_id: 'C0A93A7H820',
      date: '2026-05-01',
      limit: 20,
      context: 3,
    });
    expect(result).toEqual({
      query: 'hi',
      channel_id: 'C0A93A7H820',
      date: '2026-05-01',
      limit: 20,
      context: 3,
    });
  });

  it('omitted channel_id is allowed (global search)', () => {
    const result = normalizeConversationSearchArgs({ query: 'hi' });
    expect(result).not.toBeNull();
    expect(result!.channel_id).toBeUndefined();
  });
});
