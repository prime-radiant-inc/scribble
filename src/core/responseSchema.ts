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
      description: `Set to true ONLY if one of these conditions is met:
1. Message contains @scribble mention
2. Message directly addresses Scribble by name ("hey scribble", "scribble, can you...")
3. Message is a direct question or request to Scribble
Set to false for all other messages - even if interesting or relevant. When in doubt, set to false.`,
    },
    reason: {
      type: 'string',
      description: 'One short sentence explaining why shouldRespond is true or false',
    },
    message: {
      type: 'string',
      description: 'The actual response to send to the user. Only set if shouldRespond is true. Must be a direct, helpful response - NOT internal reasoning or analysis.',
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
