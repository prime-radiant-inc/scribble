import { describe, it, expect } from 'vitest';
import { clampWikiLimit } from '../wikiHandlerCaps.js';

describe('clampWikiLimit', () => {
  it('clamps to 50', () => {
    expect(clampWikiLimit(1000)).toBe(50);
  });

  it('passes through under-limit values', () => {
    expect(clampWikiLimit(20)).toBe(20);
  });

  it('uses default 10 when undefined', () => {
    expect(clampWikiLimit(undefined)).toBe(10);
  });

  it('passes 0 through (caller decides)', () => {
    expect(clampWikiLimit(0)).toBe(0);
  });
});
