# Scribble Session Architecture Redesign

## Problem

1. **Constitution not loaded** - `ConstitutionManager.getFullConstitution()` exists but is never passed to Claude sessions
2. **No persistent room context** - Sessions are per-thread only; Scribble has no memory of channel conversations
3. **Code-based engagement** - `AttentionTracker` filters messages before Claude sees them; Claude should decide

## Target Architecture

### Main Session (per room/DM)

- One persistent session per channel/DM
- Constitution loaded via `systemPrompt` option in Agent SDK
- Sees **every** message in the channel
- Accumulates context, autocompacts to stay within limits
- Claude decides whether to respond based on constitution rules

### Thread Sessions (forked from main)

- Created when any thread starts (user-initiated or Scribble-initiated)
- Fork from main session using Agent SDK's `resume` + `forkSession: true`
- Carries channel context at the moment of forking
- Independent after forking - resumes only within the thread
- Does not merge back into main session

## Implementation Changes

### 1. Conversation Logging Restructure

**File:** `scribble/src/logging/conversationLogger.ts`

Current structure (per-thread only):
```
conversations/{channel_id}/{date}/{thread_ts}.md
```

New structure (main channel + threads):
```
conversations/{channel_id}/{date}/
├── main.md              # All channel messages (not in threads)
├── main.json            # Structured version for session context
├── {thread_ts}.md       # Thread-specific logs
└── {thread_ts}.json
```

**Changes needed:**

```typescript
// New method: log all channel messages to main file
async logChannelMessage(message: SlackMessage): Promise<void> {
  // If message is in a thread, log to thread file
  if (message.threadTs) {
    return this.logThreadMessage(message);
  }

  // Otherwise log to main channel file
  const dateStr = this.getDateString();
  const channelDir = path.join(this.dataDir, message.channelId, dateStr);
  const mainFile = path.join(channelDir, 'main.md');
  const mainJson = path.join(channelDir, 'main.json');

  // Append to both files...
}

// New method: get main channel context for session
async getChannelContext(channelId: string, limit?: number): Promise<StoredMessage[]> {
  // Load from main.json files across recent dates
  // Used to hydrate main session context
}

// Existing method renamed for clarity
async logThreadMessage(message: SlackMessage): Promise<void> { ... }
```

**Integration with sessions:**
- Main session: loads context from `main.json` files
- Thread sessions: load context from `{thread_ts}.json` files
- All messages logged regardless of Scribble engagement

### 2. Constitution in System Prompt

**File:** `bot-toolkit/src/core/sessionManagerSDK.ts`

Add `systemPrompt` option to `query()` call:

```typescript
const options = {
  // ... existing options
  systemPrompt: {
    type: 'preset',
    preset: 'claude_code',
    append: systemPromptAppend  // constitution + channel instructions
  }
}
```

**File:** `scribble/src/index.ts` or new constitution integration

Pass constitution to session manager:
- `constitutionManager.getFullConstitution()`
- `constitutionManager.getInstructionsForChannel(channelName)`

### 3. Dual Session Store

**File:** `bot-toolkit/src/core/messageSessionStore.ts` (or new file)

```typescript
interface MainSession {
  channelId: string;
  sessionId: string;
  contextTokens: number;
  compactionCount: number;
  lastActivity: Date;
}

interface ThreadSession {
  threadId: string;
  channelId: string;
  sessionId: string;
  forkedFromMainSessionId: string;
  contextTokens: number;
  compactionCount: number;
}

// New methods needed:
getMainSession(channelId: string): MainSession | null
saveMainSession(channelId: string, session: MainSession): void
getThreadSession(threadId: string): ThreadSession | null
saveThreadSession(threadId: string, session: ThreadSession): void
```

### 4. Message Flow Changes

**File:** `bot-toolkit/src/core/orchestrator.ts`

```
handleMessage(message, responder):
  if message.threadId:
    // Thread message
    threadSession = getThreadSession(message.threadId)
    if threadSession:
      // Resume existing thread session
      resume = threadSession.sessionId
    else:
      // Fork from main session
      mainSession = getMainSession(message.channelId)
      resume = mainSession?.sessionId
      forkSession = true

    result = sendMessage(..., { resume, forkSession })
    saveThreadSession(message.threadId, result)

  else:
    // Channel message - goes to main session
    mainSession = getMainSession(message.channelId)
    resume = mainSession?.sessionId

    result = sendMessage(..., { resume, outputFormat: responseSchema })
    saveMainSession(message.channelId, result)

    if result.shouldRespond:
      // Fork and create new thread
      threadResult = sendMessage(..., {
        resume: result.sessionId,
        forkSession: true,
        prompt: "Post your response now"
      })
      responder.createThread(result.message)
      saveThreadSession(newThreadId, threadResult)
```

