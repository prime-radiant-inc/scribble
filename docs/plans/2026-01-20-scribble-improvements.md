# Scribble Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix name recognition to avoid URL/substring matches, remove redundant YAML frontmatter from wiki pages, and add wiki gardening capabilities (edit, rename, delete) with proactive suggestions.

**Architecture:** Three areas of change: (1) Tighten name detection regex in AttentionTracker to require whitespace boundaries, (2) Simplify WikiManager to write plain markdown without frontmatter, (3) Add wiki mutation methods and expose them as tools with suggestion-confirmation pattern for proactive gardening.

**Tech Stack:** TypeScript, Vitest, simple-git

---

## Task 1: Fix Name Recognition Regex

The current `/\bscribble\b/i` pattern matches "scribble" in URLs like `foo.com/scribble` because `/` is a word boundary. We need stricter matching: only whitespace or string boundaries.

**Files:**
- Modify: `src/attention/types.ts:21-23`
- Modify: `src/attention/__tests__/tracker.test.ts`

**Step 1: Write failing tests for false positives**

Add to `src/attention/__tests__/tracker.test.ts`:

```typescript
describe('name detection edge cases', () => {
  it('should NOT engage for scribble in URL path', () => {
    const result = tracker.shouldEngage({
      text: 'Check out foo.com/scribble for more info',
      channelId: 'C123',
      threadTs: null,
    });
    expect(result.shouldEngage).toBe(false);
  });

  it('should NOT engage for scribble in URL subdomain', () => {
    const result = tracker.shouldEngage({
      text: 'Visit scribble.example.com',
      channelId: 'C123',
      threadTs: null,
    });
    expect(result.shouldEngage).toBe(false);
  });

  it('should NOT engage for scribbled (suffix)', () => {
    const result = tracker.shouldEngage({
      text: 'I scribbled some notes',
      channelId: 'C123',
      threadTs: null,
    });
    expect(result.shouldEngage).toBe(false);
  });

  it('should NOT engage for the-scribbling (hyphenated)', () => {
    const result = tracker.shouldEngage({
      text: 'Check out the-scribbling project',
      channelId: 'C123',
      threadTs: null,
    });
    expect(result.shouldEngage).toBe(false);
  });

  it('should NOT engage for scribble as part of identifier', () => {
    const result = tracker.shouldEngage({
      text: 'The scribble_bot variable is set',
      channelId: 'C123',
      threadTs: null,
    });
    expect(result.shouldEngage).toBe(false);
  });

  it('should engage for scribble at start of message', () => {
    const result = tracker.shouldEngage({
      text: 'Scribble, can you help?',
      channelId: 'C123',
      threadTs: null,
    });
    expect(result.shouldEngage).toBe(true);
    expect(result.reason).toBe('name');
  });

  it('should engage for scribble at end of message', () => {
    const result = tracker.shouldEngage({
      text: 'What do you think, scribble',
      channelId: 'C123',
      threadTs: null,
    });
    expect(result.shouldEngage).toBe(true);
    expect(result.reason).toBe('name');
  });

  it('should engage for scribble mid-sentence with spaces', () => {
    const result = tracker.shouldEngage({
      text: 'Hey scribble how are you',
      channelId: 'C123',
      threadTs: null,
    });
    expect(result.shouldEngage).toBe(true);
    expect(result.reason).toBe('name');
  });

  it('should engage for scribble with punctuation', () => {
    const result = tracker.shouldEngage({
      text: 'Thanks, scribble!',
      channelId: 'C123',
      threadTs: null,
    });
    expect(result.shouldEngage).toBe(true);
    expect(result.reason).toBe('name');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- src/attention/__tests__/tracker.test.ts`
Expected: Multiple failures for the "should NOT engage" tests

**Step 3: Fix the NAME_PATTERNS regex**

In `src/attention/types.ts`, replace:

```typescript
export const NAME_PATTERNS = [
  /\bscribble\b/i,
];
```

With:

