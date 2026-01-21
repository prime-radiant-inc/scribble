# Scribble Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix constitution learning, replace Linear stub with StreamLinear MCP, and add OpenTelemetry instrumentation.

**Architecture:** Three independent workstreams: (1) Fix constitution learning so Scribble recognizes when to use `learn_behavior` and `set_channel_instruction` tools, (2) Replace stub Linear implementation with StreamLinear MCP calls, (3) Add OpenTelemetry SDK with structured logging, traces, and metrics exportable to Prometheus.

**Tech Stack:** TypeScript, OpenTelemetry SDK, StreamLinear MCP, Prometheus metrics format

---

## Task 1: Fix Constitution Learning - Update Base Constitution

The constitution doesn't tell Scribble WHEN to use the learning tools. It created a wiki page instead because it didn't recognize "remember this" as a learning moment.

**Files:**
- Modify: `src/constitution/base.ts`

**Step 1: Read the current constitution**

Run: `cat src/constitution/base.ts`
Note the current structure and where to add learning instructions.

**Step 2: Update the constitution with learning guidance**

Add a new section to `BASE_CONSTITUTION` after the Wiki Gardening section:

```typescript
## Learning and Memory

You have tools to remember things permanently:

### When to use \`learn_behavior\`:
- Someone says "always do X", "never do Y", "remember to..."
- Someone corrects your behavior: "don't do that, instead..."
- A team preference is established: "we prefer X over Y"
- A process is defined: "when X happens, do Y"

### When to use \`set_channel_instruction\`:
- Someone says "in this channel, always..." or "here we..."
- A channel-specific rule is established: "URLs posted here should go to..."
- Someone defines a workflow for a specific channel

### Important:
- Use these tools INSTEAD of creating wiki pages for behavioral rules
- Wiki is for knowledge/documentation; learning tools are for YOUR behavior
- When in doubt, use the learning tool - you can always list what you've learned
```

**Step 3: Run tests to verify no regressions**

Run: `npm test`
Expected: All 90 tests pass

**Step 4: Commit**

```bash
git add src/constitution/base.ts
git commit -m "fix: add learning guidance to constitution

Tell Scribble when to use learn_behavior and set_channel_instruction
tools instead of creating wiki pages for behavioral rules."
```

---

## Task 2: Fix Constitution Learning - Add Error Handling

The ConstitutionManager silently fails if file operations fail. Add proper error handling and logging.

**Files:**
- Modify: `src/constitution/manager.ts`

**Step 1: Read the current manager implementation**

Run: `cat src/constitution/manager.ts`
Note the lack of try/catch around file operations.

**Step 2: Add error handling to file operations**

Wrap file reads/writes in try/catch blocks. On read failure, return empty defaults. On write failure, log error and throw so the tool reports failure to the user.

```typescript
getLearnedBehaviors(): LearnedBehavior[] {
  try {
    const data: LearnedConstitution = JSON.parse(fs.readFileSync(this.learnedFile, 'utf-8'));
    return data.behaviors;
  } catch (error) {
    logger.warn('Failed to read learned behaviors, returning empty', { error });
    return [];
  }
}

addLearnedBehavior(behavior: string, requestedBy: string, reasoning: string): void {
  // ... immutability check ...

  let learned: LearnedConstitution;
  try {
    learned = JSON.parse(fs.readFileSync(this.learnedFile, 'utf-8'));
  } catch {
    learned = { behaviors: [] };
  }

  // ... add behavior ...

  try {
    fs.writeFileSync(this.learnedFile, JSON.stringify(learned, null, 2));
  } catch (error) {
    logger.error('Failed to save learned behavior', { behavior, error });
    throw new Error('Failed to save learned behavior - check file permissions');
  }

  // ... rest of method ...
}
```

Apply similar pattern to:
- `getChannelInstructions()`
- `addChannelInstruction()`
- `getChangeLog()`
- `logChange()`

**Step 3: Run tests**

Run: `npm test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add src/constitution/manager.ts
git commit -m "fix: add error handling to ConstitutionManager

Gracefully handle file read failures by returning defaults.
Throw meaningful errors on write failures so users know what happened."
```

