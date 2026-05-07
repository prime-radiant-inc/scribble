import { describe, expect, it } from 'vitest';
import { escapeRegExp } from '../regex.js';

describe('escapeRegExp', () => {
  it('escapes regex syntax characters', () => {
    expect(escapeRegExp('S.crib+Bot')).toBe('S\\.crib\\+Bot');
  });
});
