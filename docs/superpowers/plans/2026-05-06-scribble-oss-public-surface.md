# Scribble OSS Public Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Scribble's Docker-first external install surface coherent for trusted self-hosted workspaces without changing the product's core Slack behavior.

**Architecture:** Add one small tenant config module, pass its normalized values through the main process and `scribble-mcp`, then thread those values into engagement, constitution text, decision logging, wiki commits, and public docs. Keep Linear optional at runtime while keeping the temporary Docker named-context bridge honest until `PRI-1500` removes it.

**Tech Stack:** TypeScript, Node.js 20, Vitest, Docker BuildKit named contexts, Docker Compose, Slack app manifest YAML.

---

## File Structure

### Runtime Config And Identity

- Create `src/config/tenantConfig.ts`: pure tenant/runtime parser for Scribble identity, aliases, decision-log channel, wiki git author, and normalized env propagation.
- Create `src/config/engagement.ts`: builds bot-toolkit `EngagementConfig` from parsed tenant config.
- Modify `src/config/config.ts`: add `tenant` and `timezone` to `Config`, call `parseTenantConfig()`, and use a parsed timezone default.
- Keep `src/config/wikiRepo.ts`: existing `requireWikiRepo()` already requires `WIKI_REPO` with no default; do not reintroduce a Prime Radiant wiki fallback.
- Modify `src/config/instanceConfig.ts`: accept parsed tenant config, pass normalized tenant env to `scribble-mcp`, and treat blank `LINEAR_API_KEY` as disabled.
- Modify `src/index.ts`: use parsed tenant config for bot-toolkit timezone, generated instance config, constitution manager, orchestrator, and engagement config.
- Create `src/utils/regex.ts`: shared regex escaping helper for tenant aliases and immutable-pattern builders.
- Modify `src/utils/slackIds.ts`: add shared Slack channel label formatting next to the existing channel ID validator.
- Test `src/config/__tests__/tenantConfig.test.ts`: parser defaults, custom env, validation, aliases, optional env handling.
- Test `src/config/__tests__/config.test.ts`: `loadConfig()` includes tenant and timezone defaults/custom values.
- Test `src/config/__tests__/instanceConfig.test.ts`: normalized env reaches `scribble-mcp`, Linear blank disables cleanly.
- Test `src/config/__tests__/engagement.test.ts`: effective aliases and dismissal regexes use bot name plus aliases with regex escaping.

### Prompt, MCP, Wiki, And Decisions

- Modify `src/constitution/base.ts`: replace fixed `BASE_CONSTITUTION` export with `renderBaseConstitution(tenant, integrations)`.
- Modify `src/constitution/manager.ts`: accept tenant config and integration flags; render the base constitution dynamically.
- Test `src/constitution/__tests__/manager.test.ts`: custom org, bot name, decision-log channel, and conditional Linear guidance.
- Create `src/mcp/toolDescriptions.ts`: pure builders for MCP tool descriptions that need tenant config.
- Modify `src/mcp/index.ts`: parse tenant config without full `loadConfig()`, use description builders, construct `WikiManager` with configured git author.
- Test `src/mcp/__tests__/toolDescriptions.test.ts`: `respond`, `log_decision`, and `leave_channel` wording use config and avoid stale hard-coded identity claims.
- Modify `src/wiki/wikiManager.ts`: accept configurable git author name/email with neutral OSS-safe email defaults.
- Test `src/wiki/__tests__/wikiManager.test.ts`: wiki git author config uses tenant values.
- Modify `src/orchestrator/scribbleOrchestrator.ts`: accept configured decision-log channel, support channel ID passthrough, paginated public channel-name lookup, parser-canonicalized `#` handling, and retry after lookup misses.
- Test `src/orchestrator/__tests__/scribbleOrchestrator.test.ts`: decision-log name, ID, pagination, parser canonicalization, and miss retry.
- Test `src/utils/__tests__/slackIds.test.ts`: channel ID validation and label formatting are shared across constitution, MCP descriptions, and orchestrator code.

### Docker And Public Surface

- Create `docs/bridge-refs.json`: single machine-readable source for temporary bridge refs and bot-toolkit lockfile integrity.
- Create `scripts/check-bridge-refs.mjs`: verifies bridge metadata against `package-lock.json` and local sibling checkout SHAs when available.
- Create `docker-compose.yml`: friendly external Docker path with BuildKit named contexts and forced `DATA_DIRECTORY=/data`.
- Modify `.env.example`: add tenant env values and keep local `DATA_DIRECTORY=./data` clearly scoped to local development.
- Modify `README.md`: make Docker Compose the first install path, point bridge checkout refs/provenance at `docs/bridge-refs.json`, include raw Docker `/data` safety, first-run checklist, broad data-flow explanation, optional Linear, and trusted-workspace boundary.
- Modify `Dockerfile`: keep named-context comments aligned with README and point to `docs/bridge-refs.json` instead of duplicating refs.
- Modify `SECURITY.md`: stay truthful, no fake reporting contact, no automatic-channel-join claim unless implementation actually wires it.
- Modify `slack-app-manifest.yaml`: keep scope set, but make comments honest about real current use versus retained broad/full-behavior scope.
- Modify `src/__tests__/manifest.test.ts`: keep expected scope/event set stable unless comments-only changes need no test change.
- Modify `src/mcp/index.ts`: clean `leave_channel` description/acknowledgment so it is not presented as an enforced privacy boundary.
- Modify `package.json`: remove Prime Radiant-only package description.
- Modify `AGENTS.md` and `CLAUDE.md`: update wiki default docs and tenant env docs.

---

## Task 1: Add Tenant Config Parser

**Files:**
- Create: `src/config/tenantConfig.ts`
- Create: `src/config/__tests__/tenantConfig.test.ts`
- Modify: `src/config/config.ts`
- Modify: `src/config/__tests__/config.test.ts`
- Verify: `src/config/wikiRepo.ts`

- [ ] **Step 1: Inspect current worktree**

Run:

```bash
cd /Users/drewritter/prime-rad/sen/scribble
git status --short --branch
```

Expected: note any unrelated existing changes. Do not overwrite them.

- [ ] **Step 2: Write tenant parser tests**

Create `src/config/__tests__/tenantConfig.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TENANT_CONFIG,
  parseOptionalEnv,
  parseTenantConfig,
  tenantConfigToEnv,
} from '../tenantConfig.js';

describe('parseTenantConfig', () => {
  it('uses built-in runtime defaults when env values are unset', () => {
    expect(parseTenantConfig({})).toEqual(DEFAULT_TENANT_CONFIG);
  });

  it('trims custom tenant values and builds effective aliases', () => {
    const config = parseTenantConfig({
      SCRIBBLE_ORG_NAME: ' Acme Co ',
      SCRIBBLE_BOT_NAME: ' Scout ',
      SCRIBBLE_BOT_ALIASES: ' scout,helper,SCOUT ',
      SCRIBBLE_DECISION_LOG_CHANNEL: ' #decisions ',
      SCRIBBLE_WIKI_GIT_AUTHOR_NAME: ' Scout Bot ',
      SCRIBBLE_WIKI_GIT_AUTHOR_EMAIL: ' scout@example.com ',
    });

    expect(config).toEqual({
      orgName: 'Acme Co',
      botName: 'Scout',
      botAliases: ['scout', 'helper', 'SCOUT'],
      effectiveAliases: ['Scout', 'helper'],
      decisionLogChannel: 'decisions',
      wikiGitAuthorName: 'Scout Bot',
      wikiGitAuthorEmail: 'scout@example.com',
    });
  });

  it.each([
    ['SCRIBBLE_ORG_NAME'],
    ['SCRIBBLE_BOT_NAME'],
    ['SCRIBBLE_BOT_ALIASES'],
    ['SCRIBBLE_DECISION_LOG_CHANNEL'],
    ['SCRIBBLE_WIKI_GIT_AUTHOR_NAME'],
    ['SCRIBBLE_WIKI_GIT_AUTHOR_EMAIL'],
  ])('rejects present-but-empty %s', (key) => {
    expect(() => parseTenantConfig({ [key]: '   ' })).toThrow(key);
  });

  it('rejects alias lists with no non-empty aliases', () => {
    expect(() => parseTenantConfig({ SCRIBBLE_BOT_ALIASES: ' , , ' })).toThrow('SCRIBBLE_BOT_ALIASES');
  });

  it.each([
    ['my decision log'],
    ['#wrong#chars'],
    ['UPPERCASE'],
  ])('rejects malformed decision-log channel value %s', (value) => {
    expect(() => parseTenantConfig({ SCRIBBLE_DECISION_LOG_CHANNEL: value })).toThrow('SCRIBBLE_DECISION_LOG_CHANNEL');
  });

  it('accepts Slack channel names with periods', () => {
    expect(parseTenantConfig({ SCRIBBLE_DECISION_LOG_CHANNEL: 'team.alpha' }).decisionLogChannel).toBe('team.alpha');
  });

  it('dedupes aliases case-insensitively while preserving first spelling', () => {
    const config = parseTenantConfig({
      SCRIBBLE_BOT_NAME: 'Scribble',
      SCRIBBLE_BOT_ALIASES: 'scribble,Scrib,SCRIB,scribe',
    });

    expect(config.effectiveAliases).toEqual(['Scribble', 'Scrib', 'scribe']);
  });

  it('serializes normalized env for the MCP subprocess', () => {
    const config = parseTenantConfig({
      SCRIBBLE_ORG_NAME: 'Acme',
      SCRIBBLE_BOT_NAME: 'Scout',
      SCRIBBLE_BOT_ALIASES: 'scout,helper',
      SCRIBBLE_DECISION_LOG_CHANNEL: 'decisions',
      SCRIBBLE_WIKI_GIT_AUTHOR_NAME: 'Scout Bot',
      SCRIBBLE_WIKI_GIT_AUTHOR_EMAIL: 'scout@example.com',
    });

    expect(tenantConfigToEnv(config)).toEqual({
      SCRIBBLE_ORG_NAME: 'Acme',
      SCRIBBLE_BOT_NAME: 'Scout',
      SCRIBBLE_BOT_ALIASES: 'scout,helper',
      SCRIBBLE_DECISION_LOG_CHANNEL: 'decisions',
      SCRIBBLE_WIKI_GIT_AUTHOR_NAME: 'Scout Bot',
      SCRIBBLE_WIKI_GIT_AUTHOR_EMAIL: 'scout@example.com',
    });
  });
});

describe('parseOptionalEnv', () => {
  it('treats unset, empty, and whitespace-only optional env values as unset', () => {
    expect(parseOptionalEnv({}, 'LINEAR_API_KEY')).toBeUndefined();
    expect(parseOptionalEnv({ LINEAR_API_KEY: '' }, 'LINEAR_API_KEY')).toBeUndefined();
    expect(parseOptionalEnv({ LINEAR_API_KEY: '   ' }, 'LINEAR_API_KEY')).toBeUndefined();
  });

  it('returns trimmed optional values', () => {
    expect(parseOptionalEnv({ LINEAR_API_KEY: ' lin_api_test ' }, 'LINEAR_API_KEY')).toBe('lin_api_test');
  });
});
```

