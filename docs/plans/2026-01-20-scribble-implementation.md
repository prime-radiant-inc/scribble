# Scribble Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild Scribble as a diligent colleague who watches everything, speaks only when addressed, maintains living documentation, tracks standups, and integrates with Linear.

**Architecture:** Three-stage pipeline (classify → extract → respond), attention tracking per-thread, text file storage (no SQLite), two-layer constitution (immutable + learned), cross-channel context assembly.

**Tech Stack:** TypeScript, Slack Bolt, Anthropic SDK (Haiku), simple-git, StreamLinear MCP, vitest for testing.

---

## Phase 1: Replace SQLite with Text File Storage

### Task 1.1: Create State Store Interface and Types

**Files:**
- Create: `src/state/types.ts`
- Create: `src/state/stateStore.ts`
- Test: `src/state/__tests__/stateStore.test.ts`

**Step 1: Write the failing test**

```typescript
// src/state/__tests__/stateStore.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StateStore } from '../stateStore.js';
import * as fs from 'fs';
import * as path from 'path';

const TEST_DIR = '/tmp/scribble-test-state';

describe('StateStore', () => {
  let store: StateStore;

  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
    fs.mkdirSync(TEST_DIR, { recursive: true });
    store = new StateStore(TEST_DIR);
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true });
  });

  it('should track processed messages', () => {
    expect(store.isMessageProcessed('123.456')).toBe(false);
    store.markMessageProcessed('123.456', 'C123');
    expect(store.isMessageProcessed('123.456')).toBe(true);
  });

  it('should track channel membership', () => {
    expect(store.getJoinedChannels()).toEqual([]);
    store.markChannelJoined('C123', 'general');
    expect(store.getJoinedChannels()).toContain('C123');
    store.markChannelLeft('C123');
    expect(store.getJoinedChannels()).not.toContain('C123');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/state/__tests__/stateStore.test.ts`
Expected: FAIL - module not found

**Step 3: Create types file**

```typescript
// src/state/types.ts
export interface ProcessedMessageRecord {
  messageTs: string;
  channelId: string;
  processedAt: number;
}

export interface ChannelRecord {
  channelId: string;
  channelName: string;
  joinedAt: number;
  isMember: boolean;
}

export interface ActiveThread {
  threadId: string;        // thread_ts or message_ts
  channelId: string;
  channelName: string;
  engagedAt: number;       // when Scribble was engaged
  lastActivity: number;    // last message timestamp
  topicSummary: string;    // what the conversation is about
  participants: string[];  // user IDs involved
}

export interface StandupCommitment {
  person: string;
  personName: string;
  date: string;            // YYYY-MM-DD
  commitments: string[];
  blockers: string[];
  completed: string[];
  rawText: string;
}
```

**Step 4: Implement StateStore**

```typescript
// src/state/stateStore.ts
import * as fs from 'fs';
import * as path from 'path';
import { ProcessedMessageRecord, ChannelRecord, ActiveThread } from './types.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('StateStore');

export class StateStore {
  private stateDir: string;
  private processedDir: string;
  private channelsFile: string;
  private activeThreadsFile: string;

  constructor(dataDir: string) {
    this.stateDir = path.join(dataDir, 'state');
    this.processedDir = path.join(this.stateDir, 'processed');
    this.channelsFile = path.join(this.stateDir, 'channels.json');
    this.activeThreadsFile = path.join(this.stateDir, 'active-threads.json');
    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    [this.stateDir, this.processedDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  // Processed messages - stored by date to enable cleanup
  isMessageProcessed(messageTs: string): boolean {
    const date = this.getDateFromTs(messageTs);
    const file = path.join(this.processedDir, `${date}.json`);
    if (!fs.existsSync(file)) return false;
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return messageTs in data;
  }

  markMessageProcessed(messageTs: string, channelId: string): void {
    const date = this.getDateFromTs(messageTs);
    const file = path.join(this.processedDir, `${date}.json`);
    let data: Record<string, ProcessedMessageRecord> = {};
    if (fs.existsSync(file)) {
      data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    }
    data[messageTs] = { messageTs, channelId, processedAt: Date.now() };
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  }

  private getDateFromTs(ts: string): string {
    const timestamp = parseFloat(ts) * 1000;
    return new Date(timestamp).toISOString().split('T')[0];
  }

  // Channel membership
  getJoinedChannels(): string[] {
    if (!fs.existsSync(this.channelsFile)) return [];
    const data: Record<string, ChannelRecord> = JSON.parse(
      fs.readFileSync(this.channelsFile, 'utf-8')
    );
    return Object.values(data)
      .filter(c => c.isMember)
      .map(c => c.channelId);
  }

  markChannelJoined(channelId: string, channelName: string): void {
    let data: Record<string, ChannelRecord> = {};
    if (fs.existsSync(this.channelsFile)) {
      data = JSON.parse(fs.readFileSync(this.channelsFile, 'utf-8'));
    }
    data[channelId] = {
      channelId,
      channelName,
      joinedAt: Date.now(),
      isMember: true,
    };
    fs.writeFileSync(this.channelsFile, JSON.stringify(data, null, 2));
  }

  markChannelLeft(channelId: string): void {
    if (!fs.existsSync(this.channelsFile)) return;
    const data: Record<string, ChannelRecord> = JSON.parse(
      fs.readFileSync(this.channelsFile, 'utf-8')
    );
    if (data[channelId]) {
      data[channelId].isMember = false;
      fs.writeFileSync(this.channelsFile, JSON.stringify(data, null, 2));
    }
  }

  // Cleanup old processed messages
  cleanOldMessages(daysToKeep: number = 30): void {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysToKeep);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    const files = fs.readdirSync(this.processedDir);
    let deleted = 0;
    for (const file of files) {
      const date = file.replace('.json', '');
      if (date < cutoffStr) {
        fs.unlinkSync(path.join(this.processedDir, file));
        deleted++;
      }
    }
    logger.info('Cleaned old processed messages', { deleted });
  }
}
```

**Step 5: Run tests to verify they pass**

Run: `npm test -- src/state/__tests__/stateStore.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/state/
git commit -m "feat: add StateStore for text-file-based state management"
```

---

### Task 1.2: Add Active Thread Tracking to StateStore

**Files:**
- Modify: `src/state/stateStore.ts`
- Modify: `src/state/__tests__/stateStore.test.ts`

**Step 1: Add failing tests**

```typescript
// Add to src/state/__tests__/stateStore.test.ts

describe('ActiveThread tracking', () => {
  it('should track active threads', () => {
    const thread: ActiveThread = {
      threadId: '123.456',
      channelId: 'C123',
      channelName: 'general',
      engagedAt: Date.now(),
      lastActivity: Date.now(),
      topicSummary: 'Discussing wiki setup',
      participants: ['U123', 'U456'],
    };

    store.setActiveThread(thread);
    expect(store.getActiveThread('C123', '123.456')).toEqual(thread);
    expect(store.isThreadActive('C123', '123.456')).toBe(true);
  });

  it('should remove inactive threads', () => {
    const thread: ActiveThread = {
      threadId: '123.456',
      channelId: 'C123',
      channelName: 'general',
      engagedAt: Date.now(),
      lastActivity: Date.now(),
      topicSummary: 'Test',
      participants: ['U123'],
    };

    store.setActiveThread(thread);
    store.removeActiveThread('C123', '123.456');
    expect(store.isThreadActive('C123', '123.456')).toBe(false);
  });

  it('should list all active threads', () => {
    const thread1: ActiveThread = {
      threadId: '111.111',
      channelId: 'C123',
      channelName: 'general',
      engagedAt: Date.now(),
      lastActivity: Date.now(),
      topicSummary: 'Topic 1',
      participants: ['U123'],
    };
    const thread2: ActiveThread = {
      threadId: '222.222',
      channelId: 'C456',
      channelName: 'random',
      engagedAt: Date.now(),
      lastActivity: Date.now(),
      topicSummary: 'Topic 2',
      participants: ['U456'],
    };

    store.setActiveThread(thread1);
    store.setActiveThread(thread2);

    const active = store.getAllActiveThreads();
    expect(active).toHaveLength(2);
  });
});
```

