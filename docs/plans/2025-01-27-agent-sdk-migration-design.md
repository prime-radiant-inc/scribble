# Scribble Agent SDK Migration Design

## Problem

Scribble manually constructs conversation histories from JSON files instead of using the Anthropic Agent SDK's resumable session features. This causes confusion about conversation context and history.

## Solution

Migrate Scribble to use the Agent SDK with resumable sessions, reusing infrastructure from `claude-pa-matrix-bot` via git submodule.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Scribble Bot                             │
├─────────────────────────────────────────────────────────────┤
│  SlackAdapter (from bot-toolkit, enhanced)                   │
│    ├─ Socket Mode listener                                   │
│    ├─ Engagement logic (name mentions, active threads)       │
│    ├─ Thread root → session ID mapping (SQLite)              │
│    └─ SlackResponder (typing, reactions, message updates)    │
├─────────────────────────────────────────────────────────────┤
│  Agent SDK (query())                                         │
│    ├─ Resumable sessions per thread                          │
│    ├─ System prompt: constitution + behaviors + instructions │
│    ├─ Tool execution loop (automatic)                        │
│    └─ Compaction handling                                    │
├─────────────────────────────────────────────────────────────┤
│  scribble-mcp (custom MCP server)                            │
│    ├─ Wiki tools (9)                                         │
│    ├─ Linear tools (4)                                       │
│    ├─ Learning tools (4)                                     │
│    ├─ Conversation search (1)                                │
│    └─ Channel management (1)                                 │
└─────────────────────────────────────────────────────────────┘
```

---

## Progress

### Phase 1: Enhance bot-toolkit ✅ COMPLETE

**Committed:** `6886ba6` in claude-pa-matrix-bot

- Created `AttentionTracker` (`bot-toolkit/src/core/attentionTracker.ts`)
  - Lazy SQLite table creation (no migrations for bots that don't use it)
  - Name mention detection
  - Active thread tracking with timeout
  - Dismissal pattern detection
- Enhanced `SlackAdapter` (`claude-pa-bot/src/platforms/slack/adapter.ts`)
  - Optional `engagement` config
  - Without config: original behavior (DMs + @mentions only)
  - With config: filters all messages via AttentionTracker

### Phase 2: Create scribble-mcp ✅ COMPLETE

**Location:** `scribble/src/mcp/index.ts`

- 18 tools implemented:
  - Wiki: `wiki_create`, `wiki_read`, `wiki_edit`, `wiki_delete`, `wiki_rename`, `wiki_search`, `wiki_list`, `wiki_history`, `wiki_read_version`
  - Conversation: `conversation_search`
  - Learning: `learn_behavior`, `list_behaviors`, `set_channel_instruction`, `list_channel_instructions`
  - Linear: `linear_search`, `linear_suggest`, `linear_confirm`, `linear_cancel`
  - Channel: `leave_channel`
- Builds to `dist/mcp.js` via esbuild
- Reuses existing managers from Scribble codebase

---

## Phase 3: Migrate Scribble to Agent SDK

### Step 3.1: Add Git Submodule

```bash
cd /Users/jesse/prime-radiant/scribble
git submodule add https://github.com/prime-radiant-inc/claude-pa-matrix-bot.git lib/claude-pa-matrix-bot
```

**Result:**
```
scribble/
  lib/
    claude-pa-matrix-bot/
      packages/
        bot-toolkit/        # Shared infrastructure
        claude-pa-bot/      # Platform adapters (Slack, Matrix, CLI)
```

### Step 3.2: Update package.json

```json
{
  "dependencies": {
    "bot-toolkit": "file:./lib/claude-pa-matrix-bot/packages/bot-toolkit"
  }
}
```

Remove dependencies that bot-toolkit provides:
- Keep: `@slack/bolt`, `@slack/web-api`, `simple-git`, `@linear/sdk`
- These are used by scribble-mcp and may have different versions

### Step 3.3: Create New Entry Point

**File:** `src/index.ts` (replace existing)

```typescript
import {
  SessionDatabase,
  MessageSessionStore,
  ClaudeSessionManagerSDK,
  ConversationOrchestrator,
  Logger,
  getRoomDirectory,
} from 'bot-toolkit';
import { SlackAdapter, SlackAdapterConfig } from 'bot-toolkit/platforms/slack';
import { ConstitutionManager } from './constitution/manager.js';
import { ConversationLogger } from './logging/conversationLogger.js';
import { loadConfig } from './config/config.js';

const logger = new Logger('Scribble');

