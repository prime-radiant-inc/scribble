export const MAX_WIKI_LIMIT = 50;
const DEFAULT_LIMIT = 10;

export function clampWikiLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  const integer = Math.trunc(limit);
  return Math.max(1, Math.min(integer, MAX_WIKI_LIMIT));
}

export function clampWikiResults<T>(results: T[]): T[] {
  return results.slice(0, MAX_WIKI_LIMIT);
}