**Step 2: Run tests to verify failure**

Run: `npm test -- src/state/__tests__/stateStore.test.ts`
Expected: FAIL - methods not found

**Step 3: Add ActiveThread import and methods to StateStore**

```typescript
// Add to src/state/stateStore.ts

// Add import at top
import { ProcessedMessageRecord, ChannelRecord, ActiveThread } from './types.js';

// Add methods to class
  // Active thread tracking
  private getActiveThreadsData(): Record<string, ActiveThread> {
    if (!fs.existsSync(this.activeThreadsFile)) return {};
    return JSON.parse(fs.readFileSync(this.activeThreadsFile, 'utf-8'));
  }

  private saveActiveThreadsData(data: Record<string, ActiveThread>): void {
    fs.writeFileSync(this.activeThreadsFile, JSON.stringify(data, null, 2));
  }

  private threadKey(channelId: string, threadId: string): string {
    return `${channelId}:${threadId}`;
  }

  isThreadActive(channelId: string, threadId: string): boolean {
    const data = this.getActiveThreadsData();
    return this.threadKey(channelId, threadId) in data;
  }

  getActiveThread(channelId: string, threadId: string): ActiveThread | null {
    const data = this.getActiveThreadsData();
    return data[this.threadKey(channelId, threadId)] || null;
  }

  setActiveThread(thread: ActiveThread): void {
    const data = this.getActiveThreadsData();
    data[this.threadKey(thread.channelId, thread.threadId)] = thread;
    this.saveActiveThreadsData(data);
  }

  removeActiveThread(channelId: string, threadId: string): void {
    const data = this.getActiveThreadsData();
    delete data[this.threadKey(channelId, threadId)];
    this.saveActiveThreadsData(data);
  }

  getAllActiveThreads(): ActiveThread[] {
    return Object.values(this.getActiveThreadsData());
  }

  updateThreadActivity(channelId: string, threadId: string): void {
    const thread = this.getActiveThread(channelId, threadId);
    if (thread) {
      thread.lastActivity = Date.now();
      this.setActiveThread(thread);
    }
  }
```

**Step 4: Run tests**

Run: `npm test -- src/state/__tests__/stateStore.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/state/
git commit -m "feat: add active thread tracking to StateStore"
```

---

### Task 1.3: Migrate Database Usage to StateStore

**Files:**
- Modify: `src/slack/adapter.ts`
- Modify: `src/slack/channelManager.ts`
- Modify: `src/core/orchestrator.ts`
- Modify: `src/index.ts`
- Modify: `src/config/config.ts`
- Delete: `src/core/database.ts` (after migration)

**Step 1: Update config to remove database path**

```typescript
// src/config/config.ts - remove database section from Config interface and loadConfig
// Remove these lines:
//   database: {
//     path: string;
//   };
// and
//   database: {
//     path: databasePath,
//   },
```

**Step 2: Update index.ts to use StateStore**

```typescript
// src/index.ts
import { SlackAdapter } from './slack/adapter.js';
import { ScribbleOrchestrator } from './core/orchestrator.js';
import { StateStore } from './state/stateStore.js';
import { ConversationLogger } from './logging/conversationLogger.js';
import { WikiManager } from './wiki/wikiManager.js';
import { loadConfig } from './config/config.js';
import { Logger } from './utils/logger.js';

const logger = new Logger('Main');

async function main() {
  logger.info('Starting Scribble bot...');

  const config = loadConfig();

  // Initialize state store (replaces database)
  const stateStore = new StateStore(config.dataDirectory);

  // Initialize conversation logger
  const conversationLogger = new ConversationLogger(config.dataDirectory);

  // Initialize wiki manager
  const wikiManager = new WikiManager(
    config.wiki.localPath,
    config.wiki.repo,
    config.github.token
  );

  try {
    await wikiManager.initialize();
    logger.info('Wiki repository initialized');
  } catch (error) {
    logger.error('Failed to initialize wiki repository', error);
  }

  // Initialize orchestrator
  const orchestrator = new ScribbleOrchestrator({
    config,
    stateStore,
    conversationLogger,
    wikiManager,
  });

  // Initialize Slack adapter
  const adapter = new SlackAdapter({
    botToken: config.slack.botToken,
    appToken: config.slack.appToken,
    stateStore,
    orchestrator,
    dataDir: config.dataDirectory,
  });

  await adapter.start();
  logger.info('Scribble bot started successfully');

  // Periodic cleanup
  setInterval(() => {
    stateStore.cleanOldMessages(30);
  }, 24 * 60 * 60 * 1000);

  const shutdown = async () => {
    logger.info('Shutting down...');
    await adapter.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  logger.error('Fatal error', error);
  process.exit(1);
});
```

**Step 3: Update SlackAdapter to use StateStore**

Replace all `this.database` with `this.stateStore` in `src/slack/adapter.ts`:
- Change `database: ScribbleDatabase` to `stateStore: StateStore` in interface
- Change constructor parameter and property
- Replace method calls (they have the same names)

**Step 4: Update ChannelManager to use StateStore**

Same pattern - replace database with stateStore.

**Step 5: Update Orchestrator to use StateStore**

Same pattern - replace database with stateStore.

**Step 6: Remove better-sqlite3 dependency**

```bash
npm uninstall better-sqlite3 @types/better-sqlite3
```

**Step 7: Delete database.ts**

```bash
rm src/core/database.ts
```

**Step 8: Verify build passes**

Run: `npm run build`
Expected: Successful compilation

**Step 9: Commit**

```bash
git add -A
git commit -m "refactor: replace SQLite with text file StateStore"
```

---

## Phase 2: Attention System

### Task 2.1: Create Attention Tracker

**Files:**
- Create: `src/attention/tracker.ts`
- Create: `src/attention/types.ts`
- Test: `src/attention/__tests__/tracker.test.ts`

**Step 1: Write failing tests**

