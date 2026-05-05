export function requireWikiRepo(env: Record<string, string | undefined> = process.env): string {
  const repo = env.WIKI_REPO?.trim();
  if (!repo) {
    throw new Error('Missing required environment variable: WIKI_REPO');
  }
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    throw new Error('WIKI_REPO must be in owner/name form');
  }
  return repo;
}
