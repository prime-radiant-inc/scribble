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

  it('returns null for channel_id without a Slack channel prefix', () => {
    expect(normalizeConversationSearchArgs({
      query: 'hi',
      channel_id: '10A93A7H820',
    })).toBeNull();
  });

  it('returns null for overlong channel_id', () => {
    expect(normalizeConversationSearchArgs({
      query: 'hi',
      channel_id: `C${'A'.repeat(21)}`,
    })).toBeNull();
  });

  it('clamps limit to 50', () => {
    const result = normalizeConversationSearchArgs({ query: 'hi', limit: 1000 });
    expect(result).not.toBeNull();
    expect(result!.limit).toBe(50);
  });

  it('clamps limit lower bound to 1', () => {
    expect(normalizeConversationSearchArgs({ query: 'hi', limit: 0 })!.limit).toBe(1);
    expect(normalizeConversationSearchArgs({ query: 'hi', limit: -5 })!.limit).toBe(1);
  });

  it('returns null for non-finite limit', () => {
    expect(normalizeConversationSearchArgs({ query: 'hi', limit: Number.NaN })).toBeNull();
    expect(normalizeConversationSearchArgs({ query: 'hi', limit: Number.POSITIVE_INFINITY })).toBeNull();
  });

  it('truncates fractional limit', () => {
    const result = normalizeConversationSearchArgs({ query: 'hi', limit: 2.9 });
    expect(result).not.toBeNull();
    expect(result!.limit).toBe(2);
  });

  it('clamps context to 5', () => {
    const result = normalizeConversationSearchArgs({ query: 'hi', context: 100 });
    expect(result).not.toBeNull();
    expect(result!.context).toBe(5);
  });

  it('clamps context lower bound to 0', () => {
    const result = normalizeConversationSearchArgs({ query: 'hi', context: -1 });
    expect(result).not.toBeNull();
    expect(result!.context).toBe(0);
  });

  it('returns null for non-finite context', () => {
    expect(normalizeConversationSearchArgs({ query: 'hi', context: Number.NaN })).toBeNull();
    expect(normalizeConversationSearchArgs({ query: 'hi', context: Number.NEGATIVE_INFINITY })).toBeNull();
  });

  it('truncates fractional context', () => {
    const result = normalizeConversationSearchArgs({ query: 'hi', context: 2.9 });
    expect(result).not.toBeNull();
    expect(result!.context).toBe(2);
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
