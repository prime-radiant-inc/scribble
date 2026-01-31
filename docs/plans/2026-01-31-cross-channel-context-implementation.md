# Cross-Channel Context Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add cross-channel awareness to Scribble by injecting recent messages from other Slack channels before responding.

**Architecture:** Three new modules (idFormatter, crossChannelContext, enhanced conversationLogger) integrated into the orchestrator. Context is gathered after engagement decision, formatted as markdown, and appended to system prompt.

**Tech Stack:** TypeScript, Vitest, Slack Web API, existing ConversationLogger

---

## Task 1: ID Formatter Utility

Create a centralized utility for formatting user and channel IDs with display names.

**Files:**
- Create: `src/utils/idFormatter.ts`
- Create: `src/__tests__/idFormatter.test.ts`

**Step 1: Write the failing tests**

Create `src/__tests__/idFormatter.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { formatUser, formatChannel, truncateMessage } from '../utils/idFormatter.js';

describe('formatUser', () => {
  it('formats regular user with name and ID', () => {
    expect(formatUser('U0A2GP26U94', 'Jesse', false)).toBe('Jesse (U0A2GP26U94)');
  });

  it('formats bot user with [bot] tag', () => {
    expect(formatUser('U0A3BOT1234', 'Scribble', true)).toBe('Scribble [bot] (U0A3BOT1234)');
  });

  it('handles null display name as Unknown', () => {
    expect(formatUser('U0A2GP26U94', null, false)).toBe('Unknown (U0A2GP26U94)');
  });

  it('handles unknown bot', () => {
    expect(formatUser('U0A3BOT1234', null, true)).toBe('Unknown [bot] (U0A3BOT1234)');
  });
});

describe('formatChannel', () => {
  it('formats channel with # prefix and ID', () => {
    expect(formatChannel('C0A8LJZQSAX', 'ops')).toBe('#ops (C0A8LJZQSAX)');
  });

  it('handles null channel name', () => {
    expect(formatChannel('C0A8LJZQSAX', null)).toBe('#unknown (C0A8LJZQSAX)');
  });
});

describe('truncateMessage', () => {
  it('returns short messages unchanged', () => {
    const short = 'Hello world';
    expect(truncateMessage(short)).toBe(short);
  });

  it('returns messages at 500 chars unchanged', () => {
    const exact = 'a'.repeat(500);
    expect(truncateMessage(exact)).toBe(exact);
  });

  it('truncates messages over 500 chars', () => {
    const long = 'a'.repeat(400) + 'MIDDLE' + 'b'.repeat(200);
    const result = truncateMessage(long);
    expect(result).toContain('a'.repeat(400));
    expect(result).toContain('[206 chars]');
    expect(result).toContain('b'.repeat(100));
    expect(result.length).toBeLessThan(long.length);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/__tests__/idFormatter.test.ts`
Expected: FAIL with "Cannot find module '../utils/idFormatter.js'"

**Step 3: Write minimal implementation**

Create `src/utils/idFormatter.ts`:

```typescript
/**
 * Format a user ID with display name for human-readable output.
 * Format: "Name (ID)" or "Name [bot] (ID)"
 */
export function formatUser(userId: string, displayName: string | null, isBot: boolean): string {
  const name = displayName || 'Unknown';
  const botTag = isBot ? ' [bot]' : '';
  return `${name}${botTag} (${userId})`;
}

/**
 * Format a channel ID with channel name for human-readable output.
 * Format: "#name (ID)"
 */
export function formatChannel(channelId: string, channelName: string | null): string {
  const name = channelName || 'unknown';
  return `#${name} (${channelId})`;
}

/**
 * Truncate long messages to keep context manageable.
 * Messages over 500 chars: first 400 + [N chars] + last 100
 */