async function main() {
  const config = loadConfig();

  // Initialize database
  const database = new SessionDatabase(`${config.dataDirectory}/infrastructure/sessions.db`);
  const sessionStore = new MessageSessionStore(database.db);

  // Initialize managers for system prompt
  const constitutionManager = new ConstitutionManager(`${config.dataDirectory}/wiki`);
  const conversationLogger = new ConversationLogger(config.dataDirectory);

  // Build system prompt function
  const buildSystemPrompt = (channelId: string, channelName: string) => {
    const constitution = constitutionManager.getFullConstitution();
    const channelInstructions = constitutionManager.getInstructionsForChannel(channelName);

    return `${constitution}${channelInstructions}

## Current Context
- Channel: #${channelName} (${channelId})
- Platform: Slack
`;
  };

  // Create session manager
  const sessionManager = new ClaudeSessionManagerSDK({
    dataDir: config.dataDirectory,
    mcpServers: {
      'scribble': {
        command: 'node',
        args: [`${__dirname}/mcp.js`],
        env: {
          DATA_DIRECTORY: config.dataDirectory,
          WIKI_REPO: config.wikiRepo,
          GITHUB_TOKEN: config.githubToken || '',
          LINEAR_API_KEY: config.linearApiKey || '',
        },
      },
    },
    buildSystemPrompt,
  });

  // Create orchestrator
  const orchestrator = new ConversationOrchestrator({
    sessionManager,
    sessionStore,
    database,
    conversationLogger, // For audit trail
  });

  // Create Slack adapter with engagement config
  const adapter = new SlackAdapter({
    botToken: config.slackBotToken,
    appToken: config.slackAppToken,
    orchestrator,
    authorizedUsers: [], // All users allowed
    dataDir: config.dataDirectory,
    database,
    engagement: {
      nameMentions: ['scribble', 'scrib'],
      trackActiveThreads: true,
      dismissalPatterns: [
        /thanks?,?\s*scribble/i,
        /thank\s+you,?\s*scribble/i,
        /nevermind/i,
        /never\s*mind/i,
        /that'?s?\s+all/i,
      ],
      threadTimeout: 30 * 60 * 1000, // 30 minutes
    },
  });

  // Start
  await adapter.start();
  logger.info('Scribble started');

  // Graceful shutdown
  process.on('SIGINT', async () => {
    logger.info('Shutting down...');
    await adapter.stop();
    database.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
```

### Step 3.4: Update ConversationOrchestrator Usage

The bot-toolkit's `ConversationOrchestrator` expects certain callbacks. We need to either:

**Option A:** Use bot-toolkit's orchestrator directly (simpler)
- Provides: thread locking, deduplication, session resumption
- We just need to wire up the callbacks

**Option B:** Create a thin wrapper (more control)
- Wrap bot-toolkit orchestrator
- Add Scribble-specific logic (audit logging, etc.)

**Recommended: Option A** - Use directly, add audit logging via callbacks.

### Step 3.5: Wire Up Callbacks

```typescript
const orchestrator = new ConversationOrchestrator({
  sessionManager,
  sessionStore,
  database,
  callbacks: {
    onMessageReceived: async (message) => {
      // Audit log incoming message
      await conversationLogger.logMessage(message);
    },
    onResponseSent: async (message, response) => {
      // Audit log response
      await conversationLogger.logBotResponse(
        message.channelId,
        message.threadId || message.messageId,
        response.text,
        response.messageId,
      );
    },
  },
});
```

### Step 3.6: Remove Old Code

**Delete these files/directories:**
- `src/core/orchestrator.ts` - Replaced by bot-toolkit orchestrator
- `src/context/assembler.ts` - No longer needed (Claude uses tools)
- `src/extraction/` - KnowledgeExtractor no longer needed
- `src/classification/` - MessageClassifier replaced by engagement config
- `src/attention/tracker.ts` - Replaced by bot-toolkit AttentionTracker

**Keep these files:**
- `src/constitution/` - Used by MCP and system prompt
- `src/logging/conversationLogger.ts` - For audit trail
- `src/wiki/wikiManager.ts` - Used by MCP
- `src/tools/streamlinear.ts` - Used by MCP
- `src/state/stateStore.ts` - May still be useful for channel membership
- `src/mcp/` - The new MCP server
- `src/config/` - Configuration loading
- `src/telemetry/` - Metrics (if still wanted)

### Step 3.7: Update Imports

Update remaining files to use bot-toolkit imports where appropriate:
- Logger: `import { Logger } from 'bot-toolkit';`
- Types: May need adapter layer for type compatibility

---

## Phase 4: Testing & Cleanup

### Step 4.1: Build Everything

```bash
# Build bot-toolkit submodule
cd lib/claude-pa-matrix-bot
pnpm install
pnpm run build

# Build Scribble
cd ../..
npm install
npm run build
npm run build:mcp
```

### Step 4.2: Test Session Resumption

**Test case 1: New conversation**
1. @mention Scribble in a channel
2. Verify response
3. Check SQLite for new session mapping

**Test case 2: Resume conversation**
1. Reply in same thread
2. Verify Scribble remembers context from previous message
3. Check SQLite session ID matches

**Test case 3: Thread timeout**
1. Start conversation
2. Wait 30+ minutes (or temporarily reduce timeout)
3. Send another message
4. Verify new session created

### Step 4.3: Test Engagement Logic

**Test case 1: @mention**
- Send `@scribble hello` → Should respond

**Test case 2: Name mention**
- Send `hey scribble, what's up?` → Should respond

**Test case 3: Active thread**
- After engaging, send plain message in thread → Should respond

**Test case 4: Dismissal**
- Send `thanks scribble` → Should NOT respond, disengage

**Test case 5: Unrelated message**
- Send message in channel without mention → Should NOT respond

### Step 4.4: Test MCP Tools

**Wiki tools:**
```
@scribble create a wiki page about testing at knowledge/processes/testing.md
@scribble search the wiki for "deployment"
@scribble what's the history of knowledge/people/jesse.md?
```

**Learning tools:**
```
@scribble learn to always use bullet points when listing things
@scribble list your learned behaviors
@scribble set a channel instruction for #engineering: focus on technical details
```

**Linear tools:**
```
@scribble search linear for authentication bugs
@scribble suggest a ticket: "Fix login timeout" with description "Users report..."
@scribble confirm that ticket suggestion
```

### Step 4.5: Remove Dead Code

After testing, remove:
- Old orchestrator and all its imports
- ContextAssembler and related context injection code
- KnowledgeExtractor and extraction pipeline
- MessageClassifier
- Old AttentionTracker (use bot-toolkit's)
- Any unused utilities

### Step 4.6: Update Documentation

- Update `CLAUDE.md` with new architecture
- Update environment variable documentation
- Document new MCP tools
- Update deployment instructions

### Step 4.7: Update Deployment

**Docker/deployment changes:**
- Ensure submodule is cloned in CI/CD
- Build bot-toolkit before Scribble
- Ensure MCP server binary is included
- Update environment variables if needed

---

## File Structure After Migration

```
scribble/
├── lib/
│   └── claude-pa-matrix-bot/      # Git submodule
│       └── packages/
│           ├── bot-toolkit/        # Shared infrastructure
│           └── claude-pa-bot/      # Platform adapters
├── src/
│   ├── index.ts                    # New entry point
│   ├── mcp/
│   │   └── index.ts                # MCP server (18 tools)
│   ├── constitution/
│   │   ├── base.ts                 # BASE_CONSTITUTION
│   │   ├── manager.ts              # ConstitutionManager
│   │   └── types.ts
│   ├── logging/
│   │   └── conversationLogger.ts   # Audit trail only
│   ├── wiki/
│   │   └── wikiManager.ts          # Used by MCP
│   ├── tools/
│   │   └── streamlinear.ts         # Used by MCP
│   ├── config/
│   │   └── config.ts               # Configuration
│   └── telemetry/                  # Optional metrics
├── data/                           # Runtime data
│   ├── infrastructure/
│   │   └── sessions.db             # Session + engagement tracking
│   ├── wiki/                       # Cloned wiki repo
│   ├── conversations/              # Audit logs
│   └── rooms/slack/                # Per-channel data
├── dist/
│   ├── index.js                    # Main bot
│   └── mcp.js                      # MCP server
└── package.json
```

---

## Rollback Plan

If issues arise:
1. Revert to previous Scribble version (git)
2. Deploy old version
3. Investigate issues in staging

The old code remains in git history and can be restored if needed.

---

## Success Criteria

1. **Session continuity**: Conversations maintain context across messages
2. **Engagement works**: Scribble responds to @mentions, name mentions, active threads
3. **Dismissal works**: "thanks scribble" ends engagement
4. **All tools work**: Wiki, Linear, learning tools function correctly
5. **No regressions**: Existing functionality preserved
6. **Clean codebase**: Dead code removed, clear architecture