```typescript
// src/attention/__tests__/tracker.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AttentionTracker } from '../tracker.js';
import { StateStore } from '../../state/stateStore.js';
import * as fs from 'fs';

const TEST_DIR = '/tmp/scribble-test-attention';

describe('AttentionTracker', () => {
  let tracker: AttentionTracker;
  let stateStore: StateStore;

  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
    fs.mkdirSync(TEST_DIR, { recursive: true });
    stateStore = new StateStore(TEST_DIR);
    tracker = new AttentionTracker(stateStore, 'U_SCRIBBLE');
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true });
  });

  describe('engagement detection', () => {
    it('should detect @mention', () => {
      const result = tracker.shouldEngage({
        text: 'Hey <@U_SCRIBBLE> can you help?',
        channelId: 'C123',
        threadTs: null,
      });
      expect(result.shouldEngage).toBe(true);
      expect(result.reason).toBe('mention');
    });

    it('should detect name usage', () => {
      const result = tracker.shouldEngage({
        text: 'Scribble, what do you think?',
        channelId: 'C123',
        threadTs: null,
      });
      expect(result.shouldEngage).toBe(true);
      expect(result.reason).toBe('name');
    });

    it('should detect active thread', () => {
      tracker.engage('C123', '111.222', 'general', 'Test topic');
      const result = tracker.shouldEngage({
        text: 'What about this approach?',
        channelId: 'C123',
        threadTs: '111.222',
      });
      expect(result.shouldEngage).toBe(true);
      expect(result.reason).toBe('active_thread');
    });

    it('should not engage on random messages', () => {
      const result = tracker.shouldEngage({
        text: 'Hey team, lunch at noon?',
        channelId: 'C123',
        threadTs: null,
      });
      expect(result.shouldEngage).toBe(false);
    });
  });

  describe('disengagement', () => {
    it('should disengage on dismissal', () => {
      tracker.engage('C123', '111.222', 'general', 'Test');
      expect(tracker.isEngaged('C123', '111.222')).toBe(true);

      const shouldDisengage = tracker.checkDisengagement(
        'C123',
        '111.222',
        'Thanks Scribble, that helps!'
      );
      expect(shouldDisengage).toBe(true);
    });

    it('should disengage on explicit dismissal', () => {
      tracker.engage('C123', '111.222', 'general', 'Test');
      const shouldDisengage = tracker.checkDisengagement(
        'C123',
        '111.222',
        'Scribble, be quiet'
      );
      expect(shouldDisengage).toBe(true);
    });
  });
});
```

**Step 2: Run tests to verify failure**

Run: `npm test -- src/attention/__tests__/tracker.test.ts`
Expected: FAIL - module not found

**Step 3: Create types**

```typescript
// src/attention/types.ts
export interface EngagementCheck {
  text: string;
  channelId: string;
  threadTs: string | null;
}

export interface EngagementResult {
  shouldEngage: boolean;
  reason?: 'mention' | 'name' | 'active_thread' | 'dm';
}

export const DISMISSAL_PATTERNS = [
  /thanks?\s*,?\s*scribble/i,
  /scribble,?\s*be\s*quiet/i,
  /that'?s?\s*all,?\s*scribble/i,
  /got\s*it,?\s*scribble/i,
  /ok\s*scribble/i,
  /bye\s*scribble/i,
];

export const NAME_PATTERNS = [
  /\bscribble\b/i,
];
```

**Step 4: Implement AttentionTracker**

```typescript
// src/attention/tracker.ts
import { StateStore } from '../state/stateStore.js';
import { ActiveThread } from '../state/types.js';
import {
  EngagementCheck,
  EngagementResult,
  DISMISSAL_PATTERNS,
  NAME_PATTERNS,
} from './types.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('AttentionTracker');

export class AttentionTracker {
  private stateStore: StateStore;
  private botUserId: string;

  constructor(stateStore: StateStore, botUserId: string) {
    this.stateStore = stateStore;
    this.botUserId = botUserId;
  }

  shouldEngage(check: EngagementCheck): EngagementResult {
    // Check for @mention
    if (check.text.includes(`<@${this.botUserId}>`)) {
      return { shouldEngage: true, reason: 'mention' };
    }

    // Check for name usage
    for (const pattern of NAME_PATTERNS) {
      if (pattern.test(check.text)) {
        return { shouldEngage: true, reason: 'name' };
      }
    }

    // Check if already in active thread
    const threadId = check.threadTs || check.channelId; // Use channelId for main channel
    if (this.stateStore.isThreadActive(check.channelId, threadId)) {
      return { shouldEngage: true, reason: 'active_thread' };
    }

    return { shouldEngage: false };
  }

  engage(
    channelId: string,
    threadId: string,
    channelName: string,
    topicSummary: string,
    participants: string[] = []
  ): void {
    const thread: ActiveThread = {
      threadId,
      channelId,
      channelName,
      engagedAt: Date.now(),
      lastActivity: Date.now(),
      topicSummary,
      participants,
    };
    this.stateStore.setActiveThread(thread);
    logger.info('Engaged in thread', { channelId, threadId, topicSummary });
  }

  disengage(channelId: string, threadId: string): void {
    this.stateStore.removeActiveThread(channelId, threadId);
    logger.info('Disengaged from thread', { channelId, threadId });
  }

  isEngaged(channelId: string, threadId: string): boolean {
    return this.stateStore.isThreadActive(channelId, threadId);
  }

  checkDisengagement(channelId: string, threadId: string, text: string): boolean {
    for (const pattern of DISMISSAL_PATTERNS) {
      if (pattern.test(text)) {
        this.disengage(channelId, threadId);
        return true;
      }
    }
    return false;
  }

  updateActivity(channelId: string, threadId: string): void {
    this.stateStore.updateThreadActivity(channelId, threadId);
  }

  getActiveThread(channelId: string, threadId: string): ActiveThread | null {
    return this.stateStore.getActiveThread(channelId, threadId);
  }

  getAllActiveThreads(): ActiveThread[] {
    return this.stateStore.getAllActiveThreads();
  }
}
```

**Step 5: Run tests**

Run: `npm test -- src/attention/__tests__/tracker.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/attention/
git commit -m "feat: add AttentionTracker for engagement management"
```

---

### Task 2.2: Add Stale Thread Cleanup

**Files:**
- Modify: `src/attention/tracker.ts`
- Modify: `src/attention/__tests__/tracker.test.ts`

**Step 1: Add failing test**

```typescript
// Add to src/attention/__tests__/tracker.test.ts

describe('stale thread cleanup', () => {
  it('should clean up threads inactive for too long', () => {
    // Create a thread that's been inactive
    tracker.engage('C123', '111.222', 'general', 'Old topic');

    // Manually set lastActivity to 5 hours ago
    const thread = tracker.getActiveThread('C123', '111.222')!;
    thread.lastActivity = Date.now() - (5 * 60 * 60 * 1000);
    stateStore.setActiveThread(thread);

    // Cleanup threads older than 4 hours
    tracker.cleanupStaleThreads(4 * 60 * 60 * 1000);

    expect(tracker.isEngaged('C123', '111.222')).toBe(false);
  });

  it('should keep recent threads', () => {
    tracker.engage('C123', '333.444', 'general', 'Recent topic');

    tracker.cleanupStaleThreads(4 * 60 * 60 * 1000);

    expect(tracker.isEngaged('C123', '333.444')).toBe(true);
  });
});
```

**Step 2: Run tests to verify failure**

Run: `npm test -- src/attention/__tests__/tracker.test.ts`
Expected: FAIL - method not found

**Step 3: Implement cleanupStaleThreads**

```typescript
// Add to AttentionTracker class in src/attention/tracker.ts

cleanupStaleThreads(maxInactiveMs: number = 4 * 60 * 60 * 1000): void {
  const now = Date.now();
  const threads = this.stateStore.getAllActiveThreads();
  let cleaned = 0;

  for (const thread of threads) {
    if (now - thread.lastActivity > maxInactiveMs) {
      this.stateStore.removeActiveThread(thread.channelId, thread.threadId);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    logger.info('Cleaned up stale threads', { cleaned });
  }
}
```