- [ ] **Step 3: Run the parser test and confirm it fails**

Run:

```bash
npm test -- src/config/__tests__/tenantConfig.test.ts
```

Expected: FAIL because `src/config/tenantConfig.ts` does not exist.

- [ ] **Step 4: Implement tenant parser**

Create `src/config/tenantConfig.ts`:

```ts
import { isValidSlackChannelId } from '../utils/slackIds.js';

export interface TenantConfig {
  orgName: string;
  botName: string;
  botAliases: string[];
  effectiveAliases: string[];
  decisionLogChannel: string;
  wikiGitAuthorName: string;
  wikiGitAuthorEmail: string;
}

export const DEFAULT_TENANT_CONFIG: TenantConfig = {
  orgName: 'Prime Radiant',
  botName: 'Scribble',
  botAliases: ['scribble', 'scrib'],
  effectiveAliases: ['Scribble', 'scrib'],
  decisionLogChannel: 'decision-log',
  wikiGitAuthorName: 'Scribble Bot',
  wikiGitAuthorEmail: 'scribble-bot@invalid',
};

type Env = Record<string, string | undefined>;

function defaultedEnv(env: Env, key: string, fallback: string): string {
  const raw = env[key];
  if (raw === undefined) return fallback;
  const value = raw.trim();
  if (!value) {
    throw new Error(`${key} cannot be empty`);
  }
  return value;
}

export function parseOptionalEnv(env: Env, key: string): string | undefined {
  const raw = env[key];
  if (raw === undefined) return undefined;
  const value = raw.trim();
  return value || undefined;
}

function parseAliases(rawAliases: string): string[] {
  const aliases = rawAliases
    .split(',')
    .map(alias => alias.trim())
    .filter(Boolean);

  if (aliases.length === 0) {
    throw new Error('SCRIBBLE_BOT_ALIASES must include at least one alias');
  }

  return aliases;
}

const SLACK_CHANNEL_NAME = /^[a-z0-9][a-z0-9._-]{0,79}$/;

function validateDecisionLogChannel(value: string): string {
  const name = value.replace(/^#/, '');
  if (isValidSlackChannelId(value)) {
    return value;
  }

  if (SLACK_CHANNEL_NAME.test(name)) {
    return name;
  }

  throw new Error('SCRIBBLE_DECISION_LOG_CHANNEL must be a Slack channel ID or Slack channel name without spaces');
}

function dedupeAliases(values: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(value);
  }

  return deduped;
}

export function parseTenantConfig(env: Env = process.env): TenantConfig {
  const orgName = defaultedEnv(env, 'SCRIBBLE_ORG_NAME', DEFAULT_TENANT_CONFIG.orgName);
  const botName = defaultedEnv(env, 'SCRIBBLE_BOT_NAME', DEFAULT_TENANT_CONFIG.botName);
  const botAliases = parseAliases(
    defaultedEnv(env, 'SCRIBBLE_BOT_ALIASES', DEFAULT_TENANT_CONFIG.botAliases.join(','))
  );
  const decisionLogChannel = validateDecisionLogChannel(
    defaultedEnv(
      env,
      'SCRIBBLE_DECISION_LOG_CHANNEL',
      DEFAULT_TENANT_CONFIG.decisionLogChannel
    )
  );
  const wikiGitAuthorName = defaultedEnv(
    env,
    'SCRIBBLE_WIKI_GIT_AUTHOR_NAME',
    DEFAULT_TENANT_CONFIG.wikiGitAuthorName
  );
  const wikiGitAuthorEmail = defaultedEnv(
    env,
    'SCRIBBLE_WIKI_GIT_AUTHOR_EMAIL',
    DEFAULT_TENANT_CONFIG.wikiGitAuthorEmail
  );

  return {
    orgName,
    botName,
    botAliases,
    effectiveAliases: dedupeAliases([botName, ...botAliases]),
    decisionLogChannel,
    wikiGitAuthorName,
    wikiGitAuthorEmail,
  };
}

export function tenantConfigToEnv(config: TenantConfig): Record<string, string> {
  return {
    SCRIBBLE_ORG_NAME: config.orgName,
    SCRIBBLE_BOT_NAME: config.botName,
    SCRIBBLE_BOT_ALIASES: config.botAliases.join(','),
    SCRIBBLE_DECISION_LOG_CHANNEL: config.decisionLogChannel,
    SCRIBBLE_WIKI_GIT_AUTHOR_NAME: config.wikiGitAuthorName,
    SCRIBBLE_WIKI_GIT_AUTHOR_EMAIL: config.wikiGitAuthorEmail,
  };
}
```

The parser owns canonicalization: Slack channel IDs remain unchanged, and channel names are stored without a leading `#`. Display helpers may add `#` back for prompt/docs text, but downstream runtime code should not strip or normalize the value again.

- [ ] **Step 5: Thread tenant config into `loadConfig()`**

In `src/config/config.ts`, add the import:

```ts
import { parseTenantConfig, type TenantConfig } from './tenantConfig.js';
```

Add these fields to `Config`:

```ts
tenant: TenantConfig;
timezone: string;
```

Add this helper near `getRequiredEnv()`:

```ts
function getDefaultedEnv(key: string, fallback: string): string {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  const value = raw.trim();
  if (!value) {
    throw new Error(`${key} cannot be empty`);
  }
  return value;
}
```

Inside `loadConfig()`, parse tenant config and timezone before the return:

```ts
const tenant = parseTenantConfig();
const timezone = getDefaultedEnv('TZ', 'America/Los_Angeles');
```

Then include:

```ts
tenant,
timezone,
```

- [ ] **Step 6: Update `loadConfig()` tests**

In `src/config/__tests__/config.test.ts`, extend the "loads all fields with defaults" test:

```ts
delete process.env.TZ;
delete process.env.SCRIBBLE_ORG_NAME;
delete process.env.SCRIBBLE_BOT_NAME;
delete process.env.SCRIBBLE_BOT_ALIASES;
delete process.env.SCRIBBLE_DECISION_LOG_CHANNEL;
delete process.env.SCRIBBLE_WIKI_GIT_AUTHOR_NAME;
delete process.env.SCRIBBLE_WIKI_GIT_AUTHOR_EMAIL;
```

Add these expectations:

```ts
expect(config.timezone).toBe('America/Los_Angeles');
expect(config.tenant.orgName).toBe('Prime Radiant');
expect(config.tenant.botName).toBe('Scribble');
expect(config.tenant.effectiveAliases).toEqual(['Scribble', 'scrib']);
expect(config.tenant.decisionLogChannel).toBe('decision-log');
expect(config.tenant.wikiGitAuthorEmail).toBe('scribble-bot@invalid');
```

Add a new test:

```ts
it('loads custom tenant values and timezone', () => {
  process.env = {
    ...process.env,
    ...baseEnv,
    TZ: 'Etc/UTC',
    SCRIBBLE_ORG_NAME: 'Acme',
    SCRIBBLE_BOT_NAME: 'Scout',
    SCRIBBLE_BOT_ALIASES: 'scout,helper',
    SCRIBBLE_DECISION_LOG_CHANNEL: 'decisions',
    SCRIBBLE_WIKI_GIT_AUTHOR_NAME: 'Scout Bot',
    SCRIBBLE_WIKI_GIT_AUTHOR_EMAIL: 'scout@example.com',
  };

  const config = loadConfig();

  expect(config.timezone).toBe('Etc/UTC');
  expect(config.tenant).toMatchObject({
    orgName: 'Acme',
    botName: 'Scout',
    botAliases: ['scout', 'helper'],
    effectiveAliases: ['Scout', 'helper'],
    decisionLogChannel: 'decisions',
    wikiGitAuthorName: 'Scout Bot',
    wikiGitAuthorEmail: 'scout@example.com',
  });
});

it('rejects present-but-empty TZ', () => {
  process.env = { ...process.env, ...baseEnv, TZ: '   ' };

  expect(() => loadConfig()).toThrow('TZ cannot be empty');
});
```

- [ ] **Step 7: Verify WIKI_REPO remains required**

Open `src/config/wikiRepo.ts` and confirm it still contains:

```ts
export function requireWikiRepo(env: Record<string, string | undefined> = process.env): string {
  const repo = env.WIKI_REPO?.trim();
  if (!repo) {
    throw new Error('Missing required environment variable: WIKI_REPO');
  }
```

Do not add any fallback to `prime-radiant-inc/scribble-wiki`.

- [ ] **Step 8: Run config tests**

Run:

```bash
npm test -- src/config/__tests__/tenantConfig.test.ts src/config/__tests__/config.test.ts src/config/__tests__/wikiRepo.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit tenant parser slice**

Run:

```bash
git add src/config/tenantConfig.ts src/config/__tests__/tenantConfig.test.ts src/config/config.ts src/config/__tests__/config.test.ts src/config/wikiRepo.ts src/config/__tests__/wikiRepo.test.ts
git commit -m "PRI-1503 add Scribble tenant config parser"
```

---

## Task 2: Build Engagement From Tenant Aliases

**Files:**
- Create: `src/config/engagement.ts`
- Create: `src/config/__tests__/engagement.test.ts`
- Create: `src/utils/regex.ts`
- Create: `src/utils/__tests__/regex.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write engagement tests**

