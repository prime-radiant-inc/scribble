const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 10;

export function clampWikiLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  return Math.min(limit, MAX_LIMIT);
}