**Step 4: Run tests**

Run: `npm test -- src/attention/__tests__/tracker.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/attention/
git commit -m "feat: add stale thread cleanup to AttentionTracker"
```

---

## Phase 3: Pipeline Architecture

### Task 3.1: Create Message Classifier

**Files:**
- Create: `src/pipeline/classifier.ts`
- Create: `src/pipeline/types.ts`
- Test: `src/pipeline/__tests__/classifier.test.ts`

**Step 1: Write failing tests**

```typescript
// src/pipeline/__tests__/classifier.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageClassifier } from '../classifier.js';
import { SlackMessage } from '../../core/types.js';

describe('MessageClassifier', () => {
  let classifier: MessageClassifier;

  beforeEach(() => {
    classifier = new MessageClassifier('U_SCRIBBLE');
  });

  const makeMessage = (overrides: Partial<SlackMessage> = {}): SlackMessage => ({
    channelId: 'C123',
    channelName: 'general',
    threadTs: null,
    messageTs: '123.456',
    userId: 'U123',
    userName: 'testuser',
    text: 'Hello world',
    isMention: false,
    isDm: false,
    ...overrides,
  });

  describe('isStandup', () => {
    it('should detect standup format', () => {
      const msg = makeMessage({
        text: 'Yesterday: Fixed bugs\nToday: Working on feature\nBlockers: None',
      });
      expect(classifier.isStandup(msg)).toBe(true);
    });

    it('should detect commitment language', () => {
      const msg = makeMessage({
        text: "I'll finish the auth refactor today",
      });
      expect(classifier.hasCommitment(msg)).toBe(true);
    });
  });

  describe('engagement classification', () => {
    it('should classify @mention', () => {
      const msg = makeMessage({
        text: 'Hey <@U_SCRIBBLE> can you help?',
        isMention: true,
      });
      const result = classifier.classify(msg);
      expect(result.requiresResponse).toBe(true);
      expect(result.engagementType).toBe('mention');
    });

    it('should classify DM', () => {
      const msg = makeMessage({ isDm: true });
      const result = classifier.classify(msg);
      expect(result.requiresResponse).toBe(true);
      expect(result.engagementType).toBe('dm');
    });

    it('should classify passive message', () => {
      const msg = makeMessage({ text: 'Anyone want coffee?' });
      const result = classifier.classify(msg);
      expect(result.requiresResponse).toBe(false);
    });
  });
});
```

**Step 2: Run tests to verify failure**

Run: `npm test -- src/pipeline/__tests__/classifier.test.ts`
Expected: FAIL - module not found

**Step 3: Create pipeline types**

```typescript
// src/pipeline/types.ts
import { SlackMessage } from '../core/types.js';

export type EngagementType = 'mention' | 'name' | 'dm' | 'active_thread' | 'none';

export interface ClassificationResult {
  message: SlackMessage;
  requiresResponse: boolean;
  engagementType: EngagementType;
  isStandup: boolean;
  hasCommitment: boolean;
  hasTask: boolean;
  hasBlocker: boolean;
}

export interface ExtractionResult {
  people: PersonMention[];
  tasks: TaskMention[];
  decisions: DecisionMention[];
  commitments: CommitmentMention[];
  blockers: BlockerMention[];
}

export interface PersonMention {
  userId: string;
  userName: string;
  context: string;  // What was said about them
}

export interface TaskMention {
  description: string;
  assignee?: string;
  dueDate?: string;
  confidence: number;
}

export interface DecisionMention {
  decision: string;
  context: string;
  confidence: number;
}

export interface CommitmentMention {
  person: string;
  commitment: string;
  timeframe?: string;
}

export interface BlockerMention {
  description: string;
  affectedPerson?: string;
  severity: 'low' | 'medium' | 'high';
}
```

**Step 4: Implement MessageClassifier**

```typescript
// src/pipeline/classifier.ts
import { SlackMessage } from '../core/types.js';
import { ClassificationResult, EngagementType } from './types.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('MessageClassifier');

const STANDUP_PATTERNS = [
  /yesterday:?\s/i,
  /today:?\s/i,
  /blockers?:?\s/i,
  /\bdid\b.*\bwill\b/i,
  /\bworking on\b/i,
];

const COMMITMENT_PATTERNS = [
  /i'?ll\s+(finish|complete|do|work on|get|have)/i,
  /going to\s+(finish|complete|do|work on)/i,
  /plan to\s+(finish|complete|do|work on)/i,
  /will\s+(finish|complete|do|work on|have)/i,
];

const TASK_PATTERNS = [
  /we need to/i,
  /someone should/i,
  /todo:?\s/i,
  /action item:?\s/i,
  /can you\s+(please\s+)?(do|make|create|fix|update)/i,
];

const BLOCKER_PATTERNS = [
  /blocked\s+(on|by)/i,
  /waiting\s+(on|for)/i,
  /can'?t\s+proceed/i,
  /dependency\s+on/i,
  /need\s+.*\s+before/i,
];

export class MessageClassifier {
  private botUserId: string;

  constructor(botUserId: string) {
    this.botUserId = botUserId;
  }

  classify(message: SlackMessage): ClassificationResult {
    const engagementType = this.getEngagementType(message);

    return {
      message,
      requiresResponse: engagementType !== 'none',
      engagementType,
      isStandup: this.isStandup(message),
      hasCommitment: this.hasCommitment(message),
      hasTask: this.hasTask(message),
      hasBlocker: this.hasBlocker(message),
    };
  }

  private getEngagementType(message: SlackMessage): EngagementType {
    if (message.isDm) return 'dm';
    if (message.isMention || message.text.includes(`<@${this.botUserId}>`)) {
      return 'mention';
    }
    if (/\bscribble\b/i.test(message.text)) return 'name';
    return 'none';
  }

  isStandup(message: SlackMessage): boolean {
    let matchCount = 0;
    for (const pattern of STANDUP_PATTERNS) {
      if (pattern.test(message.text)) matchCount++;
    }
    return matchCount >= 2;
  }

  hasCommitment(message: SlackMessage): boolean {
    return COMMITMENT_PATTERNS.some(p => p.test(message.text));
  }

  hasTask(message: SlackMessage): boolean {
    return TASK_PATTERNS.some(p => p.test(message.text));
  }

  hasBlocker(message: SlackMessage): boolean {
    return BLOCKER_PATTERNS.some(p => p.test(message.text));
  }
}
```

**Step 5: Run tests**

Run: `npm test -- src/pipeline/__tests__/classifier.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/pipeline/
git commit -m "feat: add MessageClassifier for pipeline stage 1"
```

---

### Task 3.2: Create Knowledge Extractor

**Files:**
- Create: `src/pipeline/extractor.ts`
- Test: `src/pipeline/__tests__/extractor.test.ts`

**Step 1: Write failing tests**

