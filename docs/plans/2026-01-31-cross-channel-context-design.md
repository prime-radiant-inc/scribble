# Cross-Channel Context Injection

**Date:** 2026-01-31
**Status:** Ready for implementation

## Overview

Add cross-channel awareness to Scribble by injecting recent messages from other Slack channels as a system reminder before responding. Also fix user/channel ID display and enhance the `conversation_search` tool.

## Components

| Component | Location | Purpose |
|-----------|----------|---------|
| CrossChannelContext | `src/context/crossChannelContext.ts` | Gather & format recent messages from other channels |
| ID Formatter | `src/utils/idFormatter.ts` | Centralized "Name [bot] (ID)" formatting |
| conversation_search enhancement | `src/mcp/index.ts` + `src/logging/conversationLogger.ts` | Add date and context params |

## Data Flow

```
Message received
       ↓
Engagement decision (existing) → decides to respond
       ↓
CrossChannelContext.gather(currentChannelId, currentThreadTs, existingContextTimestamps)
       ↓
Returns formatted markdown of recent activity from other channels/threads
       ↓
Injected as system reminder via sessionManager.sendMessage({ systemPromptAppend })
       ↓
Scribble formulates response with cross-channel awareness
```

## CrossChannelContext Module

### Parameters

```typescript
interface CrossChannelContextOptions {
  excludeChannelId: string;              // Current channel
  excludeThreadTs?: string;              // Current thread
  afterTimestamps: Map<string, string>;  // channelId+threadTs -> last seen timestamp
  windowHours: number;                   // Default: 24
  maxPerThread: number;                  // Default: 10
}
```

### Algorithm

1. List all public channels Scribble is in
2. For each channel (except current):
   - Read messages from last 24h
   - Filter to messages after `afterTimestamps.get(channelId + threadTs)` if present
   - Group by thread (main channel = one thread, each reply thread = separate)
   - Take up to 10 messages per thread
   - Format with "Name (ID)" and timestamps
3. If current channel has main-channel messages after this thread branched, include those (up to 10)
4. Assemble into markdown grouped by channel → thread
5. Append the `conversation_search` usage hint

### Output Format

```markdown
## Recent activity from other channels (last 24h)

### #ops (C0A8LJZQSAX)
Source: /home/scribble/conversations/C0A8LJZQSAX/2026-01-31/main.md
- Jesse (U0A2GP26U94) [2026-01-31 14:23]: Deployed scribble with Tailscale support
- Drew (U0A2GP27X12) [2026-01-31 15:47]: Nice, SSH working?

  **Thread: "CI failures" [2026-01-31 12:15]:**
  Source: /home/scribble/conversations/C0A8LJZQSAX/2026-01-31/thread-1738073715.md
  - Drew (U0A2GP27X12) [2026-01-31 12:15]: The build is red again
  - Jesse (U0A2GP26U94) [2026-01-31 12:32]: Looking into it

### #sen-dev (C0AAL24BKGF)
Source: /home/scribble/conversations/C0AAL24BKGF/2026-01-31/main.md
- Bot [bot] (U0A3XYZ1234) [2026-01-31 11:05]: Deployment complete

---
Use `conversation_search` with a keyword or channel_id to expand relevant conversations before replying.
```

### Message Truncation

Messages over 500 characters get truncated:
- First 400 chars
- `[N chars]` showing count of omitted content
- Last 100 chars

Example:
```
- Jesse (U0A2GP26U94) [2026-01-31 14:23]: Here's the detailed deployment plan for the new authentication system. First we need to update the database schema to support the new token format, then migrate existing sessions, then deploy the new auth service behind a feature flag... [247 chars] ...after that we can monitor error rates and gradually roll out to all users.
```

## ID Formatting

### Format Rules

- Regular users: `Jesse (U0A2GP26U94)`
- Bots: `Scribble [bot] (U0A3BOT1234)`
- Unknown: `Unknown (U0A2GP26U94)`
- Unknown bot: `Unknown [bot] (U0A3BOT1234)`
- Channels: `#ops (C0A8LJZQSAX)`

### Implementation

```typescript
// src/utils/idFormatter.ts

export function formatUser(userId: string, displayName: string | null, isBot: boolean): string {
  const name = displayName || 'Unknown';
  const botTag = isBot ? ' [bot]' : '';
  return `${name}${botTag} (${userId})`;
}

export function formatChannel(channelId: string, channelName: string | null): string {
  const name = channelName || 'unknown';
  return `#${name} (${channelId})`;
}
```

## conversation_search Enhancement

### New Parameters

```typescript
const ConversationSearchParams = z.object({
  query: z.string().describe('Search query'),
  channel_id: z.string().optional().describe('Filter to specific channel'),
  date: z.string().optional().describe('Filter by date (YYYY-MM-DD) or range (YYYY-MM-DD:YYYY-MM-DD)'),
  context: z.number().optional().describe('Number of messages to show before and after each match'),
  limit: z.number().optional().describe('Maximum results (default: 10)'),
});
```

### Implementation Notes

- Date filtering: Parse log file paths which are organized by date
- Context: When a match is found, include N messages before/after from the same file

## Files to Modify

1. `src/context/crossChannelContext.ts` (new) - Cross-channel context gathering
2. `src/utils/idFormatter.ts` (new) - Centralized ID formatting
3. `src/orchestrator/scribbleOrchestrator.ts` - Integrate context gathering after engagement check
4. `src/slack/adapterSDK.ts` - Use ID formatter for message formatting
5. `src/logging/conversationLogger.ts` - Add date/context search params, use ID formatter
6. `src/mcp/index.ts` - Update conversation_search parameter schema

## Integration Point

In `scribbleOrchestrator.ts`, after engagement check passes but before `sessionManager.sendMessage()`:

```typescript
async handleMessage(message: SlackMessage) {
  // 1. Check engagement
  const shouldEngage = await this.checkEngagement(message);
  if (!shouldEngage) return;

  // 2. Build constitution/system prompt
  const constitution = await this.buildConstitution(message);

  // 3. Gather cross-channel context
  const crossChannelContext = await this.crossChannelContext.gather({
    excludeChannelId: message.channelId,
    excludeThreadTs: message.threadTs,
    afterTimestamps: this.getExistingContextTimestamps(message),
    windowHours: 24,
    maxPerThread: 10,
  });

  // 4. Send to Claude with combined context
  await this.sessionManager.sendMessage({
    message: formattedMessage,
    systemPromptAppend: constitution + '\n\n' + crossChannelContext,
  });
}
```

## Tracking Existing Context

Track which messages are already in Scribble's context for each session to avoid re-injecting them. Store in session metadata or in-memory map keyed by session ID.