```typescript
// Match "scribble" only when surrounded by whitespace, punctuation, or string boundaries
// Does NOT match: URLs (foo.com/scribble), hyphenated (the-scribbling),
// suffixed (scribbled), underscored (scribble_bot)
export const NAME_PATTERNS = [
  /(?:^|[\s,.:;!?])scribble(?:[\s,.:;!?]|$)/i,
];
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- src/attention/__tests__/tracker.test.ts`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/attention/types.ts src/attention/__tests__/tracker.test.ts
git commit -m "fix: tighten name recognition to avoid URL/substring matches"
```

---

## Task 2: Remove YAML Frontmatter from Wiki Pages

The frontmatter (title, category, subcategory, created, updated) is redundant - title is in the content as H1, category/subcategory are in the path, dates are in git history.

**Files:**
- Modify: `src/wiki/wikiManager.ts:183-196`
- Modify: `src/core/types.ts` (WikiEntry interface)

**Step 1: Simplify WikiEntry interface**

In `src/core/types.ts`, find the WikiEntry interface and remove frontmatter-only fields. The interface should become:

```typescript
export interface WikiEntry {
  path: string;
  title: string;
  content: string;  // Just the markdown content, no frontmatter
}
```

**Step 2: Simplify buildContent method**

In `src/wiki/wikiManager.ts`, replace the `buildContent` method (lines 183-196):

```typescript
private buildContent(entry: WikiEntry): string {
  // No frontmatter - title is H1, category/subcategory from path, dates from git
  return entry.content;
}
```

**Step 3: Update all WikiEntry usages**

Search for places creating WikiEntry objects and remove the extra fields:
- `src/core/orchestrator.ts` - executeTool method, create_wiki_entry case
- `src/core/orchestrator.ts` - saveFact method

Update the orchestrator's `executeTool` (create_wiki_entry case):

```typescript
case 'create_wiki_entry': {
  const title = input.title as string;
  const content = input.content as string;
  const category = input.category as string;
  const filename = this.titleToFilename(title);
  const entryPath = `${category}/${filename}.md`;

  await this.wikiManager.writeEntry({
    path: entryPath,
    title,
    content: `# ${title}\n\n${content}`,
  });
  // ... rest unchanged
}
```

Update `saveFact` method similarly - the content should just be markdown.

**Step 4: Run tests**

Run: `npm test`
Expected: All tests pass (or update tests that check WikiEntry structure)

**Step 5: Commit**

```bash
git add src/wiki/wikiManager.ts src/core/types.ts src/core/orchestrator.ts
git commit -m "refactor: remove redundant YAML frontmatter from wiki pages"
```

---

## Task 3: Add Wiki Delete Capability

Add `deleteEntry` method to WikiManager.

**Files:**
- Modify: `src/wiki/wikiManager.ts`
- Create: `src/wiki/__tests__/wikiManager.test.ts`

**Step 1: Write failing test**

Create `src/wiki/__tests__/wikiManager.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WikiManager } from '../wikiManager.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('WikiManager', () => {
  let wikiManager: WikiManager;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-test-'));
    // Initialize as a git repo for WikiManager
    const { execSync } = await import('child_process');
    execSync('git init', { cwd: tempDir });
    execSync('git config user.email "test@test.com"', { cwd: tempDir });
    execSync('git config user.name "Test"', { cwd: tempDir });

    wikiManager = new WikiManager(tempDir, 'test/repo');
    // Mark as initialized to skip clone
    (wikiManager as any).initialized = true;
    (wikiManager as any).git = (await import('simple-git')).simpleGit(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('deleteEntry', () => {
    it('should delete an existing entry', async () => {
      // Create a file first
      const entryPath = 'knowledge/test.md';
      const fullPath = path.join(tempDir, entryPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, '# Test\n\nContent');

      await wikiManager.deleteEntry(entryPath);

      expect(fs.existsSync(fullPath)).toBe(false);
    });

    it('should return false for non-existent entry', async () => {
      const result = await wikiManager.deleteEntry('does/not/exist.md');
      expect(result).toBe(false);
    });

    it('should return true for successful deletion', async () => {
      const entryPath = 'knowledge/test.md';
      const fullPath = path.join(tempDir, entryPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, '# Test');

      const result = await wikiManager.deleteEntry(entryPath);
      expect(result).toBe(true);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/wiki/__tests__/wikiManager.test.ts`
Expected: FAIL - deleteEntry is not a function

**Step 3: Implement deleteEntry**

Add to `src/wiki/wikiManager.ts`:

```typescript
/**
 * Delete a wiki entry
 * @returns true if deleted, false if entry didn't exist
 */
async deleteEntry(entryPath: string): Promise<boolean> {
  await this.initialize();

  const fullPath = path.join(this.localPath, entryPath);
  if (!fs.existsSync(fullPath)) {
    return false;
  }

  fs.unlinkSync(fullPath);
  logger.info('Wiki entry deleted', { path: entryPath });
  return true;
}
```

**Step 4: Run tests**

Run: `npm test -- src/wiki/__tests__/wikiManager.test.ts`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/wiki/wikiManager.ts src/wiki/__tests__/wikiManager.test.ts
git commit -m "feat: add deleteEntry method to WikiManager"
```

---

## Task 4: Add Wiki Rename Capability

Add `renameEntry` method to WikiManager.

**Files:**
- Modify: `src/wiki/wikiManager.ts`
- Modify: `src/wiki/__tests__/wikiManager.test.ts`

**Step 1: Write failing test**

Add to `src/wiki/__tests__/wikiManager.test.ts`:

```typescript
describe('renameEntry', () => {
  it('should rename an existing entry', async () => {
    const oldPath = 'knowledge/old-name.md';
    const newPath = 'knowledge/new-name.md';
    const fullOldPath = path.join(tempDir, oldPath);
    const fullNewPath = path.join(tempDir, newPath);

    fs.mkdirSync(path.dirname(fullOldPath), { recursive: true });
    fs.writeFileSync(fullOldPath, '# Old Name\n\nContent');

    await wikiManager.renameEntry(oldPath, newPath);

    expect(fs.existsSync(fullOldPath)).toBe(false);
    expect(fs.existsSync(fullNewPath)).toBe(true);
    expect(fs.readFileSync(fullNewPath, 'utf-8')).toContain('Content');
  });

  it('should move entry to different category', async () => {
    const oldPath = 'knowledge/projects/item.md';
    const newPath = 'knowledge/decisions/item.md';
    const fullOldPath = path.join(tempDir, oldPath);
    const fullNewPath = path.join(tempDir, newPath);

    fs.mkdirSync(path.dirname(fullOldPath), { recursive: true });
    fs.writeFileSync(fullOldPath, '# Item');

    await wikiManager.renameEntry(oldPath, newPath);

    expect(fs.existsSync(fullOldPath)).toBe(false);
    expect(fs.existsSync(fullNewPath)).toBe(true);
  });

  it('should return false for non-existent source', async () => {
    const result = await wikiManager.renameEntry('does/not/exist.md', 'new/path.md');
    expect(result).toBe(false);
  });

  it('should return true for successful rename', async () => {
    const oldPath = 'knowledge/test.md';
    fs.mkdirSync(path.join(tempDir, 'knowledge'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, oldPath), '# Test');

    const result = await wikiManager.renameEntry(oldPath, 'knowledge/renamed.md');
    expect(result).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/wiki/__tests__/wikiManager.test.ts`
Expected: FAIL - renameEntry is not a function

**Step 3: Implement renameEntry**

Add to `src/wiki/wikiManager.ts`:

```typescript
/**
 * Rename/move a wiki entry
 * @returns true if renamed, false if source didn't exist
 */
async renameEntry(oldPath: string, newPath: string): Promise<boolean> {
  await this.initialize();

  const fullOldPath = path.join(this.localPath, oldPath);
  const fullNewPath = path.join(this.localPath, newPath);

  if (!fs.existsSync(fullOldPath)) {
    return false;
  }

  // Ensure destination directory exists
  const destDir = path.dirname(fullNewPath);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  fs.renameSync(fullOldPath, fullNewPath);
  logger.info('Wiki entry renamed', { from: oldPath, to: newPath });
  return true;
}
```

**Step 4: Run tests**

Run: `npm test -- src/wiki/__tests__/wikiManager.test.ts`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/wiki/wikiManager.ts src/wiki/__tests__/wikiManager.test.ts
git commit -m "feat: add renameEntry method to WikiManager"
```

---

## Task 5: Add Wiki Editing Tools to Orchestrator

Add tools for Haiku to edit, delete, and rename wiki pages.

**Files:**
- Modify: `src/core/orchestrator.ts`

**Step 1: Add tool definitions**

Add to the TOOLS array in `src/core/orchestrator.ts`:

```typescript
{
  name: 'edit_wiki_entry',
  description: 'Edit an existing wiki entry. Provide the full new content.',
  input_schema: {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'Path to the wiki entry (e.g., knowledge/projects/scribble.md)',
      },
      content: {
        type: 'string',
        description: 'New markdown content for the wiki entry',
      },
    },
    required: ['path', 'content'],
  },
},
{
  name: 'delete_wiki_entry',
  description: 'Delete a wiki entry. Use with caution.',
  input_schema: {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'Path to the wiki entry to delete',
      },
    },
    required: ['path'],
  },
},
{
  name: 'rename_wiki_entry',
  description: 'Rename or move a wiki entry to a new path.',
  input_schema: {
    type: 'object' as const,
    properties: {
      old_path: {
        type: 'string',
        description: 'Current path of the wiki entry',
      },
      new_path: {
        type: 'string',
        description: 'New path for the wiki entry',
      },
    },
    required: ['old_path', 'new_path'],
  },
},
```

**Step 2: Implement tool handlers**

Add cases to the `executeTool` switch statement:

```typescript
case 'edit_wiki_entry': {
  const entryPath = input.path as string;
  const content = input.content as string;

  const existing = await this.wikiManager.readEntry(entryPath);
  if (!existing) {
    return `Wiki entry not found: ${entryPath}`;
  }

  await this.wikiManager.writeEntry({
    path: entryPath,
    title: this.extractTitleFromContent(content),
    content,
  });

  await this.wikiManager.commit(`Edit: ${entryPath}`);
  logger.info('Edited wiki entry', { path: entryPath });
  return `Edited wiki entry: ${entryPath}`;
}

case 'delete_wiki_entry': {
  const entryPath = input.path as string;

  const deleted = await this.wikiManager.deleteEntry(entryPath);
  if (!deleted) {
    return `Wiki entry not found: ${entryPath}`;
  }

  await this.wikiManager.commit(`Delete: ${entryPath}`);
  logger.info('Deleted wiki entry', { path: entryPath });
  return `Deleted wiki entry: ${entryPath}`;
}

case 'rename_wiki_entry': {
  const oldPath = input.old_path as string;
  const newPath = input.new_path as string;

  const renamed = await this.wikiManager.renameEntry(oldPath, newPath);
  if (!renamed) {
    return `Wiki entry not found: ${oldPath}`;
  }

  await this.wikiManager.commit(`Rename: ${oldPath} -> ${newPath}`);
  logger.info('Renamed wiki entry', { from: oldPath, to: newPath });
  return `Renamed wiki entry: ${oldPath} -> ${newPath}`;
}
```

**Step 3: Add helper method**

Add to ScribbleOrchestrator class:

```typescript
private extractTitleFromContent(content: string): string {
  const h1Match = content.match(/^#\s+(.+)$/m);
  if (h1Match) return h1Match[1];
  return 'Untitled';
}
```

**Step 4: Run tests**

Run: `npm test`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/core/orchestrator.ts
git commit -m "feat: add wiki edit/delete/rename tools for Haiku"
```

---

## Task 6: Add Wiki Gardening Suggestions

Add proactive suggestions for wiki cleanup (duplicate pages, miscategorized content) using the suggestion-confirmation pattern like Linear tickets.

**Files:**
- Create: `src/wiki/gardener.ts`
- Create: `src/wiki/gardener.types.ts`
- Create: `src/wiki/__tests__/gardener.test.ts`
- Modify: `src/core/orchestrator.ts`

**Step 1: Create types**

Create `src/wiki/gardener.types.ts`:

```typescript
export type GardeningSuggestionType =
  | 'duplicate'      // Two pages cover same topic
  | 'miscategorized' // Page is in wrong category
  | 'outdated'       // Page content seems stale
  | 'merge'          // Pages should be combined
  | 'split'          // Page covers too many topics

export interface GardeningSuggestion {
  id: string;
  type: GardeningSuggestionType;
  description: string;
  affectedPaths: string[];
  suggestedAction: string;
  confidence: number;  // 0-1
  createdAt: number;
}

export interface GardenerConfig {
  minConfidence: number;  // Only surface suggestions above this threshold
}
```

**Step 2: Create gardener with tests**

Create `src/wiki/__tests__/gardener.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { WikiGardener } from '../gardener.js';

describe('WikiGardener', () => {
  let gardener: WikiGardener;

  beforeEach(() => {
    gardener = new WikiGardener({ minConfidence: 0.7 });
  });

  describe('suggestion management', () => {
    it('should store and retrieve suggestions', () => {
      gardener.addSuggestion({
        type: 'duplicate',
        description: 'Pages cover same topic',
        affectedPaths: ['knowledge/auth.md', 'knowledge/authentication.md'],
        suggestedAction: 'Merge into single page',
        confidence: 0.8,
      });

      const suggestions = gardener.getPendingSuggestions();
      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].type).toBe('duplicate');
    });

    it('should confirm and remove suggestion', () => {
      gardener.addSuggestion({
        type: 'duplicate',
        description: 'Test',
        affectedPaths: ['a.md', 'b.md'],
        suggestedAction: 'Merge',
        confidence: 0.8,
      });

      const suggestions = gardener.getPendingSuggestions();
      const id = suggestions[0].id;

      const confirmed = gardener.confirmSuggestion(id);
      expect(confirmed).not.toBeNull();
      expect(gardener.getPendingSuggestions()).toHaveLength(0);
    });

    it('should dismiss suggestion', () => {
      gardener.addSuggestion({
        type: 'outdated',
        description: 'Test',
        affectedPaths: ['old.md'],
        suggestedAction: 'Update',
        confidence: 0.9,
      });

      const suggestions = gardener.getPendingSuggestions();
      gardener.dismissSuggestion(suggestions[0].id);

      expect(gardener.getPendingSuggestions()).toHaveLength(0);
    });

    it('should filter by minimum confidence', () => {
      gardener.addSuggestion({
        type: 'duplicate',
        description: 'Low confidence',
        affectedPaths: ['a.md'],
        suggestedAction: 'Check',
        confidence: 0.5,  // Below 0.7 threshold
      });

      // Should not appear in pending (below threshold)
      expect(gardener.getPendingSuggestions()).toHaveLength(0);
    });
  });

  describe('formatSuggestionForSlack', () => {
    it('should format suggestion as Slack message', () => {
      gardener.addSuggestion({
        type: 'duplicate',
        description: 'Auth pages overlap',
        affectedPaths: ['knowledge/auth.md', 'knowledge/authentication.md'],
        suggestedAction: 'Merge into knowledge/authentication.md',
        confidence: 0.85,
      });

      const suggestion = gardener.getPendingSuggestions()[0];
      const formatted = gardener.formatSuggestionForSlack(suggestion);

      expect(formatted).toContain('duplicate');
      expect(formatted).toContain('Auth pages overlap');
      expect(formatted).toContain('knowledge/auth.md');
    });
  });
});
```

**Step 3: Implement gardener**

Create `src/wiki/gardener.ts`:

```typescript
import { GardeningSuggestion, GardeningSuggestionType, GardenerConfig } from './gardener.types.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('WikiGardener');

export class WikiGardener {
  private suggestions: Map<string, GardeningSuggestion> = new Map();
  private config: GardenerConfig;

  constructor(config: GardenerConfig) {
    this.config = config;
  }

  addSuggestion(suggestion: Omit<GardeningSuggestion, 'id' | 'createdAt'>): void {
    if (suggestion.confidence < this.config.minConfidence) {
      logger.debug('Suggestion below confidence threshold', {
        confidence: suggestion.confidence,
        threshold: this.config.minConfidence
      });
      return;
    }

    const id = `garden-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const fullSuggestion: GardeningSuggestion = {
      ...suggestion,
      id,
      createdAt: Date.now(),
    };

    this.suggestions.set(id, fullSuggestion);
    logger.info('Added gardening suggestion', { id, type: suggestion.type });
  }

  getPendingSuggestions(): GardeningSuggestion[] {
    return Array.from(this.suggestions.values());
  }

  getSuggestion(id: string): GardeningSuggestion | null {
    return this.suggestions.get(id) || null;
  }

  confirmSuggestion(id: string): GardeningSuggestion | null {
    const suggestion = this.suggestions.get(id);
    if (suggestion) {
      this.suggestions.delete(id);
      logger.info('Suggestion confirmed', { id });
    }
    return suggestion || null;
  }

  dismissSuggestion(id: string): void {
    this.suggestions.delete(id);
    logger.info('Suggestion dismissed', { id });
  }

  formatSuggestionForSlack(suggestion: GardeningSuggestion): string {
    const typeEmoji: Record<GardeningSuggestionType, string> = {
      duplicate: ':card_index_dividers:',
      miscategorized: ':file_folder:',
      outdated: ':calendar:',
      merge: ':link:',
      split: ':scissors:',
    };

    const emoji = typeEmoji[suggestion.type] || ':bulb:';
    const paths = suggestion.affectedPaths.map(p => `\`${p}\``).join(', ');

    return [
      `${emoji} *Wiki gardening suggestion* (${suggestion.type})`,
      ``,
      suggestion.description,
      ``,
      `*Affected:* ${paths}`,
      `*Suggestion:* ${suggestion.suggestedAction}`,
      ``,
      `Reply "yes" to apply, or "no" to dismiss.`,
    ].join('\n');
  }
}