```typescript
// src/pipeline/__tests__/extractor.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KnowledgeExtractor } from '../extractor.js';
import { SlackMessage } from '../../core/types.js';
import Anthropic from '@anthropic-ai/sdk';

// Mock Anthropic
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn(),
    },
  })),
}));

describe('KnowledgeExtractor', () => {
  let extractor: KnowledgeExtractor;
  let mockAnthropic: any;

  beforeEach(() => {
    mockAnthropic = {
      messages: {
        create: vi.fn(),
      },
    };
    extractor = new KnowledgeExtractor(mockAnthropic);
  });

  const makeMessage = (text: string): SlackMessage => ({
    channelId: 'C123',
    channelName: 'general',
    threadTs: null,
    messageTs: '123.456',
    userId: 'U123',
    userName: 'testuser',
    text,
    isMention: false,
    isDm: false,
  });

  it('should extract commitments from standup', async () => {
    mockAnthropic.messages.create.mockResolvedValue({
      content: [{
        type: 'text',
        text: JSON.stringify({
          commitments: [{ person: 'testuser', commitment: 'finish auth refactor', timeframe: 'today' }],
          tasks: [],
          decisions: [],
          blockers: [],
          people: [],
        }),
      }],
    });

    const msg = makeMessage("Yesterday: Fixed login bug\nToday: I'll finish the auth refactor\nBlockers: none");
    const result = await extractor.extract(msg);

    expect(result.commitments).toHaveLength(1);
    expect(result.commitments[0].commitment).toContain('auth refactor');
  });

  it('should extract blockers', async () => {
    mockAnthropic.messages.create.mockResolvedValue({
      content: [{
        type: 'text',
        text: JSON.stringify({
          commitments: [],
          tasks: [],
          decisions: [],
          blockers: [{ description: 'API changes', affectedPerson: 'testuser', severity: 'high' }],
          people: [],
        }),
      }],
    });

    const msg = makeMessage("I'm blocked on the API changes from the backend team");
    const result = await extractor.extract(msg);

    expect(result.blockers).toHaveLength(1);
    expect(result.blockers[0].description).toContain('API');
  });
});
```

**Step 2: Run tests to verify failure**

Run: `npm test -- src/pipeline/__tests__/extractor.test.ts`
Expected: FAIL - module not found

**Step 3: Implement KnowledgeExtractor**

```typescript
// src/pipeline/extractor.ts
import Anthropic from '@anthropic-ai/sdk';
import { SlackMessage } from '../core/types.js';
import { ExtractionResult } from './types.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('KnowledgeExtractor');

const EXTRACTION_PROMPT = `You are extracting structured information from a Slack message.

Extract the following if present:
- commitments: What did this person commit to doing? Include timeframe if mentioned.
- tasks: Action items or todos mentioned (not personal commitments, but team tasks)
- decisions: Any decisions announced or made
- blockers: Anything blocking progress
- people: Information about people mentioned (expertise, roles, involvement)

Respond with JSON only, no markdown:
{
  "commitments": [{"person": "name", "commitment": "what", "timeframe": "when or null"}],
  "tasks": [{"description": "what", "assignee": "who or null", "dueDate": "when or null", "confidence": 0.0-1.0}],
  "decisions": [{"decision": "what", "context": "why", "confidence": 0.0-1.0}],
  "blockers": [{"description": "what", "affectedPerson": "who or null", "severity": "low|medium|high"}],
  "people": [{"userId": "if known", "userName": "name", "context": "what was said about them"}]
}

If nothing to extract for a category, use empty array.`;

export class KnowledgeExtractor {
  private anthropic: Anthropic;

  constructor(anthropic: Anthropic) {
    this.anthropic = anthropic;
  }

  async extract(message: SlackMessage): Promise<ExtractionResult> {
    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 1024,
        system: EXTRACTION_PROMPT,
        messages: [{
          role: 'user',
          content: `Channel: #${message.channelName}\nUser: ${message.userName}\nMessage: ${message.text}`,
        }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';

      // Parse JSON, handling potential markdown wrapping
      const cleaned = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);

      if (!jsonMatch) {
        logger.warn('No JSON found in extraction response', { text: text.substring(0, 100) });
        return this.emptyResult();
      }

      return JSON.parse(jsonMatch[0]) as ExtractionResult;
    } catch (error) {
      logger.error('Extraction failed', { error, messageTs: message.messageTs });
      return this.emptyResult();
    }
  }

  private emptyResult(): ExtractionResult {
    return {
      people: [],
      tasks: [],
      decisions: [],
      commitments: [],
      blockers: [],
    };
  }
}
```

**Step 4: Run tests**

Run: `npm test -- src/pipeline/__tests__/extractor.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pipeline/
git commit -m "feat: add KnowledgeExtractor for pipeline stage 2"
```

---

### Task 3.3: Create Context Assembler

**Files:**
- Create: `src/context/assembler.ts`
- Create: `src/context/types.ts`
- Test: `src/context/__tests__/assembler.test.ts`

**Step 1: Write failing tests**

```typescript
// src/context/__tests__/assembler.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ContextAssembler } from '../assembler.js';
import { ConversationLogger } from '../../logging/conversationLogger.js';
import { WikiManager } from '../../wiki/wikiManager.js';
import * as fs from 'fs';

const TEST_DIR = '/tmp/scribble-test-context';

