import { describe, it, expect } from 'vitest';
import { clampWikiLimit, clampWikiResults } from '../wikiHandlerCaps.js';

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

  it('clamps lower bound to 1', () => {
    expect(clampWikiLimit(0)).toBe(1);
    expect(clampWikiLimit(-5)).toBe(1);
  });

  it('uses default 10 when non-finite', () => {
    expect(clampWikiLimit(Number.NaN)).toBe(10);
    expect(clampWikiLimit(Number.POSITIVE_INFINITY)).toBe(10);
  });

  it('truncates fractional limits', () => {
    expect(clampWikiLimit(2.9)).toBe(2);
  });

  it('clamps result arrays to 50', () => {
    const results = Array.from({ length: 60 }, (_, index) => ({ index }));
    expect(clampWikiResults(results)).toHaveLength(50);
    expect(clampWikiResults(results)[49]).toEqual({ index: 49 });
  });
});
