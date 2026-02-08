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
