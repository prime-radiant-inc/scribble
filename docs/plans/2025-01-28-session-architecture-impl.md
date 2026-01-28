# Scribble Session Architecture Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restructure Scribble to have persistent main sessions per room/DM with constitution loaded, forking to threads when responding.

**Architecture:** Main session per channel sees all messages with constitution in system prompt. Claude decides engagement. Thread sessions fork from main when threads start. Conversation logs split into main channel files and thread files.

**Tech Stack:** TypeScript, bot-toolkit, @anthropic-ai/claude-agent-sdk, better-sqlite3, vitest

---

## Task 1: Add Main/Thread Session Tables to Database

**Files:**
- Modify: `scribble/lib/claude-pa-matrix-bot/packages/bot-toolkit/src/core/database.ts`
- Test: `scribble/lib/claude-pa-matrix-bot/packages/bot-toolkit/src/core/__tests__/database.test.ts`

**Step 1: Write the failing test**

Create the test file if it doesn't exist:

```typescript
// scribble/lib/claude-pa-matrix-bot/packages/bot-toolkit/src/core/__tests__/database.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionDatabase } from '../database.js';
import * as fs from 'fs';

const TEST_DB = '/tmp/bot-toolkit-test-db.sqlite';

describe('SessionDatabase - Main/Thread Sessions', () => {
  let db: SessionDatabase;

  beforeEach(() => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    db = new SessionDatabase(TEST_DB);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  describe('main sessions', () => {
    it('should save and retrieve a main session', () => {
      db.saveMainSession('C123', {
        sessionId: 'sess_abc',
        contextTokens: 1000,
        compactionCount: 0,
      });

      const session = db.getMainSession('C123');
      expect(session).not.toBeNull();
      expect(session!.sessionId).toBe('sess_abc');
      expect(session!.contextTokens).toBe(1000);
    });

    it('should update existing main session', () => {
      db.saveMainSession('C123', { sessionId: 'sess_1', contextTokens: 100, compactionCount: 0 });
      db.saveMainSession('C123', { sessionId: 'sess_2', contextTokens: 200, compactionCount: 1 });

      const session = db.getMainSession('C123');
      expect(session!.sessionId).toBe('sess_2');
      expect(session!.compactionCount).toBe(1);
    });

    it('should return null for non-existent main session', () => {
      const session = db.getMainSession('NONEXISTENT');
      expect(session).toBeNull();
    });
  });

  describe('thread sessions', () => {
    it('should save and retrieve a thread session', () => {
      db.saveThreadSession('1234567890.123456', {
        channelId: 'C123',
        sessionId: 'sess_thread',
        forkedFromSessionId: 'sess_main',
        contextTokens: 500,
        compactionCount: 0,
      });

      const session = db.getThreadSession('1234567890.123456');
      expect(session).not.toBeNull();
      expect(session!.sessionId).toBe('sess_thread');
      expect(session!.forkedFromSessionId).toBe('sess_main');
    });

    it('should return null for non-existent thread session', () => {
      const session = db.getThreadSession('NONEXISTENT');
      expect(session).toBeNull();
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd scribble/lib/claude-pa-matrix-bot/packages/bot-toolkit && npm test -- --run src/core/__tests__/database.test.ts
```

Expected: FAIL - methods `saveMainSession`, `getMainSession`, `saveThreadSession`, `getThreadSession` do not exist.

**Step 3: Add schema and methods to database.ts**

Add after line 67 (after existing schema in `initialize()`):

```typescript
// In the schema string, add:
CREATE TABLE IF NOT EXISTS main_sessions (
  channel_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  context_tokens INTEGER DEFAULT 0,
  compaction_count INTEGER DEFAULT 0,
  last_activity INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS thread_sessions (
  thread_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  forked_from_session_id TEXT,
  context_tokens INTEGER DEFAULT 0,
  compaction_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_thread_sessions_channel ON thread_sessions(channel_id);
```

Add these interfaces near the top of the file (after `SessionRecord`):

```typescript
export interface MainSessionRecord {
  channel_id: string;
  session_id: string;
  context_tokens: number;
  compaction_count: number;
  last_activity: number;
}

export interface ThreadSessionRecord {
  thread_id: string;
  channel_id: string;
  session_id: string;
  forked_from_session_id: string | null;
  context_tokens: number;
  compaction_count: number;
  created_at: number;
}
```

Add these methods to the `SessionDatabase` class:

