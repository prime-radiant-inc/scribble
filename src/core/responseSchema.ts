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
      description: `Your persona is QUIET and COMPETENT. You do not engage in banter, small talk, or respond just for the sake of human connection. You speak only when you have something substantive to contribute.

Set to true ONLY if:
1. Message contains @scribble mention with a question or request
2. Message directly addresses Scribble by name with a task ("hey scribble, can you...")
3. You have genuinely useful information to add (not just acknowledgment or pleasantries)

Set to false for:
- Greetings, thanks, or social pleasantries (do not respond to "good morning" or "thanks scribble")
- Casual conversation between others
- Messages where you'd just be acknowledging or agreeing
- Anything where staying silent is reasonable

You can use tools (wiki, linear, etc.) even when shouldRespond is false. Taking action silently is often better than announcing what you're doing. A checkmark reaction will indicate you acted.`,
    },
    reason: {
      type: 'string',
      description: 'One short sentence explaining your decision',
    },
    message: {
      type: 'string',
      description: 'The actual response to send. Only set if shouldRespond is true. Be direct and concise - no filler, no pleasantries, no "Sure!" or "Happy to help!"',
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