Create `src/config/__tests__/engagement.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildEngagementConfig } from '../engagement.js';
import type { TenantConfig } from '../tenantConfig.js';

function tenant(overrides: Partial<TenantConfig> = {}): TenantConfig {
  return {
    orgName: 'Acme',
    botName: 'Scout',
    botAliases: ['scout', 'helper'],
    effectiveAliases: ['Scout', 'helper'],
    decisionLogChannel: 'decisions',
    wikiGitAuthorName: 'Scout Bot',
    wikiGitAuthorEmail: 'scout@example.com',
    ...overrides,
  };
}

describe('buildEngagementConfig', () => {
  it('uses effective aliases for name mentions', () => {
    const config = buildEngagementConfig(tenant());

    expect(config.nameMentions).toEqual(['Scout', 'helper']);
    expect(config.trackActiveThreads).toBe(true);
    expect(config.threadTimeout).toBe(30 * 60 * 1000);
  });

  it('matches dismissal phrases with bot name and aliases', () => {
    const config = buildEngagementConfig(tenant());

    expect(config.dismissalPatterns.some(pattern => pattern.test('thanks Scout'))).toBe(true);
    expect(config.dismissalPatterns.some(pattern => pattern.test('got it, helper'))).toBe(true);
    expect(config.dismissalPatterns.some(pattern => pattern.test('Scout be quiet'))).toBe(true);
  });

  it('escapes alias regex metacharacters', () => {
    const config = buildEngagementConfig(tenant({
      botName: 'S.crib',
      botAliases: ['s.crib'],
      effectiveAliases: ['S.crib'],
    }));

    expect(config.dismissalPatterns.some(pattern => pattern.test('thanks S.crib'))).toBe(true);
    expect(config.dismissalPatterns.some(pattern => pattern.test('thanks Sxcrib'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the engagement test and confirm it fails**

Run:

```bash
npm test -- src/config/__tests__/engagement.test.ts
```

Expected: FAIL because `src/config/engagement.ts` and `src/utils/regex.ts` do not exist.

- [ ] **Step 3: Add shared regex helper**

Create `src/utils/regex.ts`:

```ts
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
```

Create `src/utils/__tests__/regex.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { escapeRegExp } from '../regex.js';

describe('escapeRegExp', () => {
  it('escapes regex syntax characters', () => {
    expect(escapeRegExp('S.crib+Bot')).toBe('S\\.crib\\+Bot');
  });
});
```

- [ ] **Step 4: Implement engagement helper**

Create `src/config/engagement.ts`:

```ts
import type { EngagementConfig } from '@primeradiant/bot-toolkit';
import type { TenantConfig } from './tenantConfig.js';
import { escapeRegExp } from '../utils/regex.js';

export function buildEngagementConfig(tenant: TenantConfig): EngagementConfig {
  const aliases = tenant.effectiveAliases.map(escapeRegExp).join('|');
  const addressedBot = `(?:${aliases})`;

  return {
    nameMentions: tenant.effectiveAliases,
    trackActiveThreads: true,
    dismissalPatterns: [
      new RegExp(`thanks,?\\s*${addressedBot}`, 'i'),
      new RegExp(`thank you,?\\s*${addressedBot}`, 'i'),
      new RegExp(`got it,?\\s*${addressedBot}`, 'i'),
      new RegExp(`${addressedBot}\\s+be quiet`, 'i'),
      /that's all/i,
      /never\s*mind/i,
      /dismiss/i,
      /go away/i,
    ],
    threadTimeout: 30 * 60 * 1000,
  };
}
```

- [ ] **Step 5: Replace hard-coded engagement config in `src/index.ts`**

In `src/index.ts`, remove the local `buildEngagementConfig()` function and remove `type EngagementConfig` from the bot-toolkit import.

Add:

```ts
import { buildEngagementConfig } from './config/engagement.js';
```

Change:

```ts
const engagementConfig = buildEngagementConfig();
```

to:

```ts
const engagementConfig = buildEngagementConfig(config.tenant);
```

- [ ] **Step 6: Run engagement and build checks**

Run:

```bash
npm test -- src/config/__tests__/engagement.test.ts src/utils/__tests__/regex.test.ts
npm run build
```

Expected: both PASS.

- [ ] **Step 7: Commit engagement slice**

Run:

```bash
git add src/config/engagement.ts src/config/__tests__/engagement.test.ts src/utils/regex.ts src/utils/__tests__/regex.test.ts src/index.ts
git commit -m "PRI-1503 configure Scribble engagement aliases"
```

---

## Task 3: Propagate Tenant Config To Generated MCP Config

**Files:**
- Modify: `src/config/instanceConfig.ts`
- Modify: `src/config/__tests__/instanceConfig.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write instance config tests**

In `src/config/__tests__/instanceConfig.test.ts`, import parser helpers:

```ts
import { parseTenantConfig } from '../tenantConfig.js';
```

Add this helper inside the describe block:

```ts
function tenant() {
  return parseTenantConfig({
    SCRIBBLE_ORG_NAME: 'Acme',
    SCRIBBLE_BOT_NAME: 'Scout',
    SCRIBBLE_BOT_ALIASES: 'scout,helper',
    SCRIBBLE_DECISION_LOG_CHANNEL: 'decisions',
    SCRIBBLE_WIKI_GIT_AUTHOR_NAME: 'Scout Bot',
    SCRIBBLE_WIKI_GIT_AUTHOR_EMAIL: 'scout@example.com',
  });
}
```

Add the blank-Linear test inside the existing describe block. Keep the existing `afterEach()` that restores `process.env = originalEnv`; do not move the test outside that cleanup boundary.

Update existing `createInstanceConfig(dataDir, '/app/dist/mcp.js')` calls to:

```ts
createInstanceConfig(dataDir, '/app/dist/mcp.js', tenant());
```

Add tests:

```ts
it('passes normalized tenant env to scribble-mcp', () => {
  createInstanceConfig(dataDir, '/app/dist/mcp.js', tenant());

  const instance = JSON.parse(fs.readFileSync(path.join(dataDir, 'config', 'instance.json'), 'utf-8'));

  expect(instance.mcps['scribble-mcp'].env).toMatchObject({
    DATA_DIRECTORY: dataDir,
    SCRIBBLE_ORG_NAME: 'Acme',
    SCRIBBLE_BOT_NAME: 'Scout',
    SCRIBBLE_BOT_ALIASES: 'scout,helper',
    SCRIBBLE_DECISION_LOG_CHANNEL: 'decisions',
    SCRIBBLE_WIKI_GIT_AUTHOR_NAME: 'Scout Bot',
    SCRIBBLE_WIKI_GIT_AUTHOR_EMAIL: 'scout@example.com',
  });
});

it('treats blank LINEAR_API_KEY as disabled and omits the secret', () => {
  process.env.LINEAR_API_KEY = '   ';

  createInstanceConfig(dataDir, '/app/dist/mcp.js', tenant());

  const instance = JSON.parse(fs.readFileSync(path.join(dataDir, 'config', 'instance.json'), 'utf-8'));
  const secrets = JSON.parse(fs.readFileSync(path.join(dataDir, 'config', 'secrets.json'), 'utf-8'));

  expect(instance.mcps.linear.enabled).toBe(false);
  expect(secrets.LINEAR_API_TOKEN).toBeUndefined();
});
```

- [ ] **Step 2: Run instance config test and confirm it fails**

Run:

```bash
npm test -- src/config/__tests__/instanceConfig.test.ts
```

Expected: FAIL because `createInstanceConfig()` still accepts two arguments and does not pass tenant env.

- [ ] **Step 3: Update `createInstanceConfig()` signature and env handling**

In `src/config/instanceConfig.ts`, add:

```ts
import { parseOptionalEnv, tenantConfigToEnv, type TenantConfig } from './tenantConfig.js';
```

Change the signature:

```ts
export function createInstanceConfig(dataDir: string, mcpPath: string, tenant: TenantConfig): string {
```

Before `instanceConfig`, add:

```ts
const linearApiKey = parseOptionalEnv(process.env, 'LINEAR_API_KEY');
```

Change `scribble-mcp.env` to:

```ts
env: {
  DATA_DIRECTORY: dataDir,
  ...tenantConfigToEnv(tenant),
},
```

Change Linear enabled to:

```ts
enabled: Boolean(linearApiKey),
```

Change the secrets write to:

```ts
if (linearApiKey) {
  secrets.LINEAR_API_TOKEN = linearApiKey;
}
```

- [ ] **Step 4: Pass parsed tenant config from `src/index.ts`**

Change:

```ts
const configDir = createInstanceConfig(config.dataDirectory, mcpPath);
```

to:

```ts
const configDir = createInstanceConfig(config.dataDirectory, mcpPath, config.tenant);
```

In `buildBotToolkitConfig()`, change:

```ts
timezone: process.env.TZ || 'America/Los_Angeles',
```

to:

```ts
timezone: scribbleConfig.timezone,
```

- [ ] **Step 5: Run instance config and build checks**

Run:

```bash
npm test -- src/config/__tests__/instanceConfig.test.ts
npm run build
```

Expected: both PASS.

- [ ] **Step 6: Commit MCP config propagation slice**

Run:

```bash
git add src/config/instanceConfig.ts src/config/__tests__/instanceConfig.test.ts src/index.ts
git commit -m "PRI-1503 propagate tenant config to MCP runtime"
```

---

## Task 4: Render Constitution From Tenant Config

**Files:**
- Modify: `src/constitution/base.ts`
- Modify: `src/constitution/manager.ts`
- Modify: `src/constitution/__tests__/manager.test.ts`
- Modify: `src/utils/slackIds.ts`
- Modify: `src/utils/__tests__/slackIds.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write constitution tests**

In `src/constitution/__tests__/manager.test.ts`, import parser:

```ts
import { parseTenantConfig } from '../../config/tenantConfig.js';
```

Add tests near the existing "should return base constitution" test:

```ts
it('renders configured identity and decision-log channel', () => {
  manager = new ConstitutionManager(TEST_DIR, {
    tenant: parseTenantConfig({
      SCRIBBLE_ORG_NAME: 'Acme',
      SCRIBBLE_BOT_NAME: 'Scout',
      SCRIBBLE_BOT_ALIASES: 'scout,helper',
      SCRIBBLE_DECISION_LOG_CHANNEL: 'decisions',
      SCRIBBLE_WIKI_GIT_AUTHOR_NAME: 'Scout Bot',
      SCRIBBLE_WIKI_GIT_AUTHOR_EMAIL: 'scout@example.com',
    }),
    integrations: { linearEnabled: false },
  });

  const constitution = manager.getFullConstitution();

  expect(constitution).toContain('You are Scout, a diligent colleague at Acme');
  expect(constitution).toContain('"Hey Scout"');
  expect(constitution).toContain('#decisions');
  expect(constitution).not.toContain('Prime Radiant');
});

