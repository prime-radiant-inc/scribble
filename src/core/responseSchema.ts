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
2. Message explicitly addresses Scribble by name ("scribble", "scrib") with a task or question
3. You have relevant factual information that the other participants might not be aware of, AND your response includes a hyperlink to the source (Slack message, Linear ticket, or wiki page). No link = no response.

CRITICAL - Pronoun disambiguation:
- Pronouns like "you", "your", "yourself" do NOT count as addressing you
- In conversations between multiple people, assume "you" refers to the OTHER HUMAN, not to you
- Unless your name (Scribble/scrib) or @mention appears in the message, you are NOT being addressed
- "I want it to work for you" between two humans = NOT addressing you
- "Scribble, I want it to work for you" = addressing you

Set to false for:
- Greetings, thanks, or social pleasantries (do not respond to "good morning" or "thanks scribble")
- Casual conversation between others (even if they use "you" - it's not you)
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
      description: 'REQUIRED when shouldRespond is true. The actual response to send. Be direct and concise - no filler, no pleasantries, no "Sure!" or "Happy to help!"',
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