---

## Task 3: Replace Linear Stub - Remove Old Implementation

Remove the stub LinearTools class and its usage.

**Files:**
- Delete: `src/tools/linear.ts`
- Delete: `src/tools/__tests__/linear.test.ts`
- Modify: `src/core/orchestrator.ts` (remove LinearTools import and usage)

**Step 1: Remove LinearTools import from orchestrator**

In `src/core/orchestrator.ts`, remove:
```typescript
import { LinearTools } from '../tools/linear.js';
```

And remove the `linearTools` property and its initialization.

**Step 2: Remove the suggest_linear_ticket tool definition and handler**

Remove the tool from the TOOLS array (lines ~92-108).
Remove the handler from executeTool switch statement.

**Step 3: Delete the Linear files**

```bash
rm src/tools/linear.ts
rm src/tools/__tests__/linear.test.ts
```

**Step 4: Run tests to see what breaks**

Run: `npm test`
Expected: Tests pass (Linear tests are deleted)

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor: remove stub Linear implementation

Preparing to replace with StreamLinear MCP integration."
```

---

## Task 4: Replace Linear Stub - Add StreamLinear MCP Integration

Add new Linear tools that call StreamLinear MCP.

**Files:**
- Create: `src/tools/streamlinear.ts`
- Modify: `src/core/orchestrator.ts`

**Step 1: Create StreamLinear wrapper**

Create `src/tools/streamlinear.ts`:

```typescript
import { Logger } from '../utils/logger.js';

const logger = new Logger('StreamLinear');

export interface LinearTicket {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  state: string;
  url: string;
}

export interface PendingTicketSuggestion {
  id: string;
  title: string;
  description: string;
  context?: string;
  suggestedAt: Date;
  suggestedBy: string;
}

/**
 * StreamLinear MCP integration for Linear ticket management.
 *
 * This class wraps StreamLinear MCP tool calls. The actual MCP tools
 * are called by the orchestrator; this class manages pending suggestions
 * and formats results.
 */
export class StreamLinearTools {
  private pendingSuggestions: Map<string, PendingTicketSuggestion> = new Map();
  private suggestionCounter = 0;

  /**
   * Create a pending ticket suggestion that needs user confirmation.
   */
  suggestTicket(title: string, description: string, suggestedBy: string, context?: string): PendingTicketSuggestion {
    const id = `suggestion_${Date.now()}_${++this.suggestionCounter}`;

    const suggestion: PendingTicketSuggestion = {
      id,
      title,
      description,
      context,
      suggestedAt: new Date(),
      suggestedBy,
    };

    this.pendingSuggestions.set(id, suggestion);
    logger.info('Created ticket suggestion', { id, title, suggestedBy });

    return suggestion;
  }

  /**
   * Get a pending suggestion by ID.
   */
  getSuggestion(id: string): PendingTicketSuggestion | undefined {
    return this.pendingSuggestions.get(id);
  }

  /**
   * Remove a suggestion (after confirmation or cancellation).
   */
  removeSuggestion(id: string): boolean {
    return this.pendingSuggestions.delete(id);
  }

  /**
   * Get all pending suggestions.
   */
  getPendingSuggestions(): PendingTicketSuggestion[] {
    return Array.from(this.pendingSuggestions.values());
  }