describe('ContextAssembler', () => {
  let assembler: ContextAssembler;
  let conversationLogger: ConversationLogger;

  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
    fs.mkdirSync(TEST_DIR, { recursive: true });
    conversationLogger = new ConversationLogger(TEST_DIR);
    // WikiManager would need mocking for full tests
    assembler = new ContextAssembler(conversationLogger, null as any);
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true });
  });

  it('should format cross-channel context with attribution', () => {
    const context = assembler.formatCrossChannelContext([
      {
        channelName: 'engineering',
        userName: 'Drew',
        text: 'The auth refactor is blocked on API changes',
        timestamp: new Date('2026-01-19').toISOString(),
      },
    ]);

    expect(context).toContain('[From #engineering');
    expect(context).toContain('Drew');
    expect(context).toContain('auth refactor');
  });

  it('should respect context budget', async () => {
    // This tests that we don't exceed token limits
    const longMessages = Array(100).fill({
      channelName: 'general',
      userName: 'User',
      text: 'This is a test message that is reasonably long to simulate real conversations.',
      timestamp: new Date().toISOString(),
    });

    const context = assembler.formatCrossChannelContext(longMessages, { maxMessages: 10 });
    const messageCount = (context.match(/\[From #/g) || []).length;
    expect(messageCount).toBeLessThanOrEqual(10);
  });
});
```

**Step 2: Run tests to verify failure**

Run: `npm test -- src/context/__tests__/assembler.test.ts`
Expected: FAIL - module not found

**Step 3: Create context types**

```typescript
// src/context/types.ts
export interface ContextMessage {
  channelId?: string;
  channelName: string;
  userName: string;
  text: string;
  timestamp: string;
  threadTs?: string;
}

export interface AssembledContext {
  currentThread: string;
  channelRecent: string;
  crossChannel: string;
  wikiReferences: string;
  linearReferences: string;
}

export interface ContextOptions {
  maxMessages?: number;
  maxTokens?: number;
  includeWiki?: boolean;
  includeLinear?: boolean;
}
```

**Step 4: Implement ContextAssembler**

```typescript
// src/context/assembler.ts
import { ConversationLogger } from '../logging/conversationLogger.js';
import { WikiManager } from '../wiki/wikiManager.js';
import { ContextMessage, AssembledContext, ContextOptions } from './types.js';
import { SlackMessage } from '../core/types.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('ContextAssembler');

const DEFAULT_OPTIONS: ContextOptions = {
  maxMessages: 20,
  maxTokens: 4000,
  includeWiki: true,
  includeLinear: true,
};

export class ContextAssembler {
  private conversationLogger: ConversationLogger;
  private wikiManager: WikiManager | null;

  constructor(conversationLogger: ConversationLogger, wikiManager: WikiManager | null) {
    this.conversationLogger = conversationLogger;
    this.wikiManager = wikiManager;
  }

  async assemble(
    message: SlackMessage,
    options: ContextOptions = {}
  ): Promise<AssembledContext> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    // Get current thread messages
    const currentThread = await this.getCurrentThread(message);

    // Get recent channel messages (excluding current thread)
    const channelRecent = await this.getChannelRecent(message, opts.maxMessages!);

    // Search for cross-channel context based on current topic
    const crossChannel = await this.getCrossChannelContext(message, opts.maxMessages!);

    // Get relevant wiki pages
    const wikiReferences = opts.includeWiki
      ? await this.getWikiReferences(message.text)
      : '';

    return {
      currentThread,
      channelRecent,
      crossChannel,
      wikiReferences,
      linearReferences: '', // Implemented in Phase 7
    };
  }

  private async getCurrentThread(message: SlackMessage): Promise<string> {
    const threadTs = message.threadTs || message.messageTs;
    const messages = await this.conversationLogger.getRecentMessages(message.channelId, 50);

    // Filter to current thread and format
    return messages
      .filter(m => m.includes(threadTs))
      .join('\n\n');
  }

  private async getChannelRecent(message: SlackMessage, limit: number): Promise<string> {
    const messages = await this.conversationLogger.getRecentMessages(message.channelId, limit);
    return messages.slice(0, limit).join('\n\n---\n\n');
  }

  private async getCrossChannelContext(message: SlackMessage, limit: number): Promise<string> {
    // Extract key terms from current message for searching
    const searchTerms = this.extractSearchTerms(message.text);
    if (searchTerms.length === 0) return '';

    const results = await this.conversationLogger.search(searchTerms.join(' '), { limit });

    // Filter out current channel and format with attribution
    const crossChannelResults = results.filter(r => r.channelId !== message.channelId);

    return crossChannelResults
      .map(r => `[From #${r.channelId}, ${r.date}]\n${r.snippet}`)
      .join('\n\n');
  }

  private extractSearchTerms(text: string): string[] {
    // Extract meaningful terms (skip common words)
    const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
      'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used',
      'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into',
      'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under',
      'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why',
      'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
      'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just',
      'and', 'but', 'if', 'or', 'because', 'until', 'while', 'although', 'though',
      'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your',
      'yours', 'yourself', 'yourselves', 'he', 'him', 'his', 'himself', 'she', 'her',
      'hers', 'herself', 'it', 'its', 'itself', 'they', 'them', 'their', 'theirs',
      'themselves', 'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
      'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being']);

    const words = text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w));

    // Return unique terms, max 5
    return [...new Set(words)].slice(0, 5);
  }

  private async getWikiReferences(text: string): Promise<string> {
    if (!this.wikiManager) return '';

    try {
      const searchTerms = this.extractSearchTerms(text);
      if (searchTerms.length === 0) return '';

      const results = await this.wikiManager.search(searchTerms.join(' '));
      return results
        .slice(0, 3)
        .map(r => `[Wiki: ${r.title}]\n${r.snippet}`)
        .join('\n\n');
    } catch (error) {
      logger.warn('Wiki search failed', { error });
      return '';
    }
  }

  formatCrossChannelContext(
    messages: ContextMessage[],
    options: { maxMessages?: number } = {}
  ): string {
    const limit = options.maxMessages || 20;
    return messages
      .slice(0, limit)
      .map(m => {
        const date = new Date(m.timestamp).toLocaleDateString();
        return `[From #${m.channelName}, ${date}]\n${m.userName}: ${m.text}`;
      })
      .join('\n\n');
  }
}
```

**Step 5: Run tests**

Run: `npm test -- src/context/__tests__/assembler.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/context/
git commit -m "feat: add ContextAssembler for cross-channel awareness"
```

---

## Phase 4: Constitution System

### Task 4.1: Create Constitution Manager

**Files:**
- Create: `src/constitution/manager.ts`
- Create: `src/constitution/types.ts`
- Create: `src/constitution/base.ts`
- Test: `src/constitution/__tests__/manager.test.ts`

**Step 1: Write failing tests**

```typescript
// src/constitution/__tests__/manager.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConstitutionManager } from '../manager.js';
import { WikiManager } from '../../wiki/wikiManager.js';
import * as fs from 'fs';
import * as path from 'path';

const TEST_DIR = '/tmp/scribble-test-constitution';

describe('ConstitutionManager', () => {
  let manager: ConstitutionManager;

  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
    fs.mkdirSync(path.join(TEST_DIR, '_scribble'), { recursive: true });
    manager = new ConstitutionManager(TEST_DIR);
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true });
  });

  it('should return base constitution', () => {
    const constitution = manager.getFullConstitution();
    expect(constitution).toContain('diligent colleague');
    expect(constitution).toContain('only speak when addressed');
  });

  it('should allow adding learned behaviors', () => {
    manager.addLearnedBehavior('Always check Linear before suggesting new tickets', 'U123', 'Asked by user');

    const constitution = manager.getFullConstitution();
    expect(constitution).toContain('check Linear');
  });

  it('should log changes', () => {
    manager.addLearnedBehavior('Be more concise', 'U123', 'User preference');

    const log = manager.getChangeLog();
    expect(log).toHaveLength(1);
    expect(log[0].change).toContain('concise');
    expect(log[0].requestedBy).toBe('U123');
  });

  it('should not allow modifying immutable sections', () => {
    expect(() => {
      manager.addLearnedBehavior('Respond to every message', 'U123', 'test');
    }).toThrow(/immutable/i);
  });
});
```

**Step 2: Run tests to verify failure**

Run: `npm test -- src/constitution/__tests__/manager.test.ts`
Expected: FAIL - module not found

**Step 3: Create types**

```typescript
// src/constitution/types.ts
export interface LearnedBehavior {
  id: string;
  behavior: string;
  addedAt: string;
  requestedBy: string;
  reasoning: string;
}

export interface ConstitutionChange {
  id: string;
  timestamp: string;
  change: string;
  requestedBy: string;
  reasoning: string;
}