it('omits Linear tool instructions when Linear is disabled', () => {
  manager = new ConstitutionManager(TEST_DIR, {
    tenant: parseTenantConfig({}),
    integrations: { linearEnabled: false },
  });

  const constitution = manager.getFullConstitution();

  expect(constitution).toContain('Linear is not configured in this runtime');
  expect(constitution).not.toContain('Linear operations are available through the `linear` MCP tool');
});

it('includes Linear tool instructions when Linear is enabled', () => {
  manager = new ConstitutionManager(TEST_DIR, {
    tenant: parseTenantConfig({}),
    integrations: { linearEnabled: true },
  });

  expect(manager.getFullConstitution()).toContain('Linear operations are available through the `linear` MCP tool');
});

it('rejects learned behavior that tries to override the configured bot identity', () => {
  manager = new ConstitutionManager(TEST_DIR, {
    tenant: parseTenantConfig({
      SCRIBBLE_BOT_NAME: 'Scout',
      SCRIBBLE_BOT_ALIASES: 'scout,helper',
    }),
  });

  expect(() => manager.addLearnedBehavior('Stop being Scout', 'U123')).toThrow(/immutable/i);
});
```

- [ ] **Step 2: Run constitution test and confirm it fails**

Run:

```bash
npm test -- src/constitution/__tests__/manager.test.ts
```

Expected: FAIL because `ConstitutionManager` does not accept options yet.

- [ ] **Step 3: Add shared Slack channel label helper**

In `src/utils/slackIds.ts`, add:

```ts
export function formatSlackChannelLabel(value: string): string {
  return value.startsWith('#') || isValidSlackChannelId(value)
    ? value
    : `#${value}`;
}
```

In `src/utils/__tests__/slackIds.test.ts`, update the import to include the new helper:

```ts
import { formatSlackChannelLabel, isValidSlackChannelId, isValidSlackThreadTs } from '../slackIds.js';
```

Add:

```ts
it('formats configured channel names for prompt display', () => {
  expect(formatSlackChannelLabel('decision-log')).toBe('#decision-log');
  expect(formatSlackChannelLabel('#decisions')).toBe('#decisions');
  expect(formatSlackChannelLabel('C0A93A7H820')).toBe('C0A93A7H820');
});
```

- [ ] **Step 4: Render base constitution dynamically**

In `src/constitution/base.ts`, replace:

```ts
export const BASE_CONSTITUTION = `# Scribble - Core Constitution
```

with imports and a renderer:

```ts
import type { TenantConfig } from '../config/tenantConfig.js';
import { formatSlackChannelLabel } from '../utils/slackIds.js';
import { escapeRegExp } from '../utils/regex.js';

export interface ConstitutionIntegrations {
  linearEnabled: boolean;
}

function linearSection(enabled: boolean): string {
  if (enabled) {
    return `### Linear (via StreamLinear MCP)
- Linear operations are available through the \`linear\` MCP tool with actions: search, get, update, comment, create, graphql, help
- Search before creating new tickets
- Always confirm before creating: "Want me to create a ticket for that?"
- Include relevant context in ticket descriptions
- When you create or update a ticket, always respond (directed_at_me=true) to confirm what you did, including the ticket identifier and link`;
  }

  return `### Linear
- Linear is not configured in this runtime
- Do not claim Linear tool availability
- If someone asks for ticket help, offer to draft ticket text or ask an operator to configure Linear`;
}

export function renderBaseConstitution(
  tenant: TenantConfig,
  integrations: ConstitutionIntegrations
): string {
  const decisionLog = formatSlackChannelLabel(tenant.decisionLogChannel);

  return `# ${tenant.botName} - Core Constitution
```

Then update hard-coded identity lines inside the template:

```md
You are ${tenant.botName}, a diligent colleague at ${tenant.orgName}. You are NOT an assistant, chatbot, or AI helper. You are a team member who happens to have perfect memory and is in every channel.
```

Update direct-name examples:

```md
- Your name used directly in a sentence ("${tenant.botName}, can you...", "Hey ${tenant.botName}")
```

Update dismissal:

```md
- When dismissed ("thanks ${tenant.botName}", "${tenant.botName} be quiet", "got it"), acknowledge briefly (emoji or nothing) and stop responding
```

Update decision-log wording:

```md
- Never read from or respond to messages in ${decisionLog} - it is a write-only audit trail
```

Replace the fixed Linear section with:

```ts
${linearSection(integrations.linearEnabled)}
```

Close the renderer with:

```ts
`;
}
```

Replace the fixed `IMMUTABLE_PATTERNS` export with a tenant-aware builder so custom bot names are protected by the same invariant checks. Preserve every existing immutable pattern unless the implementation notes an intentional removal with a test update; the current existing patterns are:

```ts
/respond to (every|all) message/i
/always respond/i
/never stay silent/i
/share (everything|all information)/i
/create tickets? (without|automatically)/i
/ignore (safety|privacy)/i
```

Use:

```ts
export function buildImmutablePatterns(tenant: TenantConfig): RegExp[] {
  const identityNames = tenant.effectiveAliases.map(escapeRegExp).join('|');
  const identityPattern = identityNames
    ? new RegExp(`stop being (?:a colleague|${identityNames})`, 'i')
    : /stop being a colleague/i;

  return [
    /respond to (every|all) message/i,
    /always respond/i,
    /never stay silent/i,
    /share (everything|all information)/i,
    /create tickets? (without|automatically)/i,
    /ignore (safety|privacy)/i,
    identityPattern,
    /forget (everything|all|your constitution|your instructions)/i,
    /ignore (your constitution|all previous instructions)/i,
  ];
}
```

- [ ] **Step 5: Scan and replace all stale constitution literals**

Before running tests, scan the rendered template body:

```bash
rg -n "Prime Radiant|Scribble|@scribble|scrib|decision-log" src/constitution/base.ts
```

Expected intentional matches after the edit:

- `Scribble` and `scribble` may remain in defaults and tests; they must not remain as hard-coded text inside the rendered constitution body or immutable identity checks where tenant config should apply.
- `Prime Radiant` must not remain in the rendered constitution body.
- `#decision-log` or `decision-log` must not remain in the rendered constitution body; use `${decisionLog}`.
- Immutable identity checks must be produced by `buildImmutablePatterns(tenant)` so a deployment configured as `Scout` rejects "stop being Scout".

Update each stale prompt literal found by the scan. In the current template, this includes the identity sentence, direct-name examples, reference examples, the "Determining if you means Scribble" heading, dismissal examples, and the decision-log line.

- [ ] **Step 6: Update `ConstitutionManager` options**

In `src/constitution/manager.ts`, replace the base import:

```ts
import { BASE_CONSTITUTION, IMMUTABLE_PATTERNS } from './base.js';
```

with:

```ts
import { buildImmutablePatterns, renderBaseConstitution, type ConstitutionIntegrations } from './base.js';
import { DEFAULT_TENANT_CONFIG, type TenantConfig } from '../config/tenantConfig.js';
```

Add:

```ts
export interface ConstitutionManagerOptions {
  tenant?: TenantConfig;
  integrations?: ConstitutionIntegrations;
}
```

Add private fields:

```ts
private tenant: TenantConfig;
private integrations: ConstitutionIntegrations;
```

Change constructor:

```ts
constructor(wikiDir: string, options: ConstitutionManagerOptions = {}) {
  this.wikiDir = wikiDir;
  this.tenant = options.tenant ?? DEFAULT_TENANT_CONFIG;
  this.integrations = options.integrations ?? { linearEnabled: false };
  this.learnedFile = path.join(wikiDir, '_scribble', 'constitution-learned.json');
  this.logFile = path.join(wikiDir, '_scribble', 'constitution-log.json');
  this.channelInstructionsFile = path.join(wikiDir, '_scribble', 'channel-instructions.json');
  this.ensureFiles();
}
```

Change `getFullConstitution()`:

```ts
return renderBaseConstitution(this.tenant, this.integrations) + learnedSection;
```

Change learned-behavior invariant checks from the static array to the tenant-aware builder:

```ts
for (const pattern of buildImmutablePatterns(this.tenant)) {
  if (pattern.test(behavior)) {
    throw new Error('Cannot modify immutable constitution principles');
  }
}
```

- [ ] **Step 7: Pass constitution options from main**

In `src/index.ts`, import:

```ts
import { parseOptionalEnv } from './config/tenantConfig.js';
```

Change:

```ts
const constitutionManager = new ConstitutionManager(path.join(config.dataDirectory, 'wiki'));
```

to:

```ts
const constitutionManager = new ConstitutionManager(path.join(config.dataDirectory, 'wiki'), {
  tenant: config.tenant,
  integrations: { linearEnabled: Boolean(parseOptionalEnv(process.env, 'LINEAR_API_KEY')) },
});
```

- [ ] **Step 8: Run constitution and integration tests**

Run:

```bash
npm test -- src/constitution/__tests__/manager.test.ts src/utils/__tests__/slackIds.test.ts src/__tests__/integration.test.ts
npm run build
```

Expected: PASS.

- [ ] **Step 9: Commit constitution slice**

Run:

```bash
git add src/constitution/base.ts src/constitution/manager.ts src/constitution/__tests__/manager.test.ts src/utils/slackIds.ts src/utils/__tests__/slackIds.test.ts src/index.ts
git commit -m "PRI-1503 render Scribble constitution from tenant config"
```

---

## Task 5: Configure MCP Tool Guidance And Wiki Author

**Files:**
- Create: `src/mcp/toolDescriptions.ts`
- Create: `src/mcp/__tests__/toolDescriptions.test.ts`
- Modify: `src/mcp/index.ts`
- Modify: `src/wiki/wikiManager.ts`
- Modify: `src/wiki/__tests__/wikiManager.test.ts`

- [ ] **Step 1: Write MCP description tests**