export function truncateMessage(text: string): string {
  if (text.length <= 500) {
    return text;
  }

  const first = text.slice(0, 400);
  const last = text.slice(-100);
  const omitted = text.length - 500;

  return `${first} [${omitted} chars] ${last}`;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/__tests__/idFormatter.test.ts`
Expected: PASS (all 7 tests)

**Step 5: Commit**

```bash
git add src/utils/idFormatter.ts src/__tests__/idFormatter.test.ts
git commit -m "feat: add ID formatter utility for user/channel display"
```

---

## Task 2: Enhanced conversation_search with date and context

Add `date` and `context` parameters to the conversation search functionality.

**Files:**
- Modify: `src/logging/conversationLogger.ts`
- Modify: `src/__tests__/integration.test.ts` (add new tests)

**Step 1: Write the failing tests**

Add to `src/__tests__/integration.test.ts`:

```typescript
describe('ConversationLogger search enhancements', () => {
  it('should filter search results by date', async () => {
    // Create messages across different dates by manipulating file paths
    const channelDir = `${TEST_DIR}/conversations/C123`;
    fs.mkdirSync(`${channelDir}/2026-01-30`, { recursive: true });
    fs.mkdirSync(`${channelDir}/2026-01-31`, { recursive: true });

    fs.writeFileSync(`${channelDir}/2026-01-30/main.md`, '### User (2026-01-30T10:00:00Z)\n\nOld message about deployment\n\n---\n\n');
    fs.writeFileSync(`${channelDir}/2026-01-31/main.md`, '### User (2026-01-31T10:00:00Z)\n\nNew message about deployment\n\n---\n\n');

    const results = await conversationLogger.search('deployment', { date: '2026-01-31' });
    expect(results).toHaveLength(1);
    expect(results[0].date).toBe('2026-01-31');
  });

  it('should filter search results by date range', async () => {
    const channelDir = `${TEST_DIR}/conversations/C123`;
    fs.mkdirSync(`${channelDir}/2026-01-29`, { recursive: true });
    fs.mkdirSync(`${channelDir}/2026-01-30`, { recursive: true });
    fs.mkdirSync(`${channelDir}/2026-01-31`, { recursive: true });

    fs.writeFileSync(`${channelDir}/2026-01-29/main.md`, '### User\n\nDay 29 message\n\n---\n\n');
    fs.writeFileSync(`${channelDir}/2026-01-30/main.md`, '### User\n\nDay 30 message\n\n---\n\n');
    fs.writeFileSync(`${channelDir}/2026-01-31/main.md`, '### User\n\nDay 31 message\n\n---\n\n');

    const results = await conversationLogger.search('message', { date: '2026-01-29:2026-01-30' });
    expect(results).toHaveLength(2);
  });

  it('should return context messages around search match', async () => {
    const channelDir = `${TEST_DIR}/conversations/C123/2026-01-31`;
    fs.mkdirSync(channelDir, { recursive: true });

    // Create JSON file with multiple messages
    const messages = [
      { role: 'user', userName: 'Alice', text: 'First message', timestamp: '2026-01-31T10:00:00Z', messageTs: '1000.001' },
      { role: 'user', userName: 'Bob', text: 'Second message', timestamp: '2026-01-31T10:01:00Z', messageTs: '1000.002' },
      { role: 'user', userName: 'Alice', text: 'The deployment failed', timestamp: '2026-01-31T10:02:00Z', messageTs: '1000.003' },
      { role: 'user', userName: 'Bob', text: 'Fourth message', timestamp: '2026-01-31T10:03:00Z', messageTs: '1000.004' },
      { role: 'user', userName: 'Alice', text: 'Fifth message', timestamp: '2026-01-31T10:04:00Z', messageTs: '1000.005' },
    ];
    fs.writeFileSync(`${channelDir}/main.json`, JSON.stringify(messages));
    fs.writeFileSync(`${channelDir}/main.md`, messages.map(m => `### ${m.userName}\n\n${m.text}\n\n---\n\n`).join(''));

    const results = await conversationLogger.search('deployment', { context: 2 });
    expect(results).toHaveLength(1);
    expect(results[0].contextMessages).toBeDefined();
    expect(results[0].contextMessages!.length).toBe(5); // 2 before + match + 2 after
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/__tests__/integration.test.ts`
Expected: FAIL - search doesn't support date string or context parameter yet

**Step 3: Modify ConversationLogger.search**

Update `src/logging/conversationLogger.ts`. Add to the `SearchResult` interface and update `search` method:

```typescript
export interface SearchResult {
  channelId: string;
  date: string;
  threadTs: string;
  filePath: string;
  snippet: string;
  contextMessages?: StoredMessage[];  // NEW
}

// Update search method signature and implementation
async search(query: string, options?: {
  channelId?: string;
  date?: string;           // NEW: YYYY-MM-DD or YYYY-MM-DD:YYYY-MM-DD
  context?: number;        // NEW: messages before/after
  startDate?: Date;        // Keep for backward compat
  endDate?: Date;          // Keep for backward compat
  limit?: number;
}): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  const limit = options?.limit ?? 50;
  const queryLower = query.toLowerCase();

  // Parse date option into startDate/endDate
  let startDate = options?.startDate;
  let endDate = options?.endDate;
  if (options?.date) {
    if (options.date.includes(':')) {
      const [start, end] = options.date.split(':');
      startDate = new Date(start);
      endDate = new Date(end);
    } else {
      startDate = new Date(options.date);
      endDate = new Date(options.date);
    }
  }

  // Walk through conversation directories
  const channelDirs = options?.channelId
    ? [path.join(this.dataDir, options.channelId)]
    : this.getSubdirectories(this.dataDir);

  for (const channelDir of channelDirs) {
    if (!fs.existsSync(channelDir)) continue;

    const dateDirs = this.getSubdirectories(channelDir);
    for (const dateDir of dateDirs) {
      // Check date filter
      const dateStr = path.basename(dateDir);
      if (startDate && dateStr < this.formatDate(startDate)) continue;
      if (endDate && dateStr > this.formatDate(endDate)) continue;

      const files = fs.readdirSync(dateDir).filter(f => f.endsWith('.md'));
      for (const file of files) {
        const filePath = path.join(dateDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');

        if (content.toLowerCase().includes(queryLower)) {
          const snippet = this.extractSnippet(content, queryLower);

          // Load context messages if requested
          let contextMessages: StoredMessage[] | undefined;
          if (options?.context && options.context > 0) {
            const jsonFile = filePath.replace('.md', '.json');
            if (fs.existsSync(jsonFile)) {
              contextMessages = this.getContextMessages(jsonFile, queryLower, options.context);
            }
          }

          results.push({
            channelId: path.basename(channelDir),
            date: dateStr,
            threadTs: file.replace('.md', ''),
            filePath,
            snippet,
            contextMessages,
          });

          if (results.length >= limit) {
            return results;
          }
        }
      }
    }
  }

  return results;
}

private getContextMessages(jsonFile: string, query: string, contextCount: number): StoredMessage[] {
  try {
    const content = fs.readFileSync(jsonFile, 'utf-8');
    const messages: StoredMessage[] = JSON.parse(content);
    const queryLower = query.toLowerCase();

    // Find the matching message index
    const matchIndex = messages.findIndex(m => m.text.toLowerCase().includes(queryLower));
    if (matchIndex === -1) return [];

    // Get context window
    const start = Math.max(0, matchIndex - contextCount);
    const end = Math.min(messages.length, matchIndex + contextCount + 1);

    return messages.slice(start, end);
  } catch {
    return [];
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/__tests__/integration.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/logging/conversationLogger.ts src/__tests__/integration.test.ts
git commit -m "feat: add date and context params to conversation search"
```

---

## Task 3: Update MCP conversation_search schema

Update the MCP tool to expose the new parameters.

**Files:**
- Modify: `src/mcp/index.ts`

**Step 1: This is a schema-only change, test via build**

Run: `npm run build:mcp`
Expected: PASS (compiles)

**Step 2: Update the schema**

In `src/mcp/index.ts`, update `ConversationSearchParams`:

```typescript
const ConversationSearchParams = z.object({
  query: z.string().describe('Search query'),
  channel_id: z.string().optional().describe('Filter to specific channel'),
  date: z.string().optional().describe('Filter by date (YYYY-MM-DD) or range (YYYY-MM-DD:YYYY-MM-DD)'),
  context: z.number().optional().describe('Number of messages to show before and after each match'),
  limit: z.number().optional().describe('Maximum results (default: 10)'),
});
```

And update the tool handler:

```typescript
server.tool(
  'conversation_search',
  'Search past Slack conversations',
  ConversationSearchParams.shape,
  async ({ query, channel_id, date, context, limit }) => {
    try {
      const results = await conversationLogger.search(query, {
        channelId: channel_id,
        date,
        context,
        limit: limit ?? 10
      });
      if (results.length === 0) {
        return { content: [{ type: 'text' as const, text: `No conversations found for: ${query}` }] };
      }
      const formatted = results.map(r => {
        let text = `**${r.channelId}** (${r.date})\n${r.snippet}`;
        if (r.contextMessages && r.contextMessages.length > 0) {
          const contextText = r.contextMessages
            .map(m => `  ${m.userName} [${m.timestamp}]: ${m.text}`)
            .join('\n');
          text += `\n\n**Context:**\n${contextText}`;
        }
        return text;
      }).join('\n\n---\n\n');
      return { content: [{ type: 'text' as const, text: formatted }] };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error searching conversations: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);
```

**Step 3: Verify build passes**

Run: `npm run build && npm run build:mcp`
Expected: PASS

**Step 4: Commit**

```bash
git add src/mcp/index.ts
git commit -m "feat: expose date and context params in conversation_search MCP tool"
```

---

## Task 4: CrossChannelContext Module

Create the module that gathers recent messages from other channels.

**Files:**
- Create: `src/context/crossChannelContext.ts`
- Create: `src/__tests__/crossChannelContext.test.ts`

**Step 1: Write the failing tests**

Create `src/__tests__/crossChannelContext.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CrossChannelContext, CrossChannelContextOptions } from '../context/crossChannelContext.js';
import { ConversationLogger } from '../logging/conversationLogger.js';
import * as fs from 'fs';

const TEST_DIR = '/tmp/scribble-crosschannel-test';

// Mock Slack client
const mockSlackClient = {
  conversations: {
    list: async () => ({
      channels: [
        { id: 'C001', name: 'general', is_member: true },
        { id: 'C002', name: 'ops', is_member: true },
        { id: 'C003', name: 'random', is_member: true },
      ],
    }),
  },
  users: {
    info: async ({ user }: { user: string }) => ({
      user: {
        id: user,
        real_name: user === 'U001' ? 'Jesse' : 'Drew',
        is_bot: user.startsWith('B'),
      },
    }),
  },
};

describe('CrossChannelContext', () => {
  let conversationLogger: ConversationLogger;
  let crossChannelContext: CrossChannelContext;

  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
    fs.mkdirSync(TEST_DIR, { recursive: true });

    conversationLogger = new ConversationLogger(TEST_DIR);
    crossChannelContext = new CrossChannelContext(
      conversationLogger,
      mockSlackClient as any,
      TEST_DIR
    );
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
  });

  it('should exclude the current channel from context', async () => {
    // Create messages in C001 and C002
    const today = new Date().toISOString().split('T')[0];
    fs.mkdirSync(`${TEST_DIR}/conversations/C001/${today}`, { recursive: true });
    fs.mkdirSync(`${TEST_DIR}/conversations/C002/${today}`, { recursive: true });

    const recentTs = (Date.now() / 1000).toString();
    fs.writeFileSync(`${TEST_DIR}/conversations/C001/${today}/main.json`, JSON.stringify([
      { role: 'user', userId: 'U001', userName: 'Jesse', text: 'Message in general', timestamp: new Date().toISOString(), messageTs: recentTs },
    ]));
    fs.writeFileSync(`${TEST_DIR}/conversations/C002/${today}/main.json`, JSON.stringify([
      { role: 'user', userId: 'U002', userName: 'Drew', text: 'Message in ops', timestamp: new Date().toISOString(), messageTs: recentTs },
    ]));

    const result = await crossChannelContext.gather({
      excludeChannelId: 'C001',
      windowHours: 24,
      maxPerThread: 10,
    });

    expect(result).toContain('#ops');
    expect(result).not.toContain('#general');
  });

  it('should format messages with Name (ID) and timestamp', async () => {
    const today = new Date().toISOString().split('T')[0];
    fs.mkdirSync(`${TEST_DIR}/conversations/C002/${today}`, { recursive: true });

    const recentTs = (Date.now() / 1000).toString();
    fs.writeFileSync(`${TEST_DIR}/conversations/C002/${today}/main.json`, JSON.stringify([
      { role: 'user', userId: 'U001', userName: 'Jesse', text: 'Test message', timestamp: '2026-01-31T14:23:00Z', messageTs: recentTs },
    ]));

    const result = await crossChannelContext.gather({
      excludeChannelId: 'C001',
      windowHours: 24,
      maxPerThread: 10,
    });

    expect(result).toContain('Jesse (U001)');
    expect(result).toContain('[2026-01-31 14:23]');
    expect(result).toContain('Test message');
  });

  it('should truncate long messages', async () => {
    const today = new Date().toISOString().split('T')[0];
    fs.mkdirSync(`${TEST_DIR}/conversations/C002/${today}`, { recursive: true });

    const longMessage = 'a'.repeat(600);
    const recentTs = (Date.now() / 1000).toString();
    fs.writeFileSync(`${TEST_DIR}/conversations/C002/${today}/main.json`, JSON.stringify([
      { role: 'user', userId: 'U001', userName: 'Jesse', text: longMessage, timestamp: '2026-01-31T14:23:00Z', messageTs: recentTs },
    ]));

    const result = await crossChannelContext.gather({
      excludeChannelId: 'C001',
      windowHours: 24,
      maxPerThread: 10,
    });

    expect(result).toContain('[100 chars]');
    expect(result).not.toContain(longMessage);
  });

  it('should limit messages per thread to maxPerThread', async () => {
    const today = new Date().toISOString().split('T')[0];
    fs.mkdirSync(`${TEST_DIR}/conversations/C002/${today}`, { recursive: true });

    const messages = Array.from({ length: 15 }, (_, i) => ({
      role: 'user' as const,
      userId: 'U001',
      userName: 'Jesse',
      text: `Message ${i + 1}`,
      timestamp: new Date().toISOString(),
      messageTs: ((Date.now() / 1000) + i).toString(),
    }));
    fs.writeFileSync(`${TEST_DIR}/conversations/C002/${today}/main.json`, JSON.stringify(messages));

    const result = await crossChannelContext.gather({
      excludeChannelId: 'C001',
      windowHours: 24,
      maxPerThread: 10,
    });

    // Should only have 10 messages (the most recent ones)
    expect(result).toContain('Message 15');
    expect(result).toContain('Message 6');
    expect(result).not.toContain('Message 5');
  });

  it('should include conversation_search hint at the end', async () => {
    const result = await crossChannelContext.gather({
      excludeChannelId: 'C001',
      windowHours: 24,
      maxPerThread: 10,
    });

    expect(result).toContain('conversation_search');
  });

  it('should group threads under their channel', async () => {
    const today = new Date().toISOString().split('T')[0];
    fs.mkdirSync(`${TEST_DIR}/conversations/C002/${today}`, { recursive: true });

    const recentTs = (Date.now() / 1000).toString();
    // Main channel message
    fs.writeFileSync(`${TEST_DIR}/conversations/C002/${today}/main.json`, JSON.stringify([
      { role: 'user', userId: 'U001', userName: 'Jesse', text: 'Main message', timestamp: new Date().toISOString(), messageTs: recentTs },
    ]));
    // Thread message
    fs.writeFileSync(`${TEST_DIR}/conversations/C002/${today}/1234567890.000001.json`, JSON.stringify([
      { role: 'user', userId: 'U002', userName: 'Drew', text: 'Thread message', timestamp: new Date().toISOString(), messageTs: recentTs },
    ]));

    const result = await crossChannelContext.gather({
      excludeChannelId: 'C001',
      windowHours: 24,
      maxPerThread: 10,
    });

    expect(result).toContain('#ops');
    expect(result).toContain('Main message');
    expect(result).toContain('Thread');
    expect(result).toContain('Thread message');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/__tests__/crossChannelContext.test.ts`
Expected: FAIL with "Cannot find module '../context/crossChannelContext.js'"

**Step 3: Write implementation**

Create `src/context/crossChannelContext.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import type { WebClient } from '@slack/web-api';
import { ConversationLogger, StoredMessage } from '../logging/conversationLogger.js';
import { formatUser, formatChannel, truncateMessage } from '../utils/idFormatter.js';
import { Logger } from 'bot-toolkit';

const logger = new Logger('CrossChannelContext');

export interface CrossChannelContextOptions {
  excludeChannelId: string;
  excludeThreadTs?: string;
  afterTimestamps?: Map<string, string>;
  windowHours: number;
  maxPerThread: number;
}

interface ChannelInfo {
  id: string;
  name: string;
}

interface UserInfo {
  id: string;
  displayName: string | null;
  isBot: boolean;
}

export class CrossChannelContext {
  private conversationLogger: ConversationLogger;
  private slackClient: WebClient;
  private dataDir: string;
  private userCache: Map<string, UserInfo> = new Map();
  private channelCache: Map<string, ChannelInfo> = new Map();

  constructor(
    conversationLogger: ConversationLogger,
    slackClient: WebClient,
    dataDir: string
  ) {
    this.conversationLogger = conversationLogger;
    this.slackClient = slackClient;
    this.dataDir = dataDir;
  }

  async gather(options: CrossChannelContextOptions): Promise<string> {
    const { excludeChannelId, excludeThreadTs, afterTimestamps, windowHours, maxPerThread } = options;

    // Get list of public channels Scribble is in
    const channels = await this.getPublicChannels();
    const cutoffTime = Date.now() - (windowHours * 60 * 60 * 1000);

    const sections: string[] = [];

    for (const channel of channels) {
      if (channel.id === excludeChannelId) continue;

      const channelContext = await this.gatherChannelContext(
        channel,
        cutoffTime,
        maxPerThread,
        excludeThreadTs,
        afterTimestamps
      );

      if (channelContext) {
        sections.push(channelContext);
      }
    }

    if (sections.length === 0) {
      return `## Recent activity from other channels (last ${windowHours}h)\n\nNo recent activity in other channels.\n\n---\nUse \`conversation_search\` with a keyword or channel_id to expand relevant conversations before replying.`;
    }

    return `## Recent activity from other channels (last ${windowHours}h)\n\n${sections.join('\n\n')}\n\n---\nUse \`conversation_search\` with a keyword or channel_id to expand relevant conversations before replying.`;
  }

  private async gatherChannelContext(
    channel: ChannelInfo,
    cutoffTime: number,
    maxPerThread: number,
    excludeThreadTs?: string,
    afterTimestamps?: Map<string, string>
  ): Promise<string | null> {
    const conversationsDir = path.join(this.dataDir, 'conversations', channel.id);
    if (!fs.existsSync(conversationsDir)) return null;

    const lines: string[] = [];
    const threadLines: string[] = [];

    // Get date directories within the window
    const dateDirs = this.getRecentDateDirs(conversationsDir, cutoffTime);

    for (const dateDir of dateDirs) {
      const files = fs.readdirSync(dateDir).filter(f => f.endsWith('.json'));

      for (const file of files) {
        const threadTs = file.replace('.json', '');
        if (threadTs === excludeThreadTs) continue;

        const afterTs = afterTimestamps?.get(`${channel.id}:${threadTs}`);
        const messages = this.loadMessages(path.join(dateDir, file), cutoffTime, afterTs);

        if (messages.length === 0) continue;

        // Take most recent maxPerThread messages
        const recentMessages = messages.slice(-maxPerThread);
        const formattedMessages = await this.formatMessages(recentMessages);

        if (threadTs === 'main') {
          lines.push(`Source: ${path.join(dateDir, file.replace('.json', '.md'))}`);
          lines.push(...formattedMessages);
        } else {
          // Thread - indent
          const firstMsg = recentMessages[0];
          const threadTitle = this.getThreadTitle(firstMsg.text);
          const threadTime = this.formatTimestamp(firstMsg.timestamp);
          threadLines.push(`  **Thread: "${threadTitle}" [${threadTime}]:**`);
          threadLines.push(`  Source: ${path.join(dateDir, file.replace('.json', '.md'))}`);
          threadLines.push(...formattedMessages.map(l => `  ${l}`));
        }
      }
    }

    if (lines.length === 0 && threadLines.length === 0) return null;

    const channelHeader = formatChannel(channel.id, channel.name);
    return `### ${channelHeader}\n${lines.join('\n')}${threadLines.length > 0 ? '\n\n' + threadLines.join('\n') : ''}`;
  }

  private loadMessages(filePath: string, cutoffTime: number, afterTs?: string): StoredMessage[] {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const messages: StoredMessage[] = JSON.parse(content);

      return messages.filter(m => {
        const msgTime = parseFloat(m.messageTs) * 1000;
        if (msgTime < cutoffTime) return false;
        if (afterTs && m.messageTs <= afterTs) return false;
        return true;
      });
    } catch {
      return [];
    }
  }

  private async formatMessages(messages: StoredMessage[]): Promise<string[]> {
    const lines: string[] = [];

    for (const msg of messages) {
      const userInfo = await this.getUserInfo(msg.userId || 'unknown');
      const userName = formatUser(userInfo.id, userInfo.displayName, userInfo.isBot);
      const timestamp = this.formatTimestamp(msg.timestamp);
      const text = truncateMessage(msg.text);

      lines.push(`- ${userName} [${timestamp}]: ${text}`);
    }

    return lines;
  }

  private formatTimestamp(isoTimestamp: string): string {
    // Convert ISO timestamp to YYYY-MM-DD HH:MM format
    const date = new Date(isoTimestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  }

  private getThreadTitle(text: string): string {
    // First 30 chars of first message, truncated at word boundary
    const cleaned = text.replace(/\n/g, ' ').trim();
    if (cleaned.length <= 30) return cleaned;
    const truncated = cleaned.slice(0, 30);
    const lastSpace = truncated.lastIndexOf(' ');
    return (lastSpace > 15 ? truncated.slice(0, lastSpace) : truncated) + '...';
  }

  private getRecentDateDirs(channelDir: string, cutoffTime: number): string[] {
    const cutoffDate = new Date(cutoffTime).toISOString().split('T')[0];

    return fs.readdirSync(channelDir)
      .filter(name => {
        const dirPath = path.join(channelDir, name);
        return fs.statSync(dirPath).isDirectory() && name >= cutoffDate;
      })
      .map(name => path.join(channelDir, name))
      .sort();
  }

  private async getPublicChannels(): Promise<ChannelInfo[]> {
    try {
      const result = await this.slackClient.conversations.list({
        types: 'public_channel',
        exclude_archived: true,
      });

      return (result.channels || [])
        .filter((c: any) => c.is_member)
        .map((c: any) => ({
          id: c.id,
          name: c.name,
        }));
    } catch (error) {
      logger.error('Failed to list channels', { error });
      return [];
    }
  }

  private async getUserInfo(userId: string): Promise<UserInfo> {
    if (this.userCache.has(userId)) {
      return this.userCache.get(userId)!;
    }

    try {
      const result = await this.slackClient.users.info({ user: userId });
      const user = result.user as any;
      const info: UserInfo = {
        id: userId,
        displayName: user?.real_name || user?.profile?.display_name || user?.name || null,
        isBot: user?.is_bot || false,
      };
      this.userCache.set(userId, info);
      return info;
    } catch {
      const info: UserInfo = { id: userId, displayName: null, isBot: false };
      this.userCache.set(userId, info);
      return info;
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/__tests__/crossChannelContext.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/context/crossChannelContext.ts src/__tests__/crossChannelContext.test.ts
git commit -m "feat: add CrossChannelContext module for gathering recent activity"
```

---

## Task 5: Integrate CrossChannelContext into Orchestrator

Wire up the new module to inject context before responses.

**Files:**
- Modify: `src/orchestrator/scribbleOrchestrator.ts`

**Step 1: Update ScribbleOrchestratorConfig interface**

Add the Slack client to the config:

```typescript
import type { WebClient } from '@slack/web-api';
import { CrossChannelContext } from '../context/crossChannelContext.js';

export interface ScribbleOrchestratorConfig {
  database: SessionDatabase;
  sessionManager: ClaudeSessionManagerSDK;
  conversationLogger: ConversationLogger;
  constitutionManager: ConstitutionManager;
  dataDir: string;
  slackClient: WebClient;  // NEW
}
```

**Step 2: Initialize CrossChannelContext in constructor**

```typescript
export class ScribbleOrchestrator {
  private database: SessionDatabase;
  private sessionManager: ClaudeSessionManagerSDK;
  private conversationLogger: ConversationLogger;
  private constitutionManager: ConstitutionManager;
  private dataDir: string;
  private crossChannelContext: CrossChannelContext;  // NEW

  constructor(config: ScribbleOrchestratorConfig) {
    this.database = config.database;
    this.sessionManager = config.sessionManager;
    this.conversationLogger = config.conversationLogger;
    this.constitutionManager = config.constitutionManager;
    this.dataDir = config.dataDir;
    this.crossChannelContext = new CrossChannelContext(  // NEW
      config.conversationLogger,
      config.slackClient,
      config.dataDir
    );
  }
```

**Step 3: Add context injection in handleEngagedThreadMessage**

After engagement decision, before response, gather and append cross-channel context:

```typescript
private async handleEngagedThreadMessage(
  message: IncomingMessage,
  responder: PlatformResponder,
  threadSession: { session_id: string; compaction_count: number }
): Promise<void> {
  const threadId = message.threadId!;

  const resumeSession = {
    sessionId: threadSession.session_id,
    compactionCount: threadSession.compaction_count,
  };

  // Build system prompt
  const constitution = this.constitutionManager.getFullConstitution();
  const channelInstructions = this.constitutionManager.getInstructionsForChannel(message.channelName);

  // NEW: Gather cross-channel context
  const crossChannelContextStr = await this.crossChannelContext.gather({
    excludeChannelId: message.channelId,
    excludeThreadTs: message.threadId,
    windowHours: 24,
    maxPerThread: 10,
  });

  const systemPromptAppend = constitution + channelInstructions + '\n\n' + crossChannelContextStr;

  // ... rest of method unchanged
```

**Step 4: Repeat for handleChannelMessage and handleNewThreadMessage**

Add the same context gathering in both methods where `systemPromptAppend` is constructed.

**Step 5: Update index.ts to pass slackClient**

In `src/index.ts`, update the orchestrator instantiation to include the Slack client:

```typescript
const orchestrator = new ScribbleOrchestrator({
  database,
  sessionManager,
  conversationLogger,
  constitutionManager,
  dataDir: DATA_DIR,
  slackClient: slackAdapter.client,  // NEW - need to expose client from adapter
});
```

**Step 6: Expose client from SlackAdapterSDK**

In `src/slack/adapterSDK.ts`, add a getter:

```typescript
get client(): WebClient {
  return this.app.client;
}
```

**Step 7: Verify build passes**

Run: `npm run build`
Expected: PASS

**Step 8: Commit**

```bash
git add src/orchestrator/scribbleOrchestrator.ts src/slack/adapterSDK.ts src/index.ts
git commit -m "feat: integrate cross-channel context into orchestrator"
```

---

## Task 6: Update ID Formatting in ConversationLogger

Use the ID formatter when logging messages.

**Files:**
- Modify: `src/logging/conversationLogger.ts`

**Step 1: Import and use formatUser**

```typescript
import { formatUser } from '../utils/idFormatter.js';

// Update formatMessage method
private formatMessage(message: SlackMessage): string {
  const timestamp = new Date(parseFloat(message.messageTs) * 1000).toISOString();
  // Use ID formatter - assume non-bot for now, bot detection happens at a higher level
  const userDisplay = formatUser(message.userId, message.userName, false);
  const header = `### ${userDisplay} (${timestamp})`;

  // ... rest unchanged
}
```

**Step 2: Verify existing tests still pass**

Run: `npm test`
Expected: PASS

**Step 3: Commit**

```bash
git add src/logging/conversationLogger.ts
git commit -m "refactor: use ID formatter in conversation logger"
```

---

## Task 7: Final Integration Test

Create an end-to-end test verifying the full flow.

**Files:**
- Modify: `src/__tests__/integration.test.ts`

**Step 1: Add integration test**

```typescript
describe('Cross-channel context integration', () => {
  it('should gather context from other channels when responding', async () => {
    // This test verifies the full integration
    // Create conversation data in multiple channels
    const today = new Date().toISOString().split('T')[0];

    // Channel 1 - where the conversation is happening
    fs.mkdirSync(`${TEST_DIR}/conversations/C001/${today}`, { recursive: true });
    fs.writeFileSync(`${TEST_DIR}/conversations/C001/${today}/main.json`, JSON.stringify([
      { role: 'user', userId: 'U001', userName: 'Jesse', text: 'Current conversation', timestamp: new Date().toISOString(), messageTs: (Date.now() / 1000).toString() },
    ]));

    // Channel 2 - other activity
    fs.mkdirSync(`${TEST_DIR}/conversations/C002/${today}`, { recursive: true });
    fs.writeFileSync(`${TEST_DIR}/conversations/C002/${today}/main.json`, JSON.stringify([
      { role: 'user', userId: 'U002', userName: 'Drew', text: 'Activity in ops', timestamp: new Date().toISOString(), messageTs: (Date.now() / 1000).toString() },
    ]));

    // Verify CrossChannelContext gathers from C002 when excluding C001
    const mockClient = {
      conversations: {
        list: async () => ({
          channels: [
            { id: 'C001', name: 'general', is_member: true },
            { id: 'C002', name: 'ops', is_member: true },
          ],
        }),
      },
      users: {
        info: async ({ user }: { user: string }) => ({
          user: { id: user, real_name: 'Test User', is_bot: false },
        }),
      },
    };

    const crossChannelContext = new CrossChannelContext(
      conversationLogger,
      mockClient as any,
      TEST_DIR
    );

    const context = await crossChannelContext.gather({
      excludeChannelId: 'C001',
      windowHours: 24,
      maxPerThread: 10,
    });

    expect(context).toContain('#ops');
    expect(context).toContain('Activity in ops');
    expect(context).not.toContain('Current conversation');
  });
});
```

**Step 2: Run all tests**

Run: `npm test`
Expected: PASS

**Step 3: Final commit**

```bash
git add src/__tests__/integration.test.ts
git commit -m "test: add cross-channel context integration test"
```

---

## Summary

| Task | Files | Description |
|------|-------|-------------|
| 1 | `idFormatter.ts`, test | ID formatting utility |
| 2 | `conversationLogger.ts`, test | Date/context search params |
| 3 | `mcp/index.ts` | MCP schema update |
| 4 | `crossChannelContext.ts`, test | Context gathering module |
| 5 | `scribbleOrchestrator.ts`, `adapterSDK.ts`, `index.ts` | Integration |
| 6 | `conversationLogger.ts` | Use ID formatter in logging |
| 7 | Integration test | End-to-end verification |

After completing all tasks:
```bash
npm run build && npm test
```

If all passes, the feature is ready for deployment.