export interface LearnedConstitution {
  behaviors: LearnedBehavior[];
}
```

**Step 4: Create base constitution**

```typescript
// src/constitution/base.ts
export const BASE_CONSTITUTION = `# Scribble - Core Constitution

## Identity (Immutable)

You are Scribble, a diligent colleague at Prime Radiant. You are NOT an assistant, chatbot, or AI helper. You are a team member who happens to have perfect memory and is in every channel.

## Core Behaviors (Immutable)

### Engagement Rules
- You ONLY speak when addressed: @mentioned, your name is used, or you're in an active conversation
- You watch EVERY message but stay silent unless engaged
- When dismissed ("thanks Scribble", "Scribble be quiet"), acknowledge briefly (emoji or nothing) and stop responding
- Never insert yourself into conversations where you weren't invited

### Safety Rules
- Never share information from one channel in another without clear relevance and attribution
- Never create Linear tickets without explicit confirmation
- Never make significant wiki changes without confirmation for important pages
- Respect that some conversations are not your business even if you can see them

## Response Style

- Be concise and helpful, like a knowledgeable colleague
- Don't use phrases like "Let me know if you need anything else!" or "Happy to help!"
- Don't be chatty or over-explain
- If you don't know something, say so directly
- Offer relevant context proactively ("btw, Drew mentioned X in #engineering yesterday")
- Use Slack formatting appropriately (bold, code blocks, lists)

## Knowledge Management

### What to Track
- Tasks and commitments (route to Linear with confirmation)
- Decisions (add to wiki)
- Process information (update wiki)
- People information (update wiki)
- Blockers and issues (offer to create Linear tickets)

### Standup Behavior
- Watch for standup messages (yesterday/today/blockers format)
- Track commitments people make
- Follow up next standup in-thread: "How'd the [X] go?" (helpful, not naggy)
- Don't follow up if they already mentioned it or skipped a day

## Tool Usage

### Wiki
- Maintain living documentation - update existing pages, don't create fragments
- When you learn something new about a topic, find the relevant page and update it
- Ask before making significant changes to important pages

### Linear (via StreamLinear)
- Search before suggesting new tickets
- Always confirm before creating: "Want me to create a ticket for that?"
- Include relevant context in ticket descriptions

## Learned Behaviors

The following behaviors have been added based on team feedback:

`;

// Patterns that indicate attempts to modify immutable behavior
export const IMMUTABLE_PATTERNS = [
  /respond to (every|all) message/i,
  /always respond/i,
  /never stay silent/i,
  /share (everything|all information)/i,
  /create tickets? (without|automatically)/i,
  /ignore (safety|privacy)/i,
  /stop being (a colleague|scribble)/i,
];
```

**Step 5: Implement ConstitutionManager**

```typescript
// src/constitution/manager.ts
import * as fs from 'fs';
import * as path from 'path';
import { LearnedBehavior, LearnedConstitution, ConstitutionChange } from './types.js';
import { BASE_CONSTITUTION, IMMUTABLE_PATTERNS } from './base.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('ConstitutionManager');

export class ConstitutionManager {
  private wikiDir: string;
  private learnedFile: string;
  private logFile: string;

  constructor(wikiDir: string) {
    this.wikiDir = wikiDir;
    this.learnedFile = path.join(wikiDir, '_scribble', 'constitution-learned.json');
    this.logFile = path.join(wikiDir, '_scribble', 'constitution-log.json');
    this.ensureFiles();
  }

  private ensureFiles(): void {
    const dir = path.dirname(this.learnedFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.learnedFile)) {
      fs.writeFileSync(this.learnedFile, JSON.stringify({ behaviors: [] }, null, 2));
    }
    if (!fs.existsSync(this.logFile)) {
      fs.writeFileSync(this.logFile, JSON.stringify([], null, 2));
    }
  }

  getFullConstitution(): string {
    const learned = this.getLearnedBehaviors();
    const learnedSection = learned.length > 0
      ? learned.map(b => `- ${b.behavior}`).join('\n')
      : '(None yet)';

    return BASE_CONSTITUTION + learnedSection;
  }

  getLearnedBehaviors(): LearnedBehavior[] {
    const data: LearnedConstitution = JSON.parse(fs.readFileSync(this.learnedFile, 'utf-8'));
    return data.behaviors;
  }

  addLearnedBehavior(behavior: string, requestedBy: string, reasoning: string): void {
    // Check if this attempts to modify immutable behavior
    for (const pattern of IMMUTABLE_PATTERNS) {
      if (pattern.test(behavior)) {
        throw new Error(`Cannot add behavior that modifies immutable rules: "${behavior}"`);
      }
    }

    const learned: LearnedConstitution = JSON.parse(fs.readFileSync(this.learnedFile, 'utf-8'));

    const newBehavior: LearnedBehavior = {
      id: `lb_${Date.now()}`,
      behavior,
      addedAt: new Date().toISOString(),
      requestedBy,
      reasoning,
    };

    learned.behaviors.push(newBehavior);
    fs.writeFileSync(this.learnedFile, JSON.stringify(learned, null, 2));

    // Log the change
    this.logChange(behavior, requestedBy, reasoning);

    logger.info('Added learned behavior', { behavior, requestedBy });
  }

  removeLearnedBehavior(id: string): void {
    const learned: LearnedConstitution = JSON.parse(fs.readFileSync(this.learnedFile, 'utf-8'));
    learned.behaviors = learned.behaviors.filter(b => b.id !== id);
    fs.writeFileSync(this.learnedFile, JSON.stringify(learned, null, 2));
  }

  private logChange(change: string, requestedBy: string, reasoning: string): void {
    const log: ConstitutionChange[] = JSON.parse(fs.readFileSync(this.logFile, 'utf-8'));

    log.push({
      id: `cc_${Date.now()}`,
      timestamp: new Date().toISOString(),
      change,
      requestedBy,
      reasoning,
    });

    fs.writeFileSync(this.logFile, JSON.stringify(log, null, 2));
  }

  getChangeLog(): ConstitutionChange[] {
    return JSON.parse(fs.readFileSync(this.logFile, 'utf-8'));
  }
}
```

**Step 6: Run tests**

Run: `npm test -- src/constitution/__tests__/manager.test.ts`
Expected: PASS

**Step 7: Commit**

```bash
git add src/constitution/
git commit -m "feat: add ConstitutionManager with immutable/learned behavior split"
```

---

## Phase 5: Standup Tracking

### Task 5.1: Create Standup Tracker

**Files:**
- Create: `src/standup/tracker.ts`
- Create: `src/standup/types.ts`
- Test: `src/standup/__tests__/tracker.test.ts`

**Step 1: Write failing tests**

```typescript
// src/standup/__tests__/tracker.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StandupTracker } from '../tracker.js';
import * as fs from 'fs';
import * as path from 'path';

const TEST_DIR = '/tmp/scribble-test-standup';