  /**
   * Format a ticket for display.
   */
  formatTicket(ticket: LinearTicket): string {
    return `**${ticket.identifier}**: ${ticket.title}\nStatus: ${ticket.state}\nURL: ${ticket.url}`;
  }
}
```

**Step 2: Add MCP tool definitions to orchestrator**

Add to TOOLS array in `src/core/orchestrator.ts`:

```typescript
{
  name: 'search_linear_tickets',
  description: 'Search Linear for existing tickets. Always search before suggesting a new ticket to avoid duplicates.',
  input_schema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'Search query for finding tickets',
      },
    },
    required: ['query'],
  },
},
{
  name: 'suggest_linear_ticket',
  description: 'Suggest creating a Linear ticket. Returns a suggestion ID that must be confirmed by the user before the ticket is actually created.',
  input_schema: {
    type: 'object' as const,
    properties: {
      title: {
        type: 'string',
        description: 'Title for the ticket',
      },
      description: {
        type: 'string',
        description: 'Description of the issue or task',
      },
    },
    required: ['title', 'description'],
  },
},
{
  name: 'confirm_linear_ticket',
  description: 'Confirm and create a previously suggested Linear ticket. Only call this after user explicitly confirms they want the ticket created.',
  input_schema: {
    type: 'object' as const,
    properties: {
      suggestion_id: {
        type: 'string',
        description: 'The suggestion ID returned by suggest_linear_ticket',
      },
    },
    required: ['suggestion_id'],
  },
},
{
  name: 'cancel_linear_suggestion',
  description: 'Cancel a ticket suggestion if the user decides not to create it.',
  input_schema: {
    type: 'object' as const,
    properties: {
      suggestion_id: {
        type: 'string',
        description: 'The suggestion ID to cancel',
      },
    },
    required: ['suggestion_id'],
  },
},
```

**Step 3: Add tool handlers**

Add to executeTool switch in orchestrator:

```typescript
case 'search_linear_tickets': {
  const query = input.query as string;
  // Call StreamLinear MCP - this will be available as mcp__streamlinear__search
  // For now, return guidance that MCP needs to be configured
  return `To search Linear, the StreamLinear MCP server must be configured. Query: "${query}"`;
}

case 'suggest_linear_ticket': {
  const title = input.title as string;
  const description = input.description as string;

  const suggestion = this.streamLinearTools.suggestTicket(
    title,
    description,
    message.userName || 'unknown',
    `From #${message.channelName}`
  );

  return `Created ticket suggestion:\n**${suggestion.title}**\n${suggestion.description}\n\nSuggestion ID: \`${suggestion.id}\`\n\nTo create this ticket, ask the user to confirm, then use confirm_linear_ticket.`;
}

case 'confirm_linear_ticket': {
  const suggestionId = input.suggestion_id as string;
  const suggestion = this.streamLinearTools.getSuggestion(suggestionId);

  if (!suggestion) {
    return `Suggestion not found: ${suggestionId}. It may have expired or been cancelled.`;
  }

  // Call StreamLinear MCP to create the ticket
  // For now, indicate MCP integration point
  this.streamLinearTools.removeSuggestion(suggestionId);
  return `To create ticket "${suggestion.title}", call the StreamLinear MCP create_issue tool with this data. (MCP integration pending)`;
}

case 'cancel_linear_suggestion': {
  const suggestionId = input.suggestion_id as string;
  const removed = this.streamLinearTools.removeSuggestion(suggestionId);
  return removed
    ? `Cancelled suggestion: ${suggestionId}`
    : `Suggestion not found: ${suggestionId}`;
}
```

**Step 4: Add StreamLinearTools to orchestrator**

Add import and property:
```typescript
import { StreamLinearTools } from '../tools/streamlinear.js';

// In class properties:
private streamLinearTools: StreamLinearTools;

// In constructor:
this.streamLinearTools = new StreamLinearTools();
```

**Step 5: Run tests**

Run: `npm test`
Expected: All tests pass

**Step 6: Commit**

```bash
git add src/tools/streamlinear.ts src/core/orchestrator.ts
git commit -m "feat: add StreamLinear MCP integration for Linear tickets

- Add suggestion/confirmation workflow for ticket creation
- Add search, suggest, confirm, and cancel tools
- Prepare for StreamLinear MCP server connection"
```

---

## Task 5: Add OpenTelemetry - Install Dependencies

Install OpenTelemetry packages.

**Files:**
- Modify: `package.json`

**Step 1: Install OpenTelemetry packages**

```bash
npm install @opentelemetry/api @opentelemetry/sdk-node @opentelemetry/sdk-trace-node @opentelemetry/sdk-metrics @opentelemetry/exporter-prometheus @opentelemetry/resources @opentelemetry/semantic-conventions @opentelemetry/instrumentation-http
```

**Step 2: Verify installation**

Run: `npm test`
Expected: Tests still pass

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add OpenTelemetry packages

For structured logging, tracing, and Prometheus-compatible metrics."
```