Create `src/mcp/__tests__/toolDescriptions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildLeaveChannelDescription, buildLogDecisionDescription, buildRespondDirectedAtMeDescription } from '../toolDescriptions.js';
import { parseTenantConfig } from '../../config/tenantConfig.js';

const tenant = parseTenantConfig({
  SCRIBBLE_ORG_NAME: 'Acme',
  SCRIBBLE_BOT_NAME: 'Scout',
  SCRIBBLE_BOT_ALIASES: 'scout,helper',
  SCRIBBLE_DECISION_LOG_CHANNEL: 'decisions',
  SCRIBBLE_WIKI_GIT_AUTHOR_NAME: 'Scout Bot',
  SCRIBBLE_WIKI_GIT_AUTHOR_EMAIL: 'scout@example.com',
});

describe('MCP tool descriptions', () => {
  it('uses configured bot identity in respond guidance', () => {
    const text = buildRespondDirectedAtMeDescription(tenant);

    expect(text).toContain('Scout/helper');
    expect(text).toContain('"Scout, I want it to work for you"');
    expect(text).not.toContain('Scribble/scrib');
  });

  it('uses configured decision-log channel in log_decision guidance', () => {
    expect(buildLogDecisionDescription(tenant)).toContain('#decisions');
  });

  it('does not claim leave_channel enforces a privacy boundary', () => {
    const text = buildLeaveChannelDescription(tenant);

    expect(text).toContain('Request');
    expect(text).toContain('Scout');
    expect(text).not.toContain('Scribble');
    expect(text).not.toContain('stop monitoring');
  });
});
```

- [ ] **Step 2: Write wiki author test**

In `src/wiki/__tests__/wikiManager.test.ts`, add:

```ts
it('configures git author from constructor options during initialize', async () => {
  const initialGit = {};
  const globalGit = { addConfig: vi.fn().mockResolvedValue('') };
  const repoGit = {
    pull: vi.fn().mockResolvedValue(''),
    addConfig: vi.fn().mockResolvedValue(''),
  };
  vi.spyOn(WikiManager.prototype as any, 'createGit')
    .mockReturnValueOnce(initialGit)
    .mockReturnValueOnce(globalGit)
    .mockReturnValueOnce(repoGit);

  const manager = new WikiManager(tempDir, 'test/repo', undefined, {
    gitAuthorName: 'Scout Bot',
    gitAuthorEmail: 'scout@example.com',
  });

  await manager.initialize();

  expect(globalGit.addConfig).toHaveBeenCalledWith('safe.directory', tempDir, false, 'global');
  expect(repoGit.pull).toHaveBeenCalled();
  expect(repoGit.addConfig).toHaveBeenCalledWith('user.email', 'scout@example.com', false, 'local');
  expect(repoGit.addConfig).toHaveBeenCalledWith('user.name', 'Scout Bot', false, 'local');
});
```

Also add `vi` to the import:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
```

- [ ] **Step 3: Run focused tests and confirm they fail**

Run:

```bash
npm test -- src/mcp/__tests__/toolDescriptions.test.ts src/wiki/__tests__/wikiManager.test.ts
```

Expected: FAIL because the new MCP helper and configurable wiki author do not exist.

- [ ] **Step 4: Implement MCP description builders**

Create `src/mcp/toolDescriptions.ts`:

```ts
import type { TenantConfig } from '../config/tenantConfig.js';
import { formatSlackChannelLabel } from '../utils/slackIds.js';

function aliasDisplay(tenant: TenantConfig): string {
  return tenant.effectiveAliases.join('/');
}

export function buildRespondDirectedAtMeDescription(tenant: TenantConfig): string {
  const aliases = aliasDisplay(tenant);

  return `Your persona is QUIET and COMPETENT. You do not engage in banter, small talk, or respond just for the sake of human connection. You speak only when you have something substantive to contribute.

Set to true ONLY if:
1. Message contains an explicit Slack @mention of you with a question or request
2. Message explicitly addresses ${tenant.botName} by name (${aliases}) with a task or question
3. Someone states something factually incorrect that you can correct with a specific source. You MUST include a hyperlink (Slack message, Linear ticket, or wiki page) to the contradicting evidence. No link = no response. This is ONLY for direct factual contradictions, NOT for adding context, offering help, or sharing related information.

CRITICAL - Pronoun disambiguation:
- Pronouns like "you", "your", "yourself" do NOT count as addressing you
- In conversations between multiple people, assume "you" refers to the OTHER HUMAN, not to you
- Unless your name (${aliases}) or a Slack @mention of you appears in the message, you are NOT being addressed
- "I want it to work for you" between two humans = NOT addressing you
- "${tenant.botName}, I want it to work for you" = addressing you

CRITICAL - Message formatting:
- Messages include timestamps like [Name | Feb 9, 2:30 PM]. Use these to understand conversational flow and recency.
- Characters like ">", "$", "#", "%" at the start of a message are terminal prompt characters, not indicators that someone is addressing you. These appear when people paste terminal output or write example commands.
- Second-person language ("I want to deploy", "we need to build") in a channel conversation is almost never directed at you unless your name or @mention appears.

Set to false for:
- Greetings, thanks, or social pleasantries
- Casual conversation between others, even if they use "you"
- Messages where you'd just be acknowledging or agreeing
- Messages containing pasted terminal output, example commands, or prompt text
- Anything where staying silent is reasonable

You can use tools even when directed_at_me is false. Taking action silently is often better than announcing what you're doing. A checkmark reaction will indicate you acted.`;
}

export function buildLogDecisionDescription(tenant: TenantConfig): string {
  return `Log a business decision to ${formatSlackChannelLabel(tenant.decisionLogChannel)} with a link back to the source message`;
}

export function buildLeaveChannelDescription(tenant: TenantConfig): string {
  return `Request that an operator remove ${tenant.botName} from a Slack channel`;
}
```

- [ ] **Step 5: Use tenant config in `src/mcp/index.ts`**

Add imports:

```ts
import { parseOptionalEnv, parseTenantConfig } from '../config/tenantConfig.js';
import {
  buildLeaveChannelDescription,
  buildLogDecisionDescription,
  buildRespondDirectedAtMeDescription,
} from './toolDescriptions.js';
```

Add after env constants:

```ts
const tenantConfig = parseTenantConfig(process.env);
const linearEnabled = Boolean(parseOptionalEnv(process.env, 'LINEAR_API_KEY'));
```

Change managers:

```ts
const wikiManager = new WikiManager(`${DATA_DIR}/wiki`, WIKI_REPO, GITHUB_TOKEN, {
  gitAuthorName: tenantConfig.wikiGitAuthorName,
  gitAuthorEmail: tenantConfig.wikiGitAuthorEmail,
});
const constitutionManager = new ConstitutionManager(`${DATA_DIR}/wiki`, {
  tenant: tenantConfig,
  integrations: { linearEnabled },
});
```

Change `RespondParams.directed_at_me`:

```ts
directed_at_me: z.boolean().describe(buildRespondDirectedAtMeDescription(tenantConfig)),
```

Change `log_decision` description:

```ts
buildLogDecisionDescription(tenantConfig)
```

Change `leave_channel` description:

```ts
buildLeaveChannelDescription(tenantConfig)
```

Change the leave handler text:

```ts
text: `Request to leave channel ${channel_id} noted. An operator must remove the app from the channel or implement channel-leave handling.`,
```

- [ ] **Step 6: Configure wiki git author**

In `src/wiki/wikiManager.ts`, add:

```ts
import { DEFAULT_TENANT_CONFIG } from '../config/tenantConfig.js';

export interface WikiManagerOptions {
  gitAuthorName?: string;
  gitAuthorEmail?: string;
}
```

Add fields:

```ts
private gitAuthorName: string;
private gitAuthorEmail: string;
```

Change constructor:

```ts
constructor(localPath: string, repo: string, githubToken?: string, options: WikiManagerOptions = {}) {
  this.localPath = path.resolve(localPath);
  this.githubToken = githubToken;
  this.repoUrl = `https://github.com/${repo}.git`;
  this.gitAuthorName = options.gitAuthorName ?? DEFAULT_TENANT_CONFIG.wikiGitAuthorName;
  this.gitAuthorEmail = options.gitAuthorEmail ?? DEFAULT_TENANT_CONFIG.wikiGitAuthorEmail;

  this.git = this.createGit();
}
```

Add:

```ts
private async configureGitAuthor(): Promise<void> {
  await this.git.addConfig('user.email', this.gitAuthorEmail, false, 'local');
  await this.git.addConfig('user.name', this.gitAuthorName, false, 'local');
}
```

Replace the two hard-coded `addConfig()` calls in `initialize()` with:

```ts
await this.configureGitAuthor();
```

- [ ] **Step 7: Run focused tests and MCP build**

Run:

```bash
npm test -- src/mcp/__tests__/toolDescriptions.test.ts src/wiki/__tests__/wikiManager.test.ts
npm run build:mcp
```

Expected: PASS.

- [ ] **Step 8: Commit MCP and wiki author slice**

Run:

```bash
git add src/mcp/toolDescriptions.ts src/mcp/__tests__/toolDescriptions.test.ts src/mcp/index.ts src/wiki/wikiManager.ts src/wiki/__tests__/wikiManager.test.ts
git commit -m "PRI-1503 configure MCP guidance and wiki author"
```

---

## Task 6: Configure Decision-Log Resolution

**Files:**
- Modify: `src/orchestrator/scribbleOrchestrator.ts`
- Modify: `src/orchestrator/__tests__/scribbleOrchestrator.test.ts`
- Modify: `src/index.ts`
- Verify: `src/utils/slackIds.ts`

- [ ] **Step 1: Add decision-log tests**

In `src/orchestrator/__tests__/scribbleOrchestrator.test.ts`, update `ScribbleOrchestrator` construction helpers to pass:

```ts
decisionLogChannel: 'decision-log',
```

Import the tenant parser for canonical channel-name coverage:

```ts
import { parseTenantConfig } from '../../config/tenantConfig.js';
```

Add tests near the existing decision-log tests:

```ts
it('posts decisions to configured public channel name', async () => {
  const { mockDatabase, mockConversationLogger, mockConstitutionManager, mockResponder, mockSlackClient } = createMocks();
  const { fn: sendMessage, calls } = createMockSendMessage();
  mockSlackClient.conversations.list.mockResolvedValue({
    channels: [{ id: 'C_DECISIONS', name: 'decisions' }],
  });
  mockDatabase.getThreadSession.mockReturnValue({ session_id: 'sess_thread', compaction_count: 0 });

  const orchestrator = new ScribbleOrchestrator({
    database: mockDatabase as any,
    sessionManager: { sendMessage } as any,
    conversationLogger: mockConversationLogger as any,
    constitutionManager: mockConstitutionManager as any,
    dataDir: '/tmp/test',
    slackClient: mockSlackClient,
    decisionLogChannel: 'decisions',
  });

  const handlePromise = orchestrator.handleMessage(makeThreadMessage(), mockResponder as any);
  await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));

  await calls[0].callbacks.onToolUse('log_decision', { decision: 'Use Docker Compose', tags: ['engineering'] });
  await simulateRespondAndResolve(calls[0], { directed_at_me: false, reason: 'Logged decision' });
  await handlePromise;

  expect(mockSlackClient.chat.postMessage).toHaveBeenCalledWith(expect.objectContaining({
    channel: 'C_DECISIONS',
  }));
});