### 5. Structured Output for Engagement Decision

**File:** `scribble/src/core/responseSchema.ts` (new)

```typescript
const ResponseSchema = {
  type: 'object',
  properties: {
    shouldRespond: {
      type: 'boolean',
      description: 'Whether Scribble should respond to this message'
    },
    reason: {
      type: 'string',
      description: 'Brief reason for decision (for debugging)'
    },
    message: {
      type: 'string',
      description: 'The response message, if shouldRespond is true'
    }
  },
  required: ['shouldRespond']
}
```

Use Agent SDK's `outputFormat` option for main session messages:

```typescript
outputFormat: {
  type: 'json_schema',
  schema: ResponseSchema
}
```

### 6. Remove/Modify AttentionTracker

**File:** `bot-toolkit/src/core/attentionTracker.ts`

The engagement decision moves from code to Claude. AttentionTracker may still be useful for:
- Tracking which threads have active sessions (for cleanup)
- Timeout handling (disengaging stale threads)
- Dismissal pattern detection (could stay in code for immediate feedback)

Consider keeping dismissal patterns in code for UX (immediate reaction) while Claude handles the broader engagement logic.

### 7. SlackAdapter Changes

**File:** `scribble/src/slack/adapterSDK.ts`

- Remove engagement filtering from `handleMessageWithEngagement()`
- All messages go to orchestrator (which logs them and sends to Claude)
- Orchestrator returns structured response with `shouldRespond`
- If `shouldRespond` and not in thread: use `responder.createThreadStarter()` to start new thread

**Message flow:**

```
Slack message arrives
    ↓
SlackAdapter receives (no filtering)
    ↓
ConversationLogger.logChannelMessage() or logThreadMessage()
    ↓
Orchestrator.handleMessage()
    ├─ Channel message → main session
    │   ↓
    │   Claude decides: respond?
    │   ├─ Yes → fork session, create thread, post response
    │   └─ No → message in context, no Slack response
    │
    └─ Thread message → thread session (fork from main if new)
        ↓
        Claude responds in thread
```

## Database Schema Changes

Add tables/columns for main sessions:

```sql
-- Main sessions (one per channel)
CREATE TABLE main_sessions (
  channel_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  context_tokens INTEGER DEFAULT 0,
  compaction_count INTEGER DEFAULT 0,
  last_activity TEXT NOT NULL
);

-- Thread sessions (forked from main)
CREATE TABLE thread_sessions (
  thread_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  forked_from_session_id TEXT,
  context_tokens INTEGER DEFAULT 0,
  compaction_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
```

## Migration Path

1. Add `systemPrompt` support to `ClaudeSessionManagerSDK` (backwards compatible)
2. Add main/thread session storage (new tables)
3. Update orchestrator to use dual session model
4. Update SlackAdapter to send all messages
5. Update constitution to work with structured output
6. Test in staging before production rollout

## Production Verification Tasks

- [x] Verify DATA_DIRECTORY location in production container → `/app/data`
- [x] Verify constitution files persist across container rebuilds → Yes, EFS mounted
- [x] Verify sessions.db persists across container rebuilds → Yes, EFS mounted
- [x] Check EFS/volume mount configuration → EFS access point at `/scribble`, uid/gid 1000

**Production storage verified:**
- EFS volume mounted at `/app/data` (container) → `/scribble` (EFS)
- `sessions.db` → `/app/data/sessions.db` ✓
- Constitution → `/app/data/wiki/_scribble/constitution-learned.json` ✓
- Channel instructions → `/app/data/wiki/_scribble/channel-instructions.json` ✓

## Open Questions

1. **Cost implications** - Every channel message now hits Claude API. Monitor usage.
2. **Latency** - Main session sees every message; ensure this doesn't slow down channel flow
3. **Dismissal UX** - Keep dismissal patterns in code for immediate emoji reaction?
