export interface EngagementCheck {
  text: string;
  channelId: string;
  threadTs: string | null;
}

export interface EngagementResult {
  shouldEngage: boolean;
  reason?: 'mention' | 'name' | 'active_thread' | 'dm';
}

export const DISMISSAL_PATTERNS = [
  /thanks?\s*,?\s*scribble/i,
  /scribble,?\s*be\s*quiet/i,
  /that'?s?\s*all,?\s*scribble/i,
  /got\s*it,?\s*scribble/i,
  /ok\s*scribble/i,
  /bye\s*scribble/i,
];

// Match "scribble" only when surrounded by whitespace, punctuation, or string boundaries
// Does NOT match: URLs (foo.com/scribble), subdomains (scribble.example.com),
// hyphenated (the-scribbling), suffixed (scribbled), underscored (scribble_bot)
export const NAME_PATTERNS = [
  /(?:^|[\s,.:;!?])scribble(?:[\s,:;!?]|\.(?![a-z])|$)/i,
];