it('finds configured public channel names across Slack pagination', async () => {
  const { mockDatabase, mockConversationLogger, mockConstitutionManager, mockResponder, mockSlackClient } = createMocks();
  const { fn: sendMessage, calls } = createMockSendMessage();
  mockSlackClient.conversations.list
    .mockResolvedValueOnce({
      channels: [{ id: 'C_OTHER', name: 'other' }],
      response_metadata: { next_cursor: 'page-2' },
    })
    .mockResolvedValueOnce({
      channels: [{ id: 'C_DECISIONS', name: 'decisions' }],
      response_metadata: { next_cursor: '' },
    });
  mockDatabase.getThreadSession.mockReturnValue({ session_id: 'sess_thread', compaction_count: 0 });

  const orchestrator = new ScribbleOrchestrator({
    database: mockDatabase as any,
    sessionManager: { sendMessage } as any,
    conversationLogger: mockConversationLogger as any,
    constitutionManager: mockConstitutionManager as any,
    dataDir: '/tmp/test',
    slackClient: mockSlackClient,
    decisionLogChannel: 'decisions',
  });

  const handlePromise = orchestrator.handleMessage(makeThreadMessage(), mockResponder as any);
  await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));

  await calls[0].callbacks.onToolUse('log_decision', { decision: 'Use paginated lookup', tags: ['engineering'] });
  await simulateRespondAndResolve(calls[0], { directed_at_me: false, reason: 'Logged decision' });
  await handlePromise;

  expect(mockSlackClient.conversations.list).toHaveBeenNthCalledWith(1, {
    types: 'public_channel',
    limit: 200,
  });
  expect(mockSlackClient.conversations.list).toHaveBeenNthCalledWith(2, {
    types: 'public_channel',
    limit: 200,
    cursor: 'page-2',
  });
  expect(mockSlackClient.chat.postMessage).toHaveBeenCalledWith(expect.objectContaining({
    channel: 'C_DECISIONS',
  }));
});

it('uses configured decision-log channel ID without channel-list lookup', async () => {
  const { mockDatabase, mockConversationLogger, mockConstitutionManager, mockResponder, mockSlackClient } = createMocks();
  const { fn: sendMessage, calls } = createMockSendMessage();
  mockDatabase.getThreadSession.mockReturnValue({ session_id: 'sess_thread', compaction_count: 0 });

  const orchestrator = new ScribbleOrchestrator({
    database: mockDatabase as any,
    sessionManager: { sendMessage } as any,
    conversationLogger: mockConversationLogger as any,
    constitutionManager: mockConstitutionManager as any,
    dataDir: '/tmp/test',
    slackClient: mockSlackClient,
    decisionLogChannel: 'C0A93A7H820',
  });

  const handlePromise = orchestrator.handleMessage(makeThreadMessage(), mockResponder as any);
  await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));

  await calls[0].callbacks.onToolUse('log_decision', { decision: 'Use channel IDs for private logs', tags: ['ops'] });
  await simulateRespondAndResolve(calls[0], { directed_at_me: false, reason: 'Logged decision' });
  await handlePromise;

  expect(mockSlackClient.conversations.list).not.toHaveBeenCalled();
  expect(mockSlackClient.chat.postMessage).toHaveBeenCalledWith(expect.objectContaining({
    channel: 'C0A93A7H820',
  }));
});

it('uses parser-canonicalized decision-log names with leading hashes', async () => {
  const { mockDatabase, mockConversationLogger, mockConstitutionManager, mockResponder, mockSlackClient } = createMocks();
  const { fn: sendMessage, calls } = createMockSendMessage();
  mockSlackClient.conversations.list.mockResolvedValue({
    channels: [{ id: 'C_DECISIONS', name: 'decisions' }],
  });
  mockDatabase.getThreadSession.mockReturnValue({ session_id: 'sess_thread', compaction_count: 0 });

  const orchestrator = new ScribbleOrchestrator({
    database: mockDatabase as any,
    sessionManager: { sendMessage } as any,
    conversationLogger: mockConversationLogger as any,
    constitutionManager: mockConstitutionManager as any,
    dataDir: '/tmp/test',
    slackClient: mockSlackClient,
    decisionLogChannel: parseTenantConfig({ SCRIBBLE_DECISION_LOG_CHANNEL: '#decisions' }).decisionLogChannel,
  });

  const handlePromise = orchestrator.handleMessage(makeThreadMessage(), mockResponder as any);
  await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));

  await calls[0].callbacks.onToolUse('log_decision', { decision: 'Normalize names', tags: ['ops'] });
  await simulateRespondAndResolve(calls[0], { directed_at_me: false, reason: 'Logged decision' });
  await handlePromise;

  expect(mockSlackClient.chat.postMessage).toHaveBeenCalledWith(expect.objectContaining({
    channel: 'C_DECISIONS',
  }));
});

it('retries decision-log lookup after the miss TTL expires', async () => {
  const { mockDatabase, mockConversationLogger, mockConstitutionManager, mockResponder, mockSlackClient } = createMocks();
  const { fn: sendMessage, calls } = createMockSendMessage();
  const dateNow = vi.spyOn(Date, 'now').mockReturnValue(1_000);
  mockSlackClient.conversations.list
    .mockResolvedValueOnce({ channels: [] })
    .mockResolvedValueOnce({ channels: [{ id: 'C_DECISIONS', name: 'decisions' }] });
  mockDatabase.getThreadSession.mockReturnValue({ session_id: 'sess_thread', compaction_count: 0 });

  const orchestrator = new ScribbleOrchestrator({
    database: mockDatabase as any,
    sessionManager: { sendMessage } as any,
    conversationLogger: mockConversationLogger as any,
    constitutionManager: mockConstitutionManager as any,
    dataDir: '/tmp/test',
    slackClient: mockSlackClient,
    decisionLogChannel: 'decisions',
  });

  const firstHandle = orchestrator.handleMessage(
    makeThreadMessage({ messageId: '1772816645.111111' }),
    mockResponder as any
  );
  await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));
  await calls[0].callbacks.onToolUse('log_decision', { decision: 'Retry after miss', tags: ['ops'] });
  await simulateRespondAndResolve(calls[0], { directed_at_me: false, reason: 'Logged decision' });
  await firstHandle;

  expect(mockSlackClient.conversations.list).toHaveBeenCalledTimes(1);
  dateNow.mockReturnValue(1_000 + (5 * 60 * 1000) + 1);

  const secondHandle = orchestrator.handleMessage(
    makeThreadMessage({ messageId: '1772816645.222222' }),
    mockResponder as any
  );
  await vi.waitFor(() => expect(calls.length).toBeGreaterThan(1));
  await calls[1].callbacks.onToolUse('log_decision', { decision: 'Retry after miss', tags: ['ops'] });
  await simulateRespondAndResolve(calls[1], { directed_at_me: false, reason: 'Logged decision' });
  await secondHandle;

  expect(mockSlackClient.conversations.list).toHaveBeenCalledTimes(2);
  expect(mockSlackClient.chat.postMessage).toHaveBeenCalledWith(expect.objectContaining({
    channel: 'C_DECISIONS',
  }));

  dateNow.mockRestore();
});
```

- [ ] **Step 2: Run orchestrator tests and confirm failure**

Run:

```bash
npm test -- src/orchestrator/__tests__/scribbleOrchestrator.test.ts
```

Expected: FAIL because the orchestrator config lacks `decisionLogChannel`.

- [ ] **Step 3: Implement configured channel resolution**

Confirm `src/utils/slackIds.ts` already exports `isValidSlackChannelId`. Reuse that existing helper; do not add a second Slack channel ID regex in the orchestrator.

In `src/orchestrator/scribbleOrchestrator.ts`, import:

```ts
import { isValidSlackChannelId } from '../utils/slackIds.js';
```

Add to `ScribbleOrchestratorConfig`:

```ts
decisionLogChannel: string;
```

Replace:

```ts
private decisionLogChannelId: string | null | undefined;
```

with:

```ts
private decisionLogChannel: string;
private resolvedDecisionLogChannelId: string | undefined;
private decisionLogMissUntilMs = 0;
```

In the constructor, add:

```ts
this.decisionLogChannel = config.decisionLogChannel.trim();
```

Add near the other module-level constants:

```ts
const DECISION_LOG_MISS_TTL_MS = 5 * 60 * 1000;
```

Replace `resolveDecisionLogChannel()` with:

```ts
private async resolveDecisionLogChannel(): Promise<string | null> {
  if (isValidSlackChannelId(this.decisionLogChannel)) {
    return this.decisionLogChannel;
  }

  if (this.resolvedDecisionLogChannelId) {
    return this.resolvedDecisionLogChannelId;
  }

  const now = Date.now();
  if (now < this.decisionLogMissUntilMs) {
    return null;
  }

  try {
    let cursor: string | undefined;
    do {
      const result = await this.slackClient.conversations.list({
        types: 'public_channel',
        limit: 200,
        ...(cursor ? { cursor } : {}),
      });
      const channel = result.channels?.find((c: { name?: string }) => c.name === this.decisionLogChannel);
      if (channel?.id) {
        this.resolvedDecisionLogChannelId = channel.id;
        this.decisionLogMissUntilMs = 0;
        return channel.id;
      }
      cursor = result.response_metadata?.next_cursor || undefined;
    } while (cursor);

    logger.warn('Could not find configured decision-log channel', {
      decisionLogChannel: this.decisionLogChannel,
    });
    this.decisionLogMissUntilMs = now + DECISION_LOG_MISS_TTL_MS;
    return null;
  } catch (error) {
    logger.error('Failed to resolve configured decision-log channel', {
      error,
      decisionLogChannel: this.decisionLogChannel,
    });
    this.decisionLogMissUntilMs = now + DECISION_LOG_MISS_TTL_MS;
    return null;
  }
}
```

Add an adjacent test that performs two decision logs inside the five-minute miss TTL, keeps `Date.now()` fixed, and expects `mockSlackClient.conversations.list` to be called once with no post to the decision-log channel.

Change decision-log error logging to avoid hard-coded channel text:

```ts
logger.error('Failed to post decision to configured decision-log channel', {
  error,
  decisionLength: decision.decision.length,
  tagCount: decision.tags.length,
  decisionLogChannel: this.decisionLogChannel,
});
```

- [ ] **Step 4: Pass configured channel from `src/index.ts`**

In `new ScribbleOrchestrator({ ... })`, add:

```ts
decisionLogChannel: config.tenant.decisionLogChannel,
```

- [ ] **Step 5: Run orchestrator and build checks**

Run:

```bash
npm test -- src/orchestrator/__tests__/scribbleOrchestrator.test.ts
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit decision-log slice**