export { GardeningSuggestion, GardeningSuggestionType, GardenerConfig };
```

**Step 4: Run tests**

Run: `npm test -- src/wiki/__tests__/gardener.test.ts`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/wiki/gardener.ts src/wiki/gardener.types.ts src/wiki/__tests__/gardener.test.ts
git commit -m "feat: add WikiGardener for proactive wiki maintenance suggestions"
```

---

## Task 7: Integrate Gardener into Orchestrator

Wire up the gardener to detect issues during extraction and surface suggestions.

**Files:**
- Modify: `src/core/orchestrator.ts`
- Modify: `src/pipeline/extractor.ts`

**Step 1: Add gardener to orchestrator**

In `src/core/orchestrator.ts`, add:

```typescript
import { WikiGardener } from '../wiki/gardener.js';

// In OrchestratorConfig interface:
export interface OrchestratorConfig {
  // ... existing fields
  wikiGardener?: WikiGardener;
}

// In class:
private wikiGardener: WikiGardener | null;

// In constructor:
this.wikiGardener = opts.wikiGardener || null;
```

**Step 2: Add gardening tool**

Add to TOOLS array:

```typescript
{
  name: 'suggest_wiki_gardening',
  description: 'Proactively suggest wiki improvements (duplicates, miscategorization, merges)',
  input_schema: {
    type: 'object' as const,
    properties: {
      type: {
        type: 'string',
        enum: ['duplicate', 'miscategorized', 'outdated', 'merge', 'split'],
        description: 'Type of gardening suggestion',
      },
      description: {
        type: 'string',
        description: 'Description of the issue found',
      },
      affected_paths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Wiki paths affected by this issue',
      },
      suggested_action: {
        type: 'string',
        description: 'Recommended action to fix the issue',
      },
      confidence: {
        type: 'number',
        description: 'Confidence level 0-1',
      },
    },
    required: ['type', 'description', 'affected_paths', 'suggested_action', 'confidence'],
  },
},
{
  name: 'apply_gardening_suggestion',
  description: 'Apply a pending wiki gardening suggestion after user confirms',
  input_schema: {
    type: 'object' as const,
    properties: {
      suggestion_id: {
        type: 'string',
        description: 'ID of the suggestion to apply',
      },
    },
    required: ['suggestion_id'],
  },
},
```

