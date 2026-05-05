import { isValidSlackChannelId } from '../utils/slackIds.js';

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
  if (args.channel_id !== undefined && !isValidSlackChannelId(args.channel_id)) return null;

  const limit = normalizeNumber(args.limit, 1, MAX_LIMIT);
  if (limit === null) return null;

  const context = normalizeNumber(args.context, 0, MAX_CONTEXT);
  if (context === null) return null;

  return {
    query: args.query,
    channel_id: args.channel_id,
    date: args.date,
    limit,
    context,
  };
}

function normalizeNumber(value: number | undefined, min: number, max: number): number | undefined | null {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value)) return null;
  const integer = Math.trunc(value);
  return Math.max(min, Math.min(integer, max));
}
