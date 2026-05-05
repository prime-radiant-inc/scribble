// scribble/src/core/responseSchema.ts

export interface DecisionLogInput {
  decision: string;
  tags: string[];
}

export interface EngagementResponse {
  shouldRespond: boolean;
  reason?: string;
  message?: string;
}

export function parseRespondToolInput(input: unknown): EngagementResponse | null {
  if (typeof input !== 'object' || input === null) {
    return null;
  }

  const obj = input as Record<string, unknown>;

  if (typeof obj.directed_at_me !== 'boolean') {
    return null;
  }

  return {
    shouldRespond: obj.directed_at_me,
    reason: typeof obj.reason === 'string' ? obj.reason : undefined,
    message: typeof obj.message === 'string' ? obj.message : undefined,
  };
}

export interface SlackReplyInput {
  channelId: string;
  threadTs: string;
  message: string;
}

const SLACK_CHANNEL_ID = /^[A-Z0-9]{9,}$/;
const SLACK_THREAD_TS = /^\d+\.\d+$/;

export function parseSlackReplyInput(input: unknown): SlackReplyInput | null {
  if (typeof input !== 'object' || input === null) {
    return null;
  }

  const obj = input as Record<string, unknown>;

  if (typeof obj.channel_id !== 'string' || typeof obj.thread_ts !== 'string' || typeof obj.message !== 'string') {
    return null;
  }

  if (!SLACK_CHANNEL_ID.test(obj.channel_id)) return null;
  if (!SLACK_THREAD_TS.test(obj.thread_ts)) return null;
  if (obj.message.trim().length === 0) return null;

  return {
    channelId: obj.channel_id,
    threadTs: obj.thread_ts,
    message: obj.message,
  };
}

const MAX_DECISION_LENGTH = 4096;
const MAX_TAGS = 16;
const MAX_TAG_LENGTH = 64;

export function parseDecisionLogInput(input: unknown): DecisionLogInput | null {
  if (typeof input !== 'object' || input === null) {
    return null;
  }

  const obj = input as Record<string, unknown>;

  if (typeof obj.decision !== 'string') {
    return null;
  }
  if (obj.decision.trim().length === 0) {
    return null;
  }

  if (!Array.isArray(obj.tags)) {
    return null;
  }
  if (!obj.tags.every(t => typeof t === 'string')) {
    return null;
  }

  const decision = obj.decision.length > MAX_DECISION_LENGTH
    ? obj.decision.slice(0, MAX_DECISION_LENGTH)
    : obj.decision;

  const tags = (obj.tags as string[])
    .slice(0, MAX_TAGS)
    .map(t => (t.length > MAX_TAG_LENGTH ? t.slice(0, MAX_TAG_LENGTH) : t));

  return {
    decision,
    tags,
  };
}
