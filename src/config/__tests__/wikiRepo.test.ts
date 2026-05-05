import { describe, expect, it } from 'vitest';
import { requireWikiRepo } from '../wikiRepo.js';

describe('requireWikiRepo', () => {
  it('throws when WIKI_REPO is missing or blank', () => {
    expect(() => requireWikiRepo({})).toThrow('Missing required environment variable: WIKI_REPO');
    expect(() => requireWikiRepo({ WIKI_REPO: '   ' })).toThrow('Missing required environment variable: WIKI_REPO');
  });

  it('throws when WIKI_REPO is not owner/name', () => {
    expect(() => requireWikiRepo({ WIKI_REPO: 'owner' })).toThrow('WIKI_REPO must be in owner/name form');
    expect(() => requireWikiRepo({ WIKI_REPO: 'owner/name/extra' })).toThrow('WIKI_REPO must be in owner/name form');
    expect(() => requireWikiRepo({ WIKI_REPO: 'owner /name' })).toThrow('WIKI_REPO must be in owner/name form');
  });

  it('returns a trimmed owner/name repo', () => {
    expect(requireWikiRepo({ WIKI_REPO: ' owner/wiki ' })).toBe('owner/wiki');
  });
});