---

## Task 6: Add OpenTelemetry - Create Telemetry Module

Create the OpenTelemetry initialization and configuration module.

**Files:**
- Create: `src/telemetry/index.ts`
- Create: `src/telemetry/metrics.ts`

**Step 1: Create telemetry initialization**

Create `src/telemetry/index.ts`:

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { metrics } from './metrics.js';

let sdk: NodeSDK | null = null;
let prometheusExporter: PrometheusExporter | null = null;

export interface TelemetryConfig {
  enabled: boolean;
  serviceName: string;
  prometheusPort?: number;
}

export function initTelemetry(config: TelemetryConfig): void {
  if (!config.enabled) {
    console.log('[Telemetry] Disabled');
    return;
  }

  const resource = new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: config.serviceName,
    [SemanticResourceAttributes.SERVICE_VERSION]: process.env.npm_package_version || '1.0.0',
  });

  // Prometheus exporter for metrics
  prometheusExporter = new PrometheusExporter({
    port: config.prometheusPort || 9464,
  });

  sdk = new NodeSDK({
    resource,
    metricReader: prometheusExporter,
  });

  sdk.start();
  console.log(`[Telemetry] Started with Prometheus exporter on port ${config.prometheusPort || 9464}`);
}

export function shutdownTelemetry(): Promise<void> {
  if (sdk) {
    return sdk.shutdown();
  }
  return Promise.resolve();
}

export { metrics };
```

**Step 2: Create metrics definitions**

Create `src/telemetry/metrics.ts`:

```typescript
import { metrics as otelMetrics, Counter, Histogram } from '@opentelemetry/api';

const meter = otelMetrics.getMeter('scribble');

// Message processing metrics
export const messagesProcessed = meter.createCounter('scribble_messages_processed_total', {
  description: 'Total number of messages processed',
});

export const messageProcessingDuration = meter.createHistogram('scribble_message_processing_duration_seconds', {
  description: 'Time spent processing messages',
  unit: 'seconds',
});

// Tool execution metrics
export const toolExecutions = meter.createCounter('scribble_tool_executions_total', {
  description: 'Total number of tool executions',
});

export const toolExecutionDuration = meter.createHistogram('scribble_tool_execution_duration_seconds', {
  description: 'Time spent executing tools',
  unit: 'seconds',
});

// API call metrics
export const apiCalls = meter.createCounter('scribble_api_calls_total', {
  description: 'Total number of API calls to Claude',
});

export const apiCallDuration = meter.createHistogram('scribble_api_call_duration_seconds', {
  description: 'Time spent on API calls',
  unit: 'seconds',
});

export const apiErrors = meter.createCounter('scribble_api_errors_total', {
  description: 'Total number of API errors',
});

// Thread engagement metrics
export const threadEngagements = meter.createCounter('scribble_thread_engagements_total', {
  description: 'Total number of thread engagements',
});

// Wiki operation metrics
export const wikiOperations = meter.createCounter('scribble_wiki_operations_total', {
  description: 'Total number of wiki operations',
});

// Learning metrics
export const behaviorsLearned = meter.createCounter('scribble_behaviors_learned_total', {
  description: 'Total number of behaviors learned',
});

export const channelInstructionsSet = meter.createCounter('scribble_channel_instructions_set_total', {
  description: 'Total number of channel instructions set',
});

export const metrics = {
  messagesProcessed,
  messageProcessingDuration,
  toolExecutions,
  toolExecutionDuration,
  apiCalls,
  apiCallDuration,
  apiErrors,
  threadEngagements,
  wikiOperations,
  behaviorsLearned,
  channelInstructionsSet,
};
```

**Step 3: Run TypeScript compiler to check for errors**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/telemetry/
git commit -m "feat: add OpenTelemetry telemetry module

- Initialize OTEL SDK with Prometheus exporter
- Define metrics for messages, tools, API calls, wiki, and learning"
```

---

## Task 7: Add OpenTelemetry - Update Logger for Structured Output

