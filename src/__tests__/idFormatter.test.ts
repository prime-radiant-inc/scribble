import { describe, it, expect } from 'vitest';
import { formatUser, formatChannel, truncateMessage } from '../utils/idFormatter.js';

describe('formatUser', () => {
  it('formats regular user with display name', () => {
    expect(formatUser('U0A2GP26U94', 'Jesse', false)).toBe('Jesse (U0A2GP26U94)');
  });

  it('formats bot user with display name', () => {
    expect(formatUser('U0A3BOT1234', 'Scribble', true)).toBe('Scribble [bot] (U0A3BOT1234)');
  });

  it('formats user with null display name as Unknown', () => {
    expect(formatUser('U0A2GP26U94', null, false)).toBe('Unknown (U0A2GP26U94)');
  });

  it('formats bot with null display name as Unknown [bot]', () => {
    expect(formatUser('U0A3BOT1234', null, true)).toBe('Unknown [bot] (U0A3BOT1234)');
  });
});

describe('formatChannel', () => {
  it('formats channel with name', () => {
    expect(formatChannel('C0A8LJZQSAX', 'ops')).toBe('#ops (C0A8LJZQSAX)');
  });

  it('formats channel with null name as unknown', () => {
    expect(formatChannel('C0A8LJZQSAX', null)).toBe('#unknown (C0A8LJZQSAX)');
  });
});

describe('truncateMessage', () => {
  it('returns unchanged message at exactly 500 chars', () => {
    const message = 'a'.repeat(500);
    expect(truncateMessage(message)).toBe(message);
  });

  it('returns unchanged message under 500 chars', () => {
    const message = 'Hello, world!';
    expect(truncateMessage(message)).toBe(message);
  });

  it('truncates message over 500 chars with omitted count', () => {
    const message = 'a'.repeat(600);
    const result = truncateMessage(message);
    // first 400 + " [100 chars] " + last 100
    expect(result).toBe('a'.repeat(400) + ' [100 chars] ' + 'a'.repeat(100));
  });

  it('calculates correct omitted char count', () => {
    // 700 chars total, keep 400 + 100 = 500, omit 200
    const message = 'a'.repeat(700);
    const result = truncateMessage(message);
    expect(result).toBe('a'.repeat(400) + ' [200 chars] ' + 'a'.repeat(100));
  });

  it('handles message at 501 chars (just over threshold)', () => {
    const message = 'a'.repeat(501);
    const result = truncateMessage(message);
    // omit 1 char
    expect(result).toBe('a'.repeat(400) + ' [1 chars] ' + 'a'.repeat(100));
  });
});
