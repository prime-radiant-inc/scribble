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

export function parseRespondToolInput(input: unknown): EngagementResponse {
  if (typeof input !== 'object' || input === null) {
    return {
      shouldRespond: false,
      reason: 'Respond tool called with non-object input',
    };
  }

  const obj = input as Record<string, unknown>;

  if (typeof obj.directed_at_me !== 'boolean') {
    return {
      shouldRespond: false,
      reason: 'Respond tool input missing directed_at_me field',
    };
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

export function parseDecisionLogInput(input: unknown): DecisionLogInput | null {
  if (typeof input !== 'object' || input === null) {
    return null;
  }

  const obj = input as Record<string, unknown>;

  if (typeof obj.decision !== 'string') {
    return null;
  }

  if (!Array.isArray(obj.tags)) {
    return null;
  }

  return {
    decision: obj.decision,
    tags: obj.tags as string[],
  };
}