Update the Logger to output structured JSON when configured.

**Files:**
- Modify: `src/utils/logger.ts`

**Step 1: Read current logger**

Run: `cat src/utils/logger.ts`

**Step 2: Update logger for structured output**

```typescript
type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

const LOG_LEVELS: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

interface LogEntry {
  timestamp: string;
  level: string;
  logger: string;
  message: string;
  data?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

export class Logger {
  private prefix: string;
  private level: number;
  private structured: boolean;

  constructor(prefix: string) {
    this.prefix = prefix;
    const envLevel = (process.env.LOG_LEVEL || 'info').toLowerCase() as LogLevel;
    this.level = LOG_LEVELS[envLevel] ?? LOG_LEVELS.info;
    this.structured = process.env.LOG_FORMAT === 'json';
  }

  private formatEntry(level: string, message: string, data?: Record<string, unknown>, error?: unknown): string {
    if (this.structured) {
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level,
        logger: this.prefix,
        message,
        data,
      };

      if (error) {
        if (error instanceof Error) {
          entry.error = {
            name: error.name,
            message: error.message,
            stack: error.stack,
          };
        } else {
          entry.error = { name: 'Unknown', message: String(error) };
        }
      }

      return JSON.stringify(entry);
    }

    // Legacy format
    const timestamp = new Date().toISOString();
    let output = `[${timestamp}] [${this.prefix}] ${level.toUpperCase()}: ${message}`;
    if (data) {
      output += ' ' + JSON.stringify(data);
    }
    if (error) {
      output += ' ' + (error instanceof Error ? error.stack || error.message : String(error));
    }
    return output;
  }

  info(message: string, data?: Record<string, unknown>): void {
    if (this.level >= LOG_LEVELS.info) {
      console.log(this.formatEntry('info', message, data));
    }
  }

  warn(message: string, data?: Record<string, unknown>): void {
    if (this.level >= LOG_LEVELS.warn) {
      console.warn(this.formatEntry('warn', message, data));
    }
  }

  error(message: string, error?: unknown): void {
    if (this.level >= LOG_LEVELS.error) {
      console.error(this.formatEntry('error', message, undefined, error));
    }
  }

  debug(message: string, data?: Record<string, unknown>): void {
    if (this.level >= LOG_LEVELS.debug) {
      console.debug(this.formatEntry('debug', message, data));
    }
  }
}
```

**Step 3: Run tests**

Run: `npm test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add src/utils/logger.ts
git commit -m "feat: add structured JSON logging support

Set LOG_FORMAT=json for structured output compatible with log aggregators.
Legacy format preserved as default for human readability."
```

---

## Task 8: Add OpenTelemetry - Instrument Orchestrator

Add metrics instrumentation to the orchestrator.

**Files:**
- Modify: `src/core/orchestrator.ts`
- Modify: `src/index.ts`

**Step 1: Import metrics in orchestrator**

Add to imports in `src/core/orchestrator.ts`:

```typescript
import { metrics } from '../telemetry/metrics.js';
```

**Step 2: Instrument message processing**

In `handleInteractiveMessage`, wrap the main logic:

```typescript
private async handleInteractiveMessage(message: SlackMessage, responder: SlackResponder): Promise<void> {
  const startTime = Date.now();

  try {
    // ... existing code ...

    metrics.messagesProcessed.add(1, {
      channel: message.channelName || 'unknown',
      type: 'interactive',
    });
  } catch (error) {
    metrics.apiErrors.add(1, { type: 'message_processing' });
    throw error;
  } finally {
    const duration = (Date.now() - startTime) / 1000;
    metrics.messageProcessingDuration.record(duration, {
      channel: message.channelName || 'unknown',
    });
  }
}
```

**Step 3: Instrument API calls**

Wrap the Claude API call:

```typescript
const apiStart = Date.now();
const response = await this.anthropic.messages.create({
  model: 'claude-sonnet-4-5',
  // ...
});
metrics.apiCalls.add(1, { model: 'claude-sonnet-4-5' });
metrics.apiCallDuration.record((Date.now() - apiStart) / 1000, { model: 'claude-sonnet-4-5' });
```