describe('StandupTracker', () => {
  let tracker: StandupTracker;

  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
    fs.mkdirSync(TEST_DIR, { recursive: true });
    tracker = new StandupTracker(TEST_DIR);
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true });
  });

  it('should record standup commitments', () => {
    tracker.recordStandup({
      person: 'U123',
      personName: 'Jesse',
      date: '2026-01-20',
      commitments: ['Finish auth refactor', 'Review PRs'],
      blockers: [],
      completed: ['Fixed login bug'],
      rawText: 'Yesterday: Fixed login bug\nToday: Finish auth refactor, Review PRs',
    });

    const standup = tracker.getStandup('U123', '2026-01-20');
    expect(standup).not.toBeNull();
    expect(standup!.commitments).toContain('Finish auth refactor');
  });

  it('should get pending followups', () => {
    tracker.recordStandup({
      person: 'U123',
      personName: 'Jesse',
      date: '2026-01-19',
      commitments: ['Finish auth refactor'],
      blockers: [],
      completed: [],
      rawText: 'Today: Finish auth refactor',
    });

    const followups = tracker.getPendingFollowups('U123', '2026-01-20');
    expect(followups).toHaveLength(1);
    expect(followups[0]).toContain('auth refactor');
  });

  it('should not return followups if person had no commitments', () => {
    tracker.recordStandup({
      person: 'U123',
      personName: 'Jesse',
      date: '2026-01-19',
      commitments: [],
      blockers: [],
      completed: ['Fixed bugs'],
      rawText: 'Yesterday: Fixed bugs\nToday: nothing planned',
    });

    const followups = tracker.getPendingFollowups('U123', '2026-01-20');
    expect(followups).toHaveLength(0);
  });

  it('should not return followups if already addressed', () => {
    tracker.recordStandup({
      person: 'U123',
      personName: 'Jesse',
      date: '2026-01-19',
      commitments: ['Finish auth refactor'],
      blockers: [],
      completed: [],
      rawText: 'Today: Finish auth refactor',
    });

    tracker.recordStandup({
      person: 'U123',
      personName: 'Jesse',
      date: '2026-01-20',
      commitments: [],
      blockers: [],
      completed: ['Finished auth refactor'],
      rawText: 'Yesterday: Finished auth refactor\nToday: nothing',
    });

    const followups = tracker.getPendingFollowups('U123', '2026-01-20');
    expect(followups).toHaveLength(0);
  });
});
```

**Step 2: Run tests to verify failure**

Run: `npm test -- src/standup/__tests__/tracker.test.ts`
Expected: FAIL - module not found

**Step 3: Create types**

```typescript
// src/standup/types.ts
export interface StandupRecord {
  person: string;
  personName: string;
  date: string;
  commitments: string[];
  blockers: string[];
  completed: string[];
  rawText: string;
  recordedAt: string;
}

export interface StandupFile {
  standups: StandupRecord[];
}
```

**Step 4: Implement StandupTracker**

```typescript
// src/standup/tracker.ts
import * as fs from 'fs';
import * as path from 'path';
import { StandupRecord, StandupFile } from './types.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('StandupTracker');

export class StandupTracker {
  private standupDir: string;

  constructor(dataDir: string) {
    this.standupDir = path.join(dataDir, 'standups');
    if (!fs.existsSync(this.standupDir)) {
      fs.mkdirSync(this.standupDir, { recursive: true });
    }
  }

  private getFilePath(person: string): string {
    return path.join(this.standupDir, `${person}.json`);
  }

  private loadPersonStandups(person: string): StandupFile {
    const filePath = this.getFilePath(person);
    if (!fs.existsSync(filePath)) {
      return { standups: [] };
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }

  private savePersonStandups(person: string, data: StandupFile): void {
    fs.writeFileSync(this.getFilePath(person), JSON.stringify(data, null, 2));
  }

  recordStandup(record: Omit<StandupRecord, 'recordedAt'>): void {
    const data = this.loadPersonStandups(record.person);

    // Remove existing standup for same date if present
    data.standups = data.standups.filter(s => s.date !== record.date);

    data.standups.push({
      ...record,
      recordedAt: new Date().toISOString(),
    });

    // Keep only last 30 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    data.standups = data.standups.filter(s => s.date >= cutoffStr);

    this.savePersonStandups(record.person, data);
    logger.info('Recorded standup', { person: record.personName, date: record.date });
  }

  getStandup(person: string, date: string): StandupRecord | null {
    const data = this.loadPersonStandups(person);
    return data.standups.find(s => s.date === date) || null;
  }

  getPreviousStandup(person: string, beforeDate: string): StandupRecord | null {
    const data = this.loadPersonStandups(person);
    const sorted = data.standups
      .filter(s => s.date < beforeDate)
      .sort((a, b) => b.date.localeCompare(a.date));
    return sorted[0] || null;
  }

  getPendingFollowups(person: string, currentDate: string): string[] {
    const previous = this.getPreviousStandup(person, currentDate);
    if (!previous || previous.commitments.length === 0) {
      return [];
    }

    const current = this.getStandup(person, currentDate);
    const completedLower = (current?.completed || []).map(c => c.toLowerCase());

    // Return commitments that weren't mentioned as completed
    return previous.commitments.filter(commitment => {
      const commitmentLower = commitment.toLowerCase();
      return !completedLower.some(c =>
        c.includes(commitmentLower) || commitmentLower.includes(c)
      );
    });
  }

  getAllPeopleWithStandups(): string[] {
    if (!fs.existsSync(this.standupDir)) return [];
    return fs.readdirSync(this.standupDir)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
  }
}
```

**Step 5: Run tests**

Run: `npm test -- src/standup/__tests__/tracker.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/standup/
git commit -m "feat: add StandupTracker for commitment tracking and followups"
```

---

## Phase 6: Wire Everything Together

### Task 6.1: Create New Orchestrator

**Files:**
- Rewrite: `src/core/orchestrator.ts`
- Test: `src/core/__tests__/orchestrator.test.ts`

This is a significant rewrite. The new orchestrator:
1. Uses the three-stage pipeline (classify → extract → respond)
2. Integrates AttentionTracker
3. Integrates ConstitutionManager
4. Integrates StandupTracker
5. Uses ContextAssembler for responses

**Step 1: Write integration tests**

```typescript
// src/core/__tests__/orchestrator.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScribbleOrchestrator } from '../orchestrator.js';
// ... mock dependencies

describe('ScribbleOrchestrator', () => {
  // Integration tests for the full pipeline
  // Test that @mention triggers response
  // Test that normal message just extracts
  // Test standup detection and tracking
  // Test dismissal handling
});
```

**Step 2: Implement new orchestrator**

The new orchestrator should:
- Accept message from SlackAdapter
- Run through classifier
- Run through extractor (async, for all messages)
- Check attention tracker
- If engaged: assemble context, call Haiku with constitution, handle tools
- If standup: record in StandupTracker, check for followups

This is a large file - implement in sections, testing each.

**Step 3: Update SlackAdapter to use new orchestrator**

The adapter needs minimal changes - just pass messages to the new orchestrator.

**Step 4: Update index.ts with all new dependencies**

Wire up all the new components.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: integrate pipeline architecture into orchestrator"
```

---

## Phase 7: Linear Integration

### Task 7.1: Add StreamLinear MCP Integration

**Files:**
- Create: `src/tools/linear.ts`
- Test: `src/tools/__tests__/linear.test.ts`

**Step 1: Install StreamLinear**

```bash
npm install @anthropic-ai/sdk  # Already installed
# StreamLinear MCP setup via config
```

**Step 2: Create Linear tools wrapper**

```typescript
// src/tools/linear.ts
// Wrapper for StreamLinear MCP tools
// - searchLinear(query)
// - suggestLinearTicket(title, description) - returns confirmation prompt
// - createLinearTicket(title, description, confirmed: true)
```

**Step 3: Add to orchestrator tool handling**

**Step 4: Commit**

```bash
git add src/tools/
git commit -m "feat: add Linear integration via StreamLinear MCP"
```

---

## Final: Verification and Cleanup

### Task F.1: Full Integration Test

Run the full test suite:
```bash
npm test
```

### Task F.2: Manual Testing

1. Start bot locally with test Slack workspace
2. Test @mention → response
3. Test name usage → response
4. Test dismissal → silence
5. Test standup → tracking
6. Test standup followup
7. Test wiki updates
8. Test Linear ticket suggestion

### Task F.3: Update CLAUDE.md

Update the project documentation to reflect new architecture.

### Task F.4: Final Commit

```bash
git add -A
git commit -m "docs: update CLAUDE.md for redesigned architecture"
```
