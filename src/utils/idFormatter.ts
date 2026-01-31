/**
 * Formats a user ID with display name for human-readable context.
 * @param userId - Slack user ID (e.g., U0A2GP26U94)
 * @param displayName - User's display name, or null if unknown
 * @param isBot - Whether the user is a bot
 * @returns Formatted string: "Name (ID)" or "Name [bot] (ID)"
 */
export function formatUser(userId: string, displayName: string | null, isBot: boolean): string {
  const name = displayName ?? 'Unknown';
  const botTag = isBot ? ' [bot]' : '';
  return `${name}${botTag} (${userId})`;
}

/**
 * Formats a channel ID with channel name for human-readable context.
 * @param channelId - Slack channel ID (e.g., C0A8LJZQSAX)
 * @param channelName - Channel name without #, or null if unknown
 * @returns Formatted string: "#name (ID)"
 */
export function formatChannel(channelId: string, channelName: string | null): string {
  const name = channelName ?? 'unknown';
  return `#${name} (${channelId})`;
}

/**
 * Truncates long messages while preserving start and end context.
 * Messages <= 500 chars are returned unchanged.
 * Longer messages: first 400 chars + " [N chars] " + last 100 chars
 * @param text - Message text to potentially truncate
 * @returns Original or truncated message
 */
export function truncateMessage(text: string): string {
  const MAX_LENGTH = 500;
  const HEAD_LENGTH = 400;
  const TAIL_LENGTH = 100;

  if (text.length <= MAX_LENGTH) {
    return text;
  }

  const omittedCount = text.length - MAX_LENGTH;
  const head = text.slice(0, HEAD_LENGTH);
  const tail = text.slice(-TAIL_LENGTH);
  return `${head} [${omittedCount} chars] ${tail}`;
}