Run:

```bash
git add src/orchestrator/scribbleOrchestrator.ts src/orchestrator/__tests__/scribbleOrchestrator.test.ts src/index.ts
git commit -m "PRI-1503 configure decision-log channel resolution"
```

---

## Task 7: Add Docker Compose And External Install Docs

**Files:**
- Create: `docs/bridge-refs.json`
- Create: `scripts/check-bridge-refs.mjs`
- Create: `docker-compose.yml`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `Dockerfile`

- [ ] **Step 1: Add bridge refs metadata and check script**

Create `docs/bridge-refs.json`:

```json
{
  "botToolkit": {
    "path": "../bot-toolkit",
    "commit": "14805edb011a739160e0d60ccd55c7a13707c06a",
    "packageName": "@primeradiant/bot-toolkit",
    "packageVersion": "0.1.0",
    "lockfileIntegrity": "sha512-7Ku0muiNjHVAbT+fpmsUJ2xWtZ4lVi2O9qCH+pqKMQIrkMt0PJDsrB3nlxIK6U7PU5QpyRda1bxnyykiwXK1Zg=="
  },
  "streamlinear": {
    "path": "../../streamlinear",
    "commit": "ee5982c9b35ee94e0be9d27f43cdcc8902a40bca"
  }
}
```

Create `scripts/check-bridge-refs.mjs`:

```js
#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const refs = JSON.parse(readFileSync(join(repoRoot, 'docs/bridge-refs.json'), 'utf8'));
const lockfile = JSON.parse(readFileSync(join(repoRoot, 'package-lock.json'), 'utf8'));
const botToolkit = lockfile.packages?.['node_modules/@primeradiant/bot-toolkit'];

if (!botToolkit?.integrity) {
  throw new Error('Missing @primeradiant/bot-toolkit integrity in package-lock.json');
}

if (botToolkit.integrity !== refs.botToolkit.lockfileIntegrity) {
  throw new Error(`docs/bridge-refs.json botToolkit.lockfileIntegrity does not match package-lock.json: ${refs.botToolkit.lockfileIntegrity} !== ${botToolkit.integrity}`);
}

for (const [name, entry] of Object.entries({ botToolkit: refs.botToolkit, streamlinear: refs.streamlinear })) {
  const checkoutPath = resolve(repoRoot, entry.path);
  if (!existsSync(checkoutPath)) {
    console.warn(`Skipping ${name} SHA check; checkout not found at ${entry.path}. Docker bridge smoke remains required before release.`);
    continue;
  }

  const actual = execFileSync('git', ['-C', checkoutPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (actual !== entry.commit) {
    throw new Error(`${name} checkout at ${entry.path} is ${actual}, expected ${entry.commit}`);
  }
}

console.log('Bridge refs match package-lock.json and available sibling checkouts');
```

Until streamlinear is published with package-lock integrity, treat this script's streamlinear check as a local sibling commit guard only. Do not skip the Task 9 Docker bridge smoke; that is the release gate that proves the named streamlinear context actually bundles into `/app/lib/streamlinear-mcp.js`.

- [ ] **Step 2: Add Docker Compose file**

Create `docker-compose.yml`:

```yaml
services:
  scribble:
    image: scribble:local
    build:
      context: .
      dockerfile: Dockerfile
      additional_contexts:
        bot-toolkit: ../bot-toolkit
        streamlinear: ../../streamlinear
    env_file:
      - .env
    environment:
      NODE_ENV: production
      DATA_DIRECTORY: /data
    volumes:
      - ./data:/data
    restart: unless-stopped
    healthcheck:
      # Dockerfile installs procps for pgrep; keep that package while this
      # process-level healthcheck exists. This only verifies the Node process
      # is running; it does not prove Slack Socket Mode is connected.
      test: ["CMD-SHELL", "pgrep -fx 'node dist/index.js' || exit 1"]
      interval: 30s
      timeout: 5s
      start_period: 30s
      retries: 3
    # When OTEL_ENABLED=true, expose metrics with:
    # ports:
    #   - "${PROMETHEUS_PORT:-9464}:${PROMETHEUS_PORT:-9464}"
```

- [ ] **Step 3: Update `.env.example`**

Replace `.env.example` with:

```env
# Slack app credentials
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-level-token

# Claude / Anthropic
ANTHROPIC_API_KEY=sk-ant-your-key

# Wiki repository. Use owner/name, for example acme/scribble-wiki.
WIKI_REPO=your-org/scribble-wiki

# Required for private wiki repos and for pushing wiki changes.
GITHUB_TOKEN=

# Tenant identity
SCRIBBLE_ORG_NAME=Your Company
SCRIBBLE_BOT_NAME=Scribble
SCRIBBLE_BOT_ALIASES=scribble,scrib
SCRIBBLE_DECISION_LOG_CHANNEL=decision-log
SCRIBBLE_WIKI_GIT_AUTHOR_NAME=Scribble Bot
SCRIBBLE_WIKI_GIT_AUTHOR_EMAIL=scribble@example.com

# Optional Linear integration. Leave blank to disable Linear.
LINEAR_API_KEY=

# Local development persistence. Docker Compose overrides this to /data.
DATA_DIRECTORY=./data
TZ=Etc/UTC
LOG_LEVEL=info
LOG_FORMAT=

# Optional telemetry.
OTEL_ENABLED=false
PROMETHEUS_PORT=9464
```

- [ ] **Step 4: Rewrite README install flow**

Edit `README.md` so the top-level order is:

```md
## Current OSS Status
## Requirements
## Supported Runtime
## Temporary Bridge Checkout Layout
## Slack App Setup
## Environment
## Run With Docker Compose
## Raw Docker Build And Run
## Local Development
## First-Run Checklist
## Wiki Repository
## Linear
## Data Layout
## What Scribble Reads and How Data Flows
## Privacy And Security
## Troubleshooting
## Prime Radiant Production Notes
```

Add this bridge block under "Temporary Bridge Checkout Layout":

````md
Until `PRI-1500`, this repository is Docker-first but not yet a standalone single-repo build. The Docker build requires sibling source checkouts:

```text
prime-rad/
├── streamlinear/
└── sen/
    ├── bot-toolkit/
    └── scribble/
```

The compatible commits and bot-toolkit lockfile integrity live in [`docs/bridge-refs.json`](./docs/bridge-refs.json). Verify the bridge metadata with:

```bash
node scripts/check-bridge-refs.mjs
```

If those repositories are not public, this bridge install is limited to trusted/invited testers with source access. Source access alone is not enough: use compatible refs from `docs/bridge-refs.json` or verify the packed bot-toolkit tarball matches the lockfile integrity recorded there.
````

Add this Compose section:

````md
## Run With Docker Compose

Copy the environment file, set secrets, then run:

```bash
cp .env.example .env
docker compose up --build
```

Compose always sets `DATA_DIRECTORY=/data` inside the container and mounts host `./data` to `/data`, even though `.env.example` uses `DATA_DIRECTORY=./data` for local development.

Use `docker compose up --build` after source, dependency, or Dockerfile changes. A plain `docker compose up` may reuse the existing `scribble:local` image.

Follow logs with:

```bash
docker compose logs -f scribble
```
````

Add this raw Docker section:

````md
## Raw Docker Build And Run

```bash
docker build \
  --build-context bot-toolkit=../bot-toolkit \
  --build-context streamlinear=../../streamlinear \
  -t scribble:local .
```

When using `.env.example` or a copied `.env`, override `DATA_DIRECTORY=/data` for the container:

```bash
docker run --rm -it \
  --env-file .env \
  -e DATA_DIRECTORY=/data \
  -v "$PWD/data:/data" \
  scribble:local
```
````

Add a first-run checklist with these exact checks:

```md
## First-Run Checklist

- `docker compose up --build` completes the image build.
- `docker compose logs -f scribble` shows startup and either Slack Socket Mode connection or an actionable Slack auth error.
- `./data` is created on the host and contains generated `config/instance.json`.
- The bot is invited to a Slack channel.
- Mentioning the configured bot name or one alias gets an in-thread response.
- The wiki repo clones under `./data/wiki`, or the auth error clearly names the wiki problem.
- With `LINEAR_API_KEY=` blank, generated config has Linear disabled.
- If decision logging is used, the configured decision-log channel exists and the bot can post there.
- The operator has reviewed broad read/logging scopes and write scopes, including `chat:write.public`.
- The operator understands this release assumes a trusted workspace and does not provide guest, Slack Connect, per-channel privacy, retention/deletion, or admin authorization controls.
```

- [ ] **Step 5: Update Dockerfile bridge comments**

In `Dockerfile`, keep the current named-context example and add:

```dockerfile
# Compatible bridge refs for the current Scribble lockfile live in
# docs/bridge-refs.json. If bot-toolkit changes, repack it and update
# Scribble's package-lock plus docs/bridge-refs.json intentionally instead
# of relying on a floating sibling checkout.
```

Also tighten the existing image healthcheck to the same exact process check used by Compose, and keep the limitation visible:

```dockerfile
# This process-level healthcheck only verifies the Node process is running; it
# does not prove Slack Socket Mode is connected.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD pgrep -fx "node dist/index.js" || exit 1
```

- [ ] **Step 6: Validate bridge refs and Compose config**

Run:

```bash
node scripts/check-bridge-refs.mjs
docker compose config
rg -n "procps" Dockerfile
rg -n "pgrep -fx" Dockerfile docker-compose.yml
```

Expected: PASS, `Dockerfile` still installs `procps`, Dockerfile and Compose both use the exact `pgrep -fx` process healthcheck, and rendered service includes:

```yaml
environment:
  DATA_DIRECTORY: /data
```

- [ ] **Step 7: Commit Docker/docs slice**

Run:

```bash
git add docs/bridge-refs.json scripts/check-bridge-refs.mjs docker-compose.yml .env.example README.md Dockerfile
git commit -m "PRI-1503 document Docker-first Scribble install"
```

---

## Task 8: Clean Public Repo Surface And Scope Wording