**Step 3: Implement tool handlers**

Add to executeTool switch:

```typescript
case 'suggest_wiki_gardening': {
  if (!this.wikiGardener) {
    return 'Wiki gardening not enabled';
  }

  this.wikiGardener.addSuggestion({
    type: input.type as any,
    description: input.description as string,
    affectedPaths: input.affected_paths as string[],
    suggestedAction: input.suggested_action as string,
    confidence: input.confidence as number,
  });

  const suggestions = this.wikiGardener.getPendingSuggestions();
  const latest = suggestions[suggestions.length - 1];

  if (latest) {
    return this.wikiGardener.formatSuggestionForSlack(latest);
  }
  return 'Suggestion noted (below confidence threshold)';
}

case 'apply_gardening_suggestion': {
  if (!this.wikiGardener) {
    return 'Wiki gardening not enabled';
  }

  const suggestionId = input.suggestion_id as string;
  const suggestion = this.wikiGardener.confirmSuggestion(suggestionId);

  if (!suggestion) {
    return `Suggestion not found: ${suggestionId}`;
  }

  // Return the suggestion so Haiku can execute the appropriate action
  return JSON.stringify({
    confirmed: true,
    suggestion,
    instruction: `Execute the suggested action: ${suggestion.suggestedAction}`,
  });
}
```