**Step 4: Instrument tool execution**

In `executeTool`:

```typescript
private async executeTool(name: string, input: Record<string, unknown>, message: SlackMessage): Promise<string> {
  const startTime = Date.now();

  try {
    // ... existing switch statement ...

    metrics.toolExecutions.add(1, { tool: name, status: 'success' });
    return result;
  } catch (error) {
    metrics.toolExecutions.add(1, { tool: name, status: 'error' });
    throw error;
  } finally {
    metrics.toolExecutionDuration.record((Date.now() - startTime) / 1000, { tool: name });
  }
}
```

**Step 5: Initialize telemetry in index.ts**

Add to `src/index.ts`:

```typescript
import { initTelemetry, shutdownTelemetry } from './telemetry/index.js';

async function main() {
  // Initialize telemetry first
  initTelemetry({
    enabled: process.env.OTEL_ENABLED === 'true',
    serviceName: 'scribble',
    prometheusPort: parseInt(process.env.PROMETHEUS_PORT || '9464'),
  });

  // ... rest of main ...

  // Update shutdown handler
  const shutdown = async () => {
    logger.info('Shutting down...');
    await adapter.stop();
    await shutdownTelemetry();
    process.exit(0);
  };
}
```

**Step 6: Run tests**

Run: `npm test`
Expected: All tests pass

**Step 7: Commit**

```bash
git add src/core/orchestrator.ts src/index.ts
git commit -m "feat: add metrics instrumentation to orchestrator

Track message processing, API calls, and tool execution metrics.
Enable with OTEL_ENABLED=true, metrics exposed on PROMETHEUS_PORT."
```

---

## Task 9: Add OpenTelemetry - Instrument Learning and Wiki

Add metrics for learning and wiki operations.

**Files:**
- Modify: `src/constitution/manager.ts`
- Modify: `src/wiki/wikiManager.ts`

**Step 1: Instrument ConstitutionManager**

Add metrics to learning operations:

```typescript
import { metrics } from '../telemetry/metrics.js';

// In addLearnedBehavior:
metrics.behaviorsLearned.add(1);

// In addChannelInstruction:
metrics.channelInstructionsSet.add(1, { channel });
```

**Step 2: Instrument WikiManager**

Add metrics to wiki operations:

```typescript
import { metrics } from '../telemetry/metrics.js';

// In writeEntry:
metrics.wikiOperations.add(1, { operation: 'write' });

// In deleteEntry:
metrics.wikiOperations.add(1, { operation: 'delete' });

// In renameEntry:
metrics.wikiOperations.add(1, { operation: 'rename' });

// In commit:
metrics.wikiOperations.add(1, { operation: 'commit' });
```

**Step 3: Run tests**

Run: `npm test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add src/constitution/manager.ts src/wiki/wikiManager.ts
git commit -m "feat: add metrics for learning and wiki operations

Track behaviors learned, channel instructions set, and wiki operations."
```

---

## Task 10: Update Configuration

Add telemetry configuration to config.

**Files:**
- Modify: `src/config/config.ts`
- Modify: `CLAUDE.md`

**Step 1: Add telemetry config**

In `src/config/config.ts`, add to Config interface and loadConfig:

```typescript
export interface Config {
  // ... existing ...
  telemetry: {
    enabled: boolean;
    prometheusPort: number;
  };
}

// In loadConfig:
telemetry: {
  enabled: process.env.OTEL_ENABLED === 'true',
  prometheusPort: parseInt(process.env.PROMETHEUS_PORT || '9464'),
},
```

**Step 2: Update CLAUDE.md**

Add to Environment Variables section:

```markdown
Optional (Telemetry):
- `OTEL_ENABLED` - Enable OpenTelemetry (default: false)
- `PROMETHEUS_PORT` - Port for Prometheus metrics (default: 9464)
- `LOG_FORMAT` - Log format: 'json' for structured, omit for human-readable
```

**Step 3: Commit**