**Files:**
- Modify: `README.md`
- Modify: `SECURITY.md`
- Modify: `slack-app-manifest.yaml`
- Modify: `src/__tests__/manifest.test.ts`
- Modify: `src/mcp/index.ts`
- Modify: `package.json`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update package metadata**

In `package.json`, change:

```json
"description": "Prime Radiant company-wide Slack knowledge bot",
```

to:

```json
"description": "Self-hosted Slack knowledge bot with wiki, memory, and conversation tools",
```

Keep `"author": "Prime Radiant"` unchanged unless Drew explicitly asks for a package ownership change.

- [ ] **Step 2: Make Slack manifest comments honest**

In `slack-app-manifest.yaml`, change:

```yaml
- channels:join         # Auto-join public channels
```

to:

```yaml
- channels:join         # Reserved for explicit/public channel join flows
```

Change:

```yaml
- users:read.email      # Get user emails (optional, for wiki attribution)
```

to:

```yaml
- users:read.email      # Retained in full-behavior manifest; current runtime primarily uses profile names
```

Do not remove scopes in this task.

- [ ] **Step 3: Align README and SECURITY with current scope reality**

In `README.md` and `SECURITY.md`, replace claims that Scribble currently supports "automatic channel join" with wording that says the full manifest retains `channels:join`, but operators should invite Scribble to channels they want it to watch.

Use this README wording:

```md
The shipped Slack manifest is the full-behavior profile. It grants broad scopes (`channels:history`, `groups:history`, `im:history`, etc.) intentionally so Scribble can support passive logging, DMs and group DMs, global conversation search, files, reactions, public writes, and explicit channel join flows. There is no minimal-scope alternative manifest in this release.
```

Use this SECURITY wording:

```md
`slack-app-manifest.yaml` is the full-behavior profile and is intentionally broad because current behavior depends on passive logging, DMs and group DMs, global conversation search, file and reaction features, public writes, and explicit channel join flows. It is the only manifest shipped in this release.
```

Keep the reporting section honest without inventing a contact:

```md
Please report suspected vulnerabilities privately using GitHub's "Report a vulnerability" flow when it is enabled for this repository. If that flow is not available, use the private maintainer channel through which you received source access instead of opening a public issue.
```

- [ ] **Step 4: Update code-facing `leave_channel` wording if Task 5 did not already do it**

Confirm `src/mcp/index.ts` contains:

```ts
server.tool(
  'leave_channel',
  buildLeaveChannelDescription(tenantConfig),
  LeaveChannelParams.shape,
  async ({ channel_id }) => {
    return {
      content: [{
        type: 'text' as const,
        text: `Request to leave channel ${channel_id} noted. An operator must remove the app from the channel or implement channel-leave handling.`,
      }],
    };
  }
);
```

- [ ] **Step 5: Update AGENTS and CLAUDE env docs**

In both `AGENTS.md` and `CLAUDE.md`, replace:

```md
- `WIKI_REPO` - GitHub wiki repo (default: prime-radiant-inc/scribble-wiki)
```

with:

```md
- `WIKI_REPO` - GitHub wiki repo in `owner/name` form; required, no default
```

Add tenant env entries:

```md
- `SCRIBBLE_ORG_NAME` - Workspace/company name used in prompts (default: Prime Radiant)
- `SCRIBBLE_BOT_NAME` - Runtime bot name used in prompts and engagement aliases (default: Scribble)
- `SCRIBBLE_BOT_ALIASES` - Comma-separated names that trigger engagement (default: scribble,scrib)
- `SCRIBBLE_DECISION_LOG_CHANNEL` - Decision-log channel name or ID (default: decision-log)
- `SCRIBBLE_WIKI_GIT_AUTHOR_NAME` - Git author name for wiki commits (default: Scribble Bot)
- `SCRIBBLE_WIKI_GIT_AUTHOR_EMAIL` - Git author email for wiki commits (default: scribble-bot@invalid; public examples should set this to an operator-owned address such as `scribble@example.com`)
```

- [ ] **Step 6: Run public-surface scans**

Run:

```bash
rg -n "automatic channel join|wiki attribution|prime-radiant-inc/scribble-wiki|Prime Radiant company-wide" README.md SECURITY.md slack-app-manifest.yaml package.json AGENTS.md CLAUDE.md src/mcp/index.ts src/config/wikiRepo.ts
```

Expected: no matches for stale claims. If `Prime Radiant` remains, it should be either a runtime default, maintainer/author value, or internal deployment note.

- [ ] **Step 7: Run manifest and MCP tests**

Run:

```bash
npm test -- src/__tests__/manifest.test.ts src/mcp/__tests__/toolDescriptions.test.ts
npm run build:mcp
```

Expected: PASS.

- [ ] **Step 8: Commit public-surface wording slice**

Run:

```bash
git add README.md SECURITY.md slack-app-manifest.yaml src/__tests__/manifest.test.ts src/mcp/index.ts package.json AGENTS.md CLAUDE.md
git commit -m "PRI-1503 clean Scribble public surface wording"
```

---

## Task 9: Final Verification And Review Prep

**Files:**
- Review all files changed by Tasks 1-8.

- [ ] **Step 1: Check worktree and commit stack**

Run:

```bash
git status --short --branch
git log --oneline --decorate -n 12
```

Expected: worktree clean, plan/spec commits plus implementation commits present on the task branch/worktree.

- [ ] **Step 2: Run focused test suite**

Run:

```bash
npm test -- \
  src/config/__tests__/tenantConfig.test.ts \
  src/config/__tests__/config.test.ts \
  src/config/__tests__/instanceConfig.test.ts \
  src/config/__tests__/engagement.test.ts \
  src/constitution/__tests__/manager.test.ts \
  src/mcp/__tests__/toolDescriptions.test.ts \
  src/wiki/__tests__/wikiManager.test.ts \
  src/orchestrator/__tests__/scribbleOrchestrator.test.ts \
  src/__tests__/manifest.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run full verification**

Run:

```bash
npm run build:all
npm test
node scripts/check-bridge-refs.mjs
docker compose config
```

Expected: all PASS.

- [ ] **Step 4: Run Docker bridge smoke if sibling checkouts are available**

Run:

```bash
docker build \
  --build-context bot-toolkit=../bot-toolkit \
  --build-context streamlinear=../../streamlinear \
  -t scribble:pri-1503 .
docker run --rm --entrypoint test scribble:pri-1503 -s /app/lib/streamlinear-mcp.js
```

Expected: PASS, including the streamlinear MCP bundle existence check. If unavailable, record exactly which sibling checkout or Docker capability was missing.

- [ ] **Step 5: Inspect generated config manually**

Run:

```bash
tmpdir="$(mktemp -d)"
DATA_DIRECTORY="$tmpdir" \
SLACK_BOT_TOKEN=xoxb-test \
SLACK_APP_TOKEN=xapp-test \
ANTHROPIC_API_KEY=sk-ant-test \
WIKI_REPO=test-org/test-wiki \
SCRIBBLE_ORG_NAME=Acme \
SCRIBBLE_BOT_NAME=Scout \
SCRIBBLE_BOT_ALIASES=scout,helper \
SCRIBBLE_DECISION_LOG_CHANNEL=decisions \
SCRIBBLE_WIKI_GIT_AUTHOR_NAME="Scout Bot" \
SCRIBBLE_WIKI_GIT_AUTHOR_EMAIL=scout@example.com \
node -e "import('./dist/config/config.js').then(({loadConfig}) => { const c = loadConfig(); return import('./dist/config/instanceConfig.js').then(({createInstanceConfig}) => createInstanceConfig(c.dataDirectory, './dist/mcp.js', c.tenant)); })"
jq -c '{env: .mcps["scribble-mcp"].env, linearEnabled: .mcps.linear.enabled}' "$tmpdir/config/instance.json"
rm -rf "$tmpdir"
```

Expected:

```json
{
  "env": {
    "DATA_DIRECTORY": "<tmpdir>",
    "SCRIBBLE_ORG_NAME": "Acme",
    "SCRIBBLE_BOT_NAME": "Scout",
    "SCRIBBLE_BOT_ALIASES": "scout,helper",
    "SCRIBBLE_DECISION_LOG_CHANNEL": "decisions",
    "SCRIBBLE_WIKI_GIT_AUTHOR_NAME": "Scout Bot",
    "SCRIBBLE_WIKI_GIT_AUTHOR_EMAIL": "scout@example.com"
  },
  "linearEnabled": false
}
```

- [ ] **Step 6: Run acceptance scan**

Run:

```bash
rg -n --glob '!**/__tests__/**' "Prime Radiant company-wide|prime-radiant-inc/scribble-wiki|automatic channel join|optional, for wiki attribution|#decision-log|Scribble/scrib" README.md SECURITY.md slack-app-manifest.yaml package.json AGENTS.md CLAUDE.md src
```

Expected:
- No stale package/wiki/automatic-join/email-attribution claims.
- `#decision-log` appears only where default docs intentionally reference the default.
- `Scribble/scrib` appears only in default docs, not in code paths that should use tenant config.

- [ ] **Step 7: Request review**

Use `superpowers:requesting-code-review` after verification passes. Ask reviewers to focus on:

- Tenant config split between main process and `scribble-mcp`.
- Docker/Compose data-directory safety.
- Optional Linear behavior with blank `LINEAR_API_KEY`.
- Public docs honesty around full Slack scope and trusted-workspace limits.

- [ ] **Step 8: Move Linear to In Review after implementation**

After code review findings are handled and verification is still passing, move `PRI-1503` to In Review and add the reflective implementation comment required by `linear-ticket-lifecycle`.

---

## Self-Review Notes

- Spec coverage: Tasks 1-6 cover runtime tenant config, MCP propagation, alias engagement, constitution rendering, wiki author, optional Linear, and decision-log behavior. Tasks 7-8 cover Docker-first install docs, raw Docker `/data` safety, bridge refs, Slack manifest wording, public docs, package metadata, SECURITY, AGENTS, and CLAUDE. Task 9 covers verification.
- Intentional non-goals: no Slack scope removals, no privacy profile, no guest or Slack Connect boundary, no streamlinear local path packaging beyond docs, no final public security contact.
- Dependency bridge refs used in docs come from the current clean sibling `bot-toolkit` checkout and the committed `streamlinear` HEAD at plan-writing time. If those refs are superseded before implementation, update the docs and Docker comments in the same task that verifies the new compatible refs.
