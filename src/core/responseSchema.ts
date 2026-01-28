// scribble/src/core/responseSchema.ts

export interface EngagementResponse {
  shouldRespond: boolean;
  reason?: string;
  message?: string;
}

export const ENGAGEMENT_RESPONSE_SCHEMA = {
  type: 'object' as const,
  properties: {
    shouldRespond: {
      type: 'boolean',
      description: 'Whether Scribble should respond to this message based on constitution rules',
    },
    reason: {
      type: 'string',
      description: 'Brief reason for the decision (for debugging/logging)',
    },
    message: {
      type: 'string',
      description: 'The response message to send, if shouldRespond is true',
    },
  },
  required: ['shouldRespond'] as const,
};

export function parseEngagementResponse(json: string): EngagementResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(`Invalid JSON response: ${json.slice(0, 100)}`);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Response must be an object');
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj.shouldRespond !== 'boolean') {
    throw new Error('Response must have boolean shouldRespond field');
  }

  return {
    shouldRespond: obj.shouldRespond,
    reason: typeof obj.reason === 'string' ? obj.reason : undefined,
    message: typeof obj.message === 'string' ? obj.message : undefined,
  };
}