```bash
git add src/config/config.ts CLAUDE.md
git commit -m "docs: add telemetry configuration

Document OTEL_ENABLED, PROMETHEUS_PORT, and LOG_FORMAT env vars."
```

---

## Task 11: Add Tests for New Functionality

Add tests for the new StreamLinear tools and telemetry.

**Files:**
- Create: `src/tools/__tests__/streamlinear.test.ts`
- Create: `src/telemetry/__tests__/metrics.test.ts`

**Step 1: Create StreamLinear tests**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { StreamLinearTools } from '../streamlinear.js';

describe('StreamLinearTools', () => {
  let tools: StreamLinearTools;

  beforeEach(() => {
    tools = new StreamLinearTools();
  });

  describe('suggestTicket', () => {
    it('should create a suggestion with unique ID', () => {
      const suggestion = tools.suggestTicket('Test Title', 'Test Description', 'testuser');

      expect(suggestion.id).toMatch(/^suggestion_\d+_\d+$/);
      expect(suggestion.title).toBe('Test Title');
      expect(suggestion.description).toBe('Test Description');
      expect(suggestion.suggestedBy).toBe('testuser');
    });

    it('should store suggestion for later retrieval', () => {
      const suggestion = tools.suggestTicket('Title', 'Desc', 'user');
      const retrieved = tools.getSuggestion(suggestion.id);

      expect(retrieved).toEqual(suggestion);
    });
  });

  describe('removeSuggestion', () => {
    it('should remove existing suggestion', () => {
      const suggestion = tools.suggestTicket('Title', 'Desc', 'user');
      const removed = tools.removeSuggestion(suggestion.id);

      expect(removed).toBe(true);
      expect(tools.getSuggestion(suggestion.id)).toBeUndefined();
    });

    it('should return false for non-existent suggestion', () => {
      const removed = tools.removeSuggestion('fake_id');
      expect(removed).toBe(false);
    });
  });

  describe('getPendingSuggestions', () => {
    it('should return all pending suggestions', () => {
      tools.suggestTicket('Title 1', 'Desc 1', 'user1');
      tools.suggestTicket('Title 2', 'Desc 2', 'user2');

      const pending = tools.getPendingSuggestions();
      expect(pending).toHaveLength(2);
    });
  });
});
```

**Step 2: Run tests**

Run: `npm test`
Expected: All tests pass including new ones

**Step 3: Commit**

```bash
git add src/tools/__tests__/streamlinear.test.ts
git commit -m "test: add StreamLinear tools tests"
```

---

## Task 12: Final Integration Test and Cleanup

Verify everything works together.

**Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 2: Build the project**

Run: `npm run build`
Expected: No TypeScript errors

**Step 3: Test locally (if possible)**

Run: `npm run dev`
Verify startup logs show telemetry initialization (if enabled).

**Step 4: Final commit with any fixes**

```bash
git add -A
git commit -m "chore: final cleanup and integration verification"
```

**Step 5: Push and let auto-deploy run**

```bash
git push
```

The auto-deploy workflow will build and deploy to ECS.

---

## Summary

| Task | Description | Files Modified |
|------|-------------|----------------|
| 1 | Add learning guidance to constitution | `src/constitution/base.ts` |
| 2 | Add error handling to ConstitutionManager | `src/constitution/manager.ts` |
| 3 | Remove stub Linear implementation | Delete `src/tools/linear.ts`, modify orchestrator |
| 4 | Add StreamLinear MCP integration | Create `src/tools/streamlinear.ts`, modify orchestrator |
| 5 | Install OpenTelemetry dependencies | `package.json` |
| 6 | Create telemetry module | Create `src/telemetry/` |
| 7 | Update Logger for structured output | `src/utils/logger.ts` |
| 8 | Instrument orchestrator | `src/core/orchestrator.ts`, `src/index.ts` |
| 9 | Instrument learning and wiki | `src/constitution/manager.ts`, `src/wiki/wikiManager.ts` |
| 10 | Update configuration | `src/config/config.ts`, `CLAUDE.md` |
| 11 | Add tests | Create test files |
| 12 | Final integration | All files |

**Total estimated tasks:** 12 major tasks with multiple steps each.