**Step 4: Initialize gardener in index.ts**

In `src/index.ts`, add:

```typescript
import { WikiGardener } from './wiki/gardener.js';

// After wiki manager initialization:
const wikiGardener = new WikiGardener({ minConfidence: 0.7 });

// Pass to orchestrator:
const orchestrator = new ScribbleOrchestrator({
  // ... existing
  wikiGardener,
});
```

**Step 5: Run tests**

Run: `npm test`
Expected: All tests pass

**Step 6: Commit**

```bash
git add src/core/orchestrator.ts src/index.ts
git commit -m "feat: integrate WikiGardener with suggestion-confirmation pattern"
```

---

## Task 8: Update System Prompt for Gardening

Update the system prompt to instruct Haiku about wiki gardening.

**Files:**
- Modify: `src/core/orchestrator.ts`

**Step 1: Update SYSTEM_PROMPT**

Add to the SYSTEM_PROMPT in `src/core/orchestrator.ts`:

```typescript
// Add to the "## Tools Available" section:

## Wiki Gardening
You can proactively improve the wiki by:
- Identifying duplicate pages covering the same topic
- Noticing miscategorized content (wrong folder)
- Suggesting merges when pages should be combined
- Suggesting splits when pages cover too many topics

When you notice wiki issues during conversation or extraction:
1. Use suggest_wiki_gardening to propose the fix
2. Wait for user confirmation before making changes
3. After confirmation, use the appropriate wiki tool (edit, delete, rename) to implement

NEVER make wiki changes without first suggesting and getting confirmation.
```

**Step 2: Commit**

```bash
git add src/core/orchestrator.ts
git commit -m "docs: update system prompt with wiki gardening instructions"
```

---

## Summary

After completing all tasks:
- Name recognition only triggers on whitespace-bounded "scribble"
- Wiki pages are plain markdown without YAML frontmatter
- WikiManager has delete and rename capabilities
- Haiku has tools to edit, delete, and rename wiki entries
- WikiGardener provides proactive suggestions with confirmation pattern
- System prompt guides Haiku on wiki gardening behavior