```typescript
saveMainSession(
  channelId: string,
  data: { sessionId: string; contextTokens: number; compactionCount: number }
): void {
  const now = Date.now();
  const stmt = this._db.prepare(`
    INSERT INTO main_sessions (channel_id, session_id, context_tokens, compaction_count, last_activity)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(channel_id) DO UPDATE SET
      session_id = excluded.session_id,
      context_tokens = excluded.context_tokens,
      compaction_count = excluded.compaction_count,
      last_activity = excluded.last_activity
  `);
  stmt.run(channelId, data.sessionId, data.contextTokens, data.compactionCount, now);
}

getMainSession(channelId: string): MainSessionRecord | null {
  const stmt = this._db.prepare('SELECT * FROM main_sessions WHERE channel_id = ?');
  const row = stmt.get(channelId) as MainSessionRecord | undefined;
  return row ?? null;
}

saveThreadSession(
  threadId: string,
  data: {
    channelId: string;
    sessionId: string;
    forkedFromSessionId: string | null;
    contextTokens: number;
    compactionCount: number;
  }
): void {
  const now = Date.now();
  const stmt = this._db.prepare(`
    INSERT INTO thread_sessions (thread_id, channel_id, session_id, forked_from_session_id, context_tokens, compaction_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(thread_id) DO UPDATE SET
      session_id = excluded.session_id,
      context_tokens = excluded.context_tokens,
      compaction_count = excluded.compaction_count
  `);
  stmt.run(
    threadId,
    data.channelId,
    data.sessionId,
    data.forkedFromSessionId,
    data.contextTokens,
    data.compactionCount,
    now
  );
}

getThreadSession(threadId: string): ThreadSessionRecord | null {
  const stmt = this._db.prepare('SELECT * FROM thread_sessions WHERE thread_id = ?');
  const row = stmt.get(threadId) as ThreadSessionRecord | undefined;
  return row ?? null;
}
```

**Step 4: Run test to verify it passes**

```bash
cd scribble/lib/claude-pa-matrix-bot/packages/bot-toolkit && npm test -- --run src/core/__tests__/database.test.ts
```

Expected: PASS

**Step 5: Export new types from bot-toolkit index**

Modify `scribble/lib/claude-pa-matrix-bot/packages/bot-toolkit/src/index.ts` to export the new types:

```typescript
export type { MainSessionRecord, ThreadSessionRecord } from './core/database.js';
```

**Step 6: Commit**

```bash
git add -A && git commit -m "feat(bot-toolkit): add main_sessions and thread_sessions tables

- Add MainSessionRecord and ThreadSessionRecord interfaces
- Add saveMainSession, getMainSession methods
- Add saveThreadSession, getThreadSession methods
- Add database tests for new session types"
```

---

## Task 2: Add systemPrompt Support to ClaudeSessionManagerSDK

**Files:**
- Modify: `scribble/lib/claude-pa-matrix-bot/packages/bot-toolkit/src/core/sessionManagerSDK.ts`
- Modify: `scribble/lib/claude-pa-matrix-bot/packages/bot-toolkit/src/core/types.ts`

**Step 1: Add systemPrompt to types**

Add to `types.ts` after `SessionCallbacks`:

```typescript
export type SystemPromptConfig =
  | string
  | { type: 'preset'; preset: 'claude_code'; append?: string };
```

**Step 2: Add systemPrompt parameter to sendMessage**

Modify `sendMessage` method signature in `sessionManagerSDK.ts`:

```typescript
async sendMessage(
  roomId: string,
  userMessage: string,
  platform: Platform,
  contextName: string,
  callbacks: SessionCallbacks,
  resumeSession?: { sessionId: string; compactionCount: number },
  options?: {
    systemPrompt?: SystemPromptConfig;
    forkSession?: boolean;
    outputFormat?: { type: 'json_schema'; schema: Record<string, unknown> };
  },
): Promise<SessionResult> {
```

**Step 3: Pass systemPrompt to query options**

Inside `sendMessage`, add to the `options` object passed to `query()`:

```typescript
const queryOptions = {
  resume: resumeSession?.sessionId,
  permissionMode: 'bypassPermissions' as const,
  allowDangerouslySkipPermissions: true,
  cwd: roomDir,
  mcpServers,
  plugins,
  settingSources: ['user', 'project'] as SettingSource[],
  includePartialMessages: true,
  env: {
    ...process.env,
    MATRIX_ROOM_ID: roomId,
    ...(platform === 'cli' ? { CLI_SESSION_ID: roomId } : {}),
  },
  // New options
  ...(options?.systemPrompt && { systemPrompt: options.systemPrompt }),
  ...(options?.forkSession && { forkSession: true }),
  ...(options?.outputFormat && { outputFormat: options.outputFormat }),
};
```

**Step 4: Export SystemPromptConfig from index**

Add to `scribble/lib/claude-pa-matrix-bot/packages/bot-toolkit/src/index.ts`:

```typescript
export type { SystemPromptConfig } from './core/types.js';
```

**Step 5: Commit**

```bash
git add -A && git commit -m "feat(bot-toolkit): add systemPrompt, forkSession, outputFormat to sendMessage

- Add SystemPromptConfig type
- Pass systemPrompt to Agent SDK query()
- Support forkSession for thread forking
- Support outputFormat for structured responses"
```

---

## Task 3: Restructure ConversationLogger for Main/Thread Split

**Files:**
- Modify: `scribble/src/logging/conversationLogger.ts`
- Create: `scribble/src/logging/__tests__/conversationLogger.test.ts`

**Step 1: Write the failing test**

```typescript
// scribble/src/logging/__tests__/conversationLogger.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConversationLogger } from '../conversationLogger.js';
import * as fs from 'fs';
import * as path from 'path';

const TEST_DIR = '/tmp/scribble-test-conversations';

describe('ConversationLogger - Main/Thread Split', () => {
  let logger: ConversationLogger;

  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
    logger = new ConversationLogger(TEST_DIR);
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
  });

  describe('channel messages', () => {
    it('should log channel messages to main.md', async () => {
      await logger.logChannelMessage({
        channelId: 'C123',
        channelName: 'general',
        threadTs: null,
        messageTs: '1234567890.000001',
        userId: 'U456',
        userName: 'Alice',
        text: 'Hello everyone!',
        isMention: false,
        isDm: false,
      });

      const dateStr = new Date().toISOString().split('T')[0];
      const mainFile = path.join(TEST_DIR, 'conversations', 'C123', dateStr, 'main.md');
      expect(fs.existsSync(mainFile)).toBe(true);
      const content = fs.readFileSync(mainFile, 'utf-8');
      expect(content).toContain('Alice');
      expect(content).toContain('Hello everyone!');
    });

    it('should log thread messages to thread file', async () => {
      await logger.logChannelMessage({
        channelId: 'C123',
        channelName: 'general',
        threadTs: '1234567890.000001',
        messageTs: '1234567890.000002',
        userId: 'U456',
        userName: 'Bob',
        text: 'Thread reply',
        isMention: false,
        isDm: false,
      });

      const dateStr = new Date().toISOString().split('T')[0];
      const threadFile = path.join(TEST_DIR, 'conversations', 'C123', dateStr, '1234567890.000001.md');
      expect(fs.existsSync(threadFile)).toBe(true);
      const content = fs.readFileSync(threadFile, 'utf-8');
      expect(content).toContain('Bob');
      expect(content).toContain('Thread reply');
    });
  });

  describe('getChannelContext', () => {
    it('should retrieve recent channel messages', async () => {
      await logger.logChannelMessage({
        channelId: 'C123',
        channelName: 'general',
        threadTs: null,
        messageTs: '1234567890.000001',
        userId: 'U1',
        userName: 'Alice',
        text: 'First message',
        isMention: false,
        isDm: false,
      });

      await logger.logChannelMessage({
        channelId: 'C123',
        channelName: 'general',
        threadTs: null,
        messageTs: '1234567890.000002',
        userId: 'U2',
        userName: 'Bob',
        text: 'Second message',
        isMention: false,
        isDm: false,
      });

      const context = await logger.getChannelContext('C123', 10);
      expect(context).toHaveLength(2);
      expect(context[0].text).toBe('First message');
      expect(context[1].text).toBe('Second message');
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd scribble && npm test -- --run src/logging/__tests__/conversationLogger.test.ts
```

Expected: FAIL - method `logChannelMessage` doesn't exist, `getChannelContext` doesn't exist.

**Step 3: Implement logChannelMessage and getChannelContext**

Replace the existing `logMessage` method and add new methods in `conversationLogger.ts`:

```typescript
/**
 * Log a message - routes to main or thread file based on threadTs
 */
async logChannelMessage(message: SlackMessage): Promise<void> {
  if (message.threadTs) {
    return this.logThreadMessage(message);
  }
  return this.logMainMessage(message);
}

/**
 * Log a message to the main channel file (not in a thread)
 */
private async logMainMessage(message: SlackMessage): Promise<void> {
  const dateStr = this.getDateString();
  const channelDir = path.join(this.dataDir, message.channelId, dateStr);

  if (!fs.existsSync(channelDir)) {
    fs.mkdirSync(channelDir, { recursive: true });
  }

  const mainFile = path.join(channelDir, 'main.md');
  const mainJson = path.join(channelDir, 'main.json');

  const formattedMessage = this.formatMessage(message);
  fs.appendFileSync(mainFile, formattedMessage);

  const storedMessage: StoredMessage = {
    role: 'user',
    userId: message.userId,
    userName: message.userName,
    text: message.text,
    timestamp: new Date(parseFloat(message.messageTs) * 1000).toISOString(),
    messageTs: message.messageTs,
  };
  this.appendToJsonFile(mainJson, storedMessage);

  logger.debug('Channel message logged to main', {
    channel: message.channelId,
    messageTs: message.messageTs,
  });
}

/**
 * Log a message to a thread-specific file
 */
private async logThreadMessage(message: SlackMessage): Promise<void> {
  const dateStr = this.getDateString();
  const channelDir = path.join(this.dataDir, message.channelId, dateStr);

  if (!fs.existsSync(channelDir)) {
    fs.mkdirSync(channelDir, { recursive: true });
  }

  const threadId = message.threadTs!;
  const threadFile = path.join(channelDir, `${threadId}.md`);
  const jsonFile = path.join(channelDir, `${threadId}.json`);

  const formattedMessage = this.formatMessage(message);
  fs.appendFileSync(threadFile, formattedMessage);

  const storedMessage: StoredMessage = {
    role: 'user',
    userId: message.userId,
    userName: message.userName,
    text: message.text,
    timestamp: new Date(parseFloat(message.messageTs) * 1000).toISOString(),
    messageTs: message.messageTs,
  };
  this.appendToJsonFile(jsonFile, storedMessage);

  logger.debug('Thread message logged', {
    channel: message.channelId,
    thread: threadId,
    messageTs: message.messageTs,
  });
}

/**
 * Get recent main channel context for a channel
 * Loads from main.json files across recent dates
 */
async getChannelContext(channelId: string, limit: number = 100): Promise<StoredMessage[]> {
  const channelDir = path.join(this.dataDir, channelId);
  if (!fs.existsSync(channelDir)) {
    return [];
  }

  const allMessages: StoredMessage[] = [];
  const dateDirs = this.getSubdirectories(channelDir).sort().reverse(); // Most recent first

  for (const dateDir of dateDirs) {
    const mainJson = path.join(dateDir, 'main.json');
    if (fs.existsSync(mainJson)) {
      try {
        const content = fs.readFileSync(mainJson, 'utf-8');
        const messages: StoredMessage[] = JSON.parse(content);
        allMessages.push(...messages);
        if (allMessages.length >= limit) break;
      } catch (error) {
        logger.warn('Failed to parse main.json', { mainJson, error });
      }
    }
  }

  // Sort by timestamp and limit
  return allMessages
    .sort((a, b) => parseFloat(a.messageTs) - parseFloat(b.messageTs))
    .slice(-limit);
}
```

**Step 4: Run test to verify it passes**

```bash
cd scribble && npm test -- --run src/logging/__tests__/conversationLogger.test.ts
```

Expected: PASS

**Step 5: Update existing logMessage to use logChannelMessage**

Mark the old `logMessage` as deprecated and have it call `logChannelMessage`:

```typescript
/**
 * @deprecated Use logChannelMessage instead
 */
async logMessage(message: SlackMessage): Promise<void> {
  return this.logChannelMessage(message);
}
```

**Step 6: Commit**

```bash
git add -A && git commit -m "feat(scribble): restructure conversation logging for main/thread split

- Add logChannelMessage that routes to main.md or {thread}.md
- Add getChannelContext to retrieve main channel messages
- Main channel messages go to main.md/main.json
- Thread messages go to {thread_ts}.md/{thread_ts}.json
- Add tests for new logging structure"
```

---

## Task 4: Create Response Schema for Engagement Decision

**Files:**
- Create: `scribble/src/core/responseSchema.ts`
- Create: `scribble/src/core/__tests__/responseSchema.test.ts`

**Step 1: Write the test**

```typescript
// scribble/src/core/__tests__/responseSchema.test.ts
import { describe, it, expect } from 'vitest';
import { ENGAGEMENT_RESPONSE_SCHEMA, parseEngagementResponse, type EngagementResponse } from '../responseSchema.js';

describe('EngagementResponse', () => {
  it('should have required schema properties', () => {
    expect(ENGAGEMENT_RESPONSE_SCHEMA.type).toBe('object');
    expect(ENGAGEMENT_RESPONSE_SCHEMA.properties.shouldRespond).toBeDefined();
    expect(ENGAGEMENT_RESPONSE_SCHEMA.required).toContain('shouldRespond');
  });

  it('should parse valid response with shouldRespond=false', () => {
    const json = '{"shouldRespond": false, "reason": "not addressed"}';
    const result = parseEngagementResponse(json);
    expect(result.shouldRespond).toBe(false);
    expect(result.reason).toBe('not addressed');
    expect(result.message).toBeUndefined();
  });

  it('should parse valid response with shouldRespond=true', () => {
    const json = '{"shouldRespond": true, "message": "Hello!"}';
    const result = parseEngagementResponse(json);
    expect(result.shouldRespond).toBe(true);
    expect(result.message).toBe('Hello!');
  });

  it('should throw on invalid JSON', () => {
    expect(() => parseEngagementResponse('not json')).toThrow();
  });

  it('should throw on missing shouldRespond', () => {
    expect(() => parseEngagementResponse('{"message": "hi"}')).toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd scribble && npm test -- --run src/core/__tests__/responseSchema.test.ts
```

Expected: FAIL - module doesn't exist.

**Step 3: Implement responseSchema.ts**

```typescript
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
```

**Step 4: Run test to verify it passes**

```bash
cd scribble && npm test -- --run src/core/__tests__/responseSchema.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add -A && git commit -m "feat(scribble): add engagement response schema for Claude decisions

- Define EngagementResponse interface
- Define JSON schema for Agent SDK outputFormat
- Add parseEngagementResponse for parsing Claude's response"
```

---

## Task 5: Create ScribbleOrchestrator with Dual Session Logic

**Files:**
- Create: `scribble/src/orchestrator/scribbleOrchestrator.ts`
- Create: `scribble/src/orchestrator/__tests__/scribbleOrchestrator.test.ts`

**Step 1: Write the test for basic structure**

```typescript
// scribble/src/orchestrator/__tests__/scribbleOrchestrator.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScribbleOrchestrator } from '../scribbleOrchestrator.js';

describe('ScribbleOrchestrator', () => {
  const mockDatabase = {
    getMainSession: vi.fn(),
    saveMainSession: vi.fn(),
    getThreadSession: vi.fn(),
    saveThreadSession: vi.fn(),
    isEventProcessed: vi.fn().mockReturnValue(false),
    markEventProcessed: vi.fn(),
  };

  const mockSessionManager = {
    sendMessage: vi.fn(),
  };

  const mockConversationLogger = {
    logChannelMessage: vi.fn(),
  };

  const mockConstitutionManager = {
    getFullConstitution: vi.fn().mockReturnValue('You are Scribble...'),
    getInstructionsForChannel: vi.fn().mockReturnValue(''),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create orchestrator with dependencies', () => {
    const orchestrator = new ScribbleOrchestrator({
      database: mockDatabase as any,
      sessionManager: mockSessionManager as any,
      conversationLogger: mockConversationLogger as any,
      constitutionManager: mockConstitutionManager as any,
      dataDir: '/tmp/test',
    });

    expect(orchestrator).toBeDefined();
  });

  it('should route channel messages to main session', async () => {
    mockSessionManager.sendMessage.mockResolvedValue({
      sessionId: 'sess_main',
      text: '{"shouldRespond": false, "reason": "not addressed"}',
      stats: { contextTokens: 100, outputTokens: 50, costUsd: 0.01, durationMs: 500, compactionCount: 0 },
    });

    const orchestrator = new ScribbleOrchestrator({
      database: mockDatabase as any,
      sessionManager: mockSessionManager as any,
      conversationLogger: mockConversationLogger as any,
      constitutionManager: mockConstitutionManager as any,
      dataDir: '/tmp/test',
    });

    const mockResponder = {
      markProcessing: vi.fn(),
      clearProcessing: vi.fn(),
      setTyping: vi.fn(),
      updateResponse: vi.fn(),
      finalizeResponse: vi.fn(),
      sendNotice: vi.fn(),
      updateChannelStats: vi.fn(),
      markError: vi.fn(),
      createThreadStarter: vi.fn(),
      sendFile: vi.fn(),
    };

    await orchestrator.handleMessage(
      {
        platform: 'slack',
        channelId: 'C123',
        channelName: 'general',
        threadId: null,
        messageId: '123.456',
        senderId: 'U789',
        text: 'Hello room',
        attachments: [],
      },
      mockResponder as any
    );

    // Should have logged the message
    expect(mockConversationLogger.logChannelMessage).toHaveBeenCalled();

    // Should have called sendMessage with main session resume
    expect(mockSessionManager.sendMessage).toHaveBeenCalled();
    const callArgs = mockSessionManager.sendMessage.mock.calls[0];
    expect(callArgs[6]?.systemPrompt).toBeDefined(); // Should have systemPrompt
    expect(callArgs[6]?.outputFormat).toBeDefined(); // Should have outputFormat for engagement
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd scribble && npm test -- --run src/orchestrator/__tests__/scribbleOrchestrator.test.ts
```

Expected: FAIL - module doesn't exist.

**Step 3: Implement ScribbleOrchestrator**

```typescript
// scribble/src/orchestrator/scribbleOrchestrator.ts
import type { SessionDatabase, MainSessionRecord, ThreadSessionRecord } from 'bot-toolkit';
import type { ClaudeSessionManagerSDK } from 'bot-toolkit';
import type { IncomingMessage, PlatformResponder, SessionCallbacks } from 'bot-toolkit';
import { getRoomDirectory, Logger } from 'bot-toolkit';
import type { ConversationLogger } from '../logging/conversationLogger.js';
import type { ConstitutionManager } from '../constitution/manager.js';
import { ENGAGEMENT_RESPONSE_SCHEMA, parseEngagementResponse } from '../core/responseSchema.js';
import type { SlackMessage } from '../core/types.js';

const logger = new Logger('ScribbleOrchestrator');

export interface ScribbleOrchestratorConfig {
  database: SessionDatabase;
  sessionManager: ClaudeSessionManagerSDK;
  conversationLogger: ConversationLogger;
  constitutionManager: ConstitutionManager;
  dataDir: string;
}

export class ScribbleOrchestrator {
  private database: SessionDatabase;
  private sessionManager: ClaudeSessionManagerSDK;
  private conversationLogger: ConversationLogger;
  private constitutionManager: ConstitutionManager;
  private dataDir: string;

  constructor(config: ScribbleOrchestratorConfig) {
    this.database = config.database;
    this.sessionManager = config.sessionManager;
    this.conversationLogger = config.conversationLogger;
    this.constitutionManager = config.constitutionManager;
    this.dataDir = config.dataDir;
  }

  async handleMessage(
    message: IncomingMessage,
    responder: PlatformResponder
  ): Promise<void> {
    // Deduplication
    if (this.database.isEventProcessed(message.messageId)) {
      logger.debug('Skipping already processed message', { messageId: message.messageId });
      return;
    }
    this.database.markEventProcessed(message.messageId, message.channelId);

    // Log the message
    await this.conversationLogger.logChannelMessage(
      this.toSlackMessage(message)
    );

    // Route based on thread vs channel
    if (message.threadId) {
      await this.handleThreadMessage(message, responder);
    } else {
      await this.handleChannelMessage(message, responder);
    }
  }

  private async handleChannelMessage(
    message: IncomingMessage,
    responder: PlatformResponder
  ): Promise<void> {
    await responder.markProcessing();
    await responder.setTyping(true);

    try {
      // Get or create main session
      const mainSession = this.database.getMainSession(message.channelId);
      const resumeSession = mainSession
        ? { sessionId: mainSession.session_id, compactionCount: mainSession.compaction_count }
        : undefined;

      // Build system prompt with constitution
      const constitution = this.constitutionManager.getFullConstitution();
      const channelInstructions = this.constitutionManager.getInstructionsForChannel(message.channelName);
      const systemPromptAppend = constitution + channelInstructions;

      // Create callbacks
      const callbacks = this.createCallbacks(responder);

      // Send to Claude with engagement decision format
      const result = await this.sessionManager.sendMessage(
        message.channelId,
        message.text,
        message.platform,
        message.channelName,
        callbacks,
        resumeSession,
        {
          systemPrompt: { type: 'preset', preset: 'claude_code', append: systemPromptAppend },
          outputFormat: { type: 'json_schema', schema: ENGAGEMENT_RESPONSE_SCHEMA },
        }
      );

      // Save main session
      if (result.sessionId) {
        this.database.saveMainSession(message.channelId, {
          sessionId: result.sessionId,
          contextTokens: result.stats.contextTokens,
          compactionCount: result.stats.compactionCount,
        });
      }

      // Parse engagement decision
      const engagement = parseEngagementResponse(result.text);
      logger.info('Engagement decision', {
        channelId: message.channelId,
        shouldRespond: engagement.shouldRespond,
        reason: engagement.reason,
      });

      if (engagement.shouldRespond && engagement.message) {
        // Fork session and create thread
        await this.forkAndRespond(message, responder, result.sessionId!, engagement.message);
      }

      await responder.setTyping(false);
      await responder.clearProcessing();
      await responder.updateChannelStats(result.stats);
    } catch (error) {
      logger.error('Error handling channel message', { error, messageId: message.messageId });
      await responder.setTyping(false);
      await responder.clearProcessing();
      await responder.markError();
    }
  }

  private async handleThreadMessage(
    message: IncomingMessage,
    responder: PlatformResponder
  ): Promise<void> {
    await responder.markProcessing();
    await responder.setTyping(true);

    try {
      const threadId = message.threadId!;
      let resumeSession: { sessionId: string; compactionCount: number } | undefined;
      let forkSession = false;

      // Check for existing thread session
      const threadSession = this.database.getThreadSession(threadId);
      if (threadSession) {
        resumeSession = {
          sessionId: threadSession.session_id,
          compactionCount: threadSession.compaction_count,
        };
      } else {
        // Fork from main session
        const mainSession = this.database.getMainSession(message.channelId);
        if (mainSession) {
          resumeSession = {
            sessionId: mainSession.session_id,
            compactionCount: mainSession.compaction_count,
          };
          forkSession = true;
        }
      }

      // Build system prompt
      const constitution = this.constitutionManager.getFullConstitution();
      const channelInstructions = this.constitutionManager.getInstructionsForChannel(message.channelName);
      const systemPromptAppend = constitution + channelInstructions;

      const callbacks = this.createCallbacks(responder);

      // Send to Claude (threads always get a response)
      const result = await this.sessionManager.sendMessage(
        message.channelId,
        message.text,
        message.platform,
        message.channelName,
        callbacks,
        resumeSession,
        {
          systemPrompt: { type: 'preset', preset: 'claude_code', append: systemPromptAppend },
          forkSession,
        }
      );

      // Save thread session
      if (result.sessionId) {
        this.database.saveThreadSession(threadId, {
          channelId: message.channelId,
          sessionId: result.sessionId,
          forkedFromSessionId: resumeSession?.sessionId ?? null,
          contextTokens: result.stats.contextTokens,
          compactionCount: result.stats.compactionCount,
        });
      }

      await responder.finalizeResponse();
      await responder.setTyping(false);
      await responder.clearProcessing();
      await responder.updateChannelStats(result.stats);
    } catch (error) {
      logger.error('Error handling thread message', { error, messageId: message.messageId });
      await responder.setTyping(false);
      await responder.clearProcessing();
      await responder.markError();
    }
  }

  private async forkAndRespond(
    message: IncomingMessage,
    responder: PlatformResponder,
    mainSessionId: string,
    responseMessage: string
  ): Promise<void> {
    // Create a new thread
    const threadId = await responder.createThreadStarter(responseMessage);

    // Fork session for the new thread
    const constitution = this.constitutionManager.getFullConstitution();
    const callbacks = this.createCallbacks(responder);

    const result = await this.sessionManager.sendMessage(
      message.channelId,
      `[System: You just started a new thread with this message: "${responseMessage}". The user may reply.]`,
      message.platform,
      message.channelName,
      callbacks,
      { sessionId: mainSessionId, compactionCount: 0 },
      {
        systemPrompt: { type: 'preset', preset: 'claude_code', append: constitution },
        forkSession: true,
      }
    );

    // Save the thread session
    if (result.sessionId) {
      this.database.saveThreadSession(threadId, {
        channelId: message.channelId,
        sessionId: result.sessionId,
        forkedFromSessionId: mainSessionId,
        contextTokens: result.stats.contextTokens,
        compactionCount: result.stats.compactionCount,
      });
    }
  }

  private createCallbacks(responder: PlatformResponder): SessionCallbacks {
    return {
      onSessionStart: async (sessionId) => {
        logger.debug('Session started', { sessionId });
      },
      onCompaction: async ({ preTokens, trigger }) => {
        const notice = `Context compacted (was ${Math.round(preTokens / 1000)}k tokens, trigger: ${trigger})`;
        await responder.sendNotice(notice);
      },
      onText: async (text) => {
        await responder.updateResponse(text);
      },
      onTextDelta: async (text) => {
        await responder.updateResponse(text);
      },
      onToolUse: async (name) => {
        logger.debug('Tool use', { name });
      },
      onFileSend: async (localPath) => {
        await responder.sendFile(localPath);
      },
    };
  }

  private toSlackMessage(message: IncomingMessage): SlackMessage {
    return {
      channelId: message.channelId,
      channelName: message.channelName,
      threadTs: message.threadId,
      messageTs: message.messageId,
      userId: message.senderId,
      userName: message.senderId, // Will be resolved by adapter
      text: message.text,
      isMention: false,
      isDm: false,
    };
  }
}
```

**Step 4: Run test to verify it passes**

```bash
cd scribble && npm test -- --run src/orchestrator/__tests__/scribbleOrchestrator.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add -A && git commit -m "feat(scribble): add ScribbleOrchestrator with dual session logic

- Route channel messages to main session with engagement decision
- Route thread messages to thread sessions (fork from main if new)
- Inject constitution into system prompt
- Use structured output for engagement decisions
- Fork and create threads when Claude decides to respond"
```

---

## Task 6: Update SlackAdapter to Remove Engagement Filtering

**Files:**
- Modify: `scribble/src/slack/adapterSDK.ts`

**Step 1: Simplify handleMessageWithEngagement**

The engagement decision now happens in Claude, not in code. Update `handleMessageWithEngagement` to forward all messages:

```typescript
/**
 * Handle all messages - engagement decision happens in Claude
 */
private async handleMessageWithEngagement(
  event: {
    user: string;
    channel: string;
    ts: string;
    thread_ts?: string;
    text?: string;
    files?: any[];
  },
  isDm: boolean,
  isMention: boolean
): Promise<void> {
  const channelId = event.channel;
  const messageTs = event.ts;
  const threadId = event.thread_ts ?? null;
  const text = event.text || '';

  // Keep dismissal handling for immediate UX feedback
  if (this.attentionTracker && threadId) {
    const effectiveThreadId = threadId ?? messageTs;
    if (this.attentionTracker.isDismissal(text)) {
      logger.info('Dismissal detected, disengaging', { channelId, threadId: effectiveThreadId });
      this.attentionTracker.disengage(effectiveThreadId);
      // Still don't respond to dismissals
      return;
    }
  }

  // Forward all messages to orchestrator
  await this.handleMessage(event);
}
```

**Step 2: Update setupListeners to always use message flow**

The current split between `hasEngagementConfig` and not can be simplified since we always want all messages now.

**Step 3: Commit**

```bash
git add -A && git commit -m "refactor(scribble): remove code-based engagement filtering from SlackAdapter

- Forward all messages to orchestrator
- Keep dismissal patterns for immediate UX feedback
- Engagement decision now happens in Claude via constitution"
```

---

## Task 7: Wire Up ScribbleOrchestrator in Main Entry Point

**Files:**
- Modify: `scribble/src/index.ts`

**Step 1: Replace ConversationOrchestrator with ScribbleOrchestrator**

Update imports:

```typescript
import { ScribbleOrchestrator } from './orchestrator/scribbleOrchestrator.js';
import { ConversationLogger } from './logging/conversationLogger.js';
import { ConstitutionManager } from './constitution/manager.js';
```

Update main() to create ScribbleOrchestrator:

```typescript
// Initialize conversation logger
const conversationLogger = new ConversationLogger(config.dataDirectory);

// Initialize constitution manager
const constitutionManager = new ConstitutionManager(path.join(config.dataDirectory, 'wiki'));

// Initialize orchestrator with Scribble-specific logic
const orchestrator = new ScribbleOrchestrator({
  database,
  sessionManager,
  conversationLogger,
  constitutionManager,
  dataDir: config.dataDirectory,
});

// Initialize Slack adapter
const adapter = new SlackAdapterSDK({
  orchestrator,
  // ... rest of config
});
```

**Step 2: Commit**

```bash
git add -A && git commit -m "feat(scribble): wire up ScribbleOrchestrator in main entry point

- Replace bot-toolkit ConversationOrchestrator with ScribbleOrchestrator
- Initialize ConversationLogger and ConstitutionManager
- Pass all dependencies to orchestrator"
```

---

## Task 8: Integration Testing

**Files:**
- Create: `scribble/src/__tests__/integration.test.ts`

**Step 1: Write integration test**

```typescript
// scribble/src/__tests__/integration.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ScribbleOrchestrator } from '../orchestrator/scribbleOrchestrator.js';
import { ConversationLogger } from '../logging/conversationLogger.js';
import { ConstitutionManager } from '../constitution/manager.js';
import { SessionDatabase } from 'bot-toolkit';
import * as fs from 'fs';

const TEST_DIR = '/tmp/scribble-integration-test';
const TEST_DB = `${TEST_DIR}/sessions.db`;

describe('Scribble Integration', () => {
  let database: SessionDatabase;
  let conversationLogger: ConversationLogger;
  let constitutionManager: ConstitutionManager;

  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
    fs.mkdirSync(`${TEST_DIR}/wiki/_scribble`, { recursive: true });

    database = new SessionDatabase(TEST_DB);
    conversationLogger = new ConversationLogger(TEST_DIR);
    constitutionManager = new ConstitutionManager(`${TEST_DIR}/wiki`);
  });

  afterEach(() => {
    database.close();
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
  });

  it('should save main session after channel message', async () => {
    // This test verifies the database integration
    database.saveMainSession('C123', {
      sessionId: 'sess_test',
      contextTokens: 1000,
      compactionCount: 0,
    });

    const session = database.getMainSession('C123');
    expect(session).not.toBeNull();
    expect(session!.session_id).toBe('sess_test');
  });

  it('should log channel messages to main.json', async () => {
    await conversationLogger.logChannelMessage({
      channelId: 'C123',
      channelName: 'general',
      threadTs: null,
      messageTs: '1234567890.000001',
      userId: 'U456',
      userName: 'Test User',
      text: 'Test message',
      isMention: false,
      isDm: false,
    });

    const context = await conversationLogger.getChannelContext('C123', 10);
    expect(context).toHaveLength(1);
    expect(context[0].text).toBe('Test message');
  });

  it('should build constitution with learned behaviors', () => {
    constitutionManager.addLearnedBehavior('Test behavior', 'U123', 'Testing');

    const constitution = constitutionManager.getFullConstitution();
    expect(constitution).toContain('Test behavior');
    expect(constitution).toContain('diligent colleague'); // Base constitution
  });
});
```

**Step 2: Run integration tests**

```bash
cd scribble && npm test -- --run src/__tests__/integration.test.ts
```

Expected: PASS

**Step 3: Commit**

```bash
git add -A && git commit -m "test(scribble): add integration tests for session architecture

- Test main session database operations
- Test conversation logging to main.json
- Test constitution with learned behaviors"
```

---

## Task 9: Run Full Test Suite and Fix Issues

**Step 1: Run all scribble tests**

```bash
cd scribble && npm test
```

**Step 2: Run bot-toolkit tests**

```bash
cd scribble/lib/claude-pa-matrix-bot/packages/bot-toolkit && npm test
```

**Step 3: Fix any failing tests**

Address each failure individually.

**Step 4: Commit fixes**

```bash
git add -A && git commit -m "fix: address test failures from session architecture changes"
```

---

## Task 10: Build and Verify

**Step 1: Build scribble**

```bash
cd scribble && npm run build
```

**Step 2: Build MCP server**

```bash
cd scribble && npm run build:mcp
```

**Step 3: Build bot-toolkit**

```bash
cd scribble/lib/claude-pa-matrix-bot/packages/bot-toolkit && npm run build
```

**Step 4: Commit if build required changes**

```bash
git add -A && git commit -m "fix: resolve build issues"
```

---

## Summary of Changes

**bot-toolkit changes:**
- Added `main_sessions` and `thread_sessions` tables to database
- Added `systemPrompt`, `forkSession`, `outputFormat` options to `sendMessage`
- Exported new types: `MainSessionRecord`, `ThreadSessionRecord`, `SystemPromptConfig`

**scribble changes:**
- Restructured `ConversationLogger` for main/thread split (`main.md` + `{thread}.md`)
- Created `responseSchema.ts` with engagement decision schema
- Created `ScribbleOrchestrator` with dual session routing logic
- Updated `SlackAdapterSDK` to forward all messages (removed code-based filtering)
- Wired up new orchestrator in `index.ts`

**Data flow:**
1. Slack message → SlackAdapter (no filtering)
2. → ConversationLogger.logChannelMessage() (writes to main.md or thread.md)
3. → ScribbleOrchestrator.handleMessage()
4. → Main session (with constitution + engagement schema) OR thread session (fork if new)
5. → Claude decides engagement → fork and create thread if responding

---

Plan complete and saved to `docs/plans/2025-01-28-session-architecture-impl.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?