const SLACK_CHANNEL_ID = /^[A-Z0-9]{9,}$/;
const MAX_LIMIT = 50;
const MAX_CONTEXT = 5;

export interface NormalizedConversationSearchArgs {
  query: string;
  channel_id?: string;
  date?: string;
  limit?: number;
  context?: number;
}

export function normalizeConversationSearchArgs(args: {
  query: string;
  channel_id?: string;
  date?: string;
  limit?: number;
  context?: number;
}): NormalizedConversationSearchArgs | null {
  if (typeof args.query !== 'string' || args.query.trim().length === 0) return null;
  if (args.channel_id !== undefined && !SLACK_CHANNEL_ID.test(args.channel_id)) return null;

  return {
    query: args.query,
    channel_id: args.channel_id,
    date: args.date,
    limit: args.limit !== undefined ? Math.min(args.limit, MAX_LIMIT) : undefined,
    context: args.context !== undefined ? Math.min(args.context, MAX_CONTEXT) : undefined,
  };
}
