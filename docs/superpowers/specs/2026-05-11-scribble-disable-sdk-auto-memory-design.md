# Scribble: Disable Claude Agent SDK Auto-Memory Design

## Status

Approved for planning. This is a design spec only; no implementation work is included in this commit.

## Context

Scribble is a multi-tenant Slack bot built on `@primeradianthq/bot-toolkit` and the Claude Agent SDK. PRI-1532's clean external install rehearsal on 2026-05-11 surfaced an architectural mismatch (filed as PRI-1555 / "F5"):

When a Slack user asks Scribble to *"remember X about me,"* the model uses the Claude Agent SDK's built-in auto-memory tool. Concrete observed behavior from the rehearsal:

```
toolsUsed: ["Glob", "Write", "Write"]
```

The bot wrote to `/home/scribble/.claude/projects/-data-rooms-slack-c0b08tl529x/memory/MEMORY.md` and `user_drew_ritter.md` — inside the container's user home, **not** in `DATA_DIRECTORY`, **not** in the configured `WIKI_REPO`, **not** volume-mounted in `docker-compose.yml`, and lost on every container recreation.

Production check confirmed the same code path is live: `ecs-scribble-18-scribble-*` has 11 auto-memory directories (one per Slack channel) and 0 memory files. The vulnerability is latent — one naturally-phrased "remember X" prompt would trigger ephemeral storage that operators would expect to be durable wiki content.

The README's data-flow section, `WIKI_REPO` requirement, and `_scribble/` directory layout all imply durable, git-backed memory. Auto-memory undermines that contract silently.

## Problem

The Claude Agent SDK's auto-memory feature was designed for **single-user interactive IDE** sessions. It writes to `~/.claude/projects/<cwd-derived-slug>/memory/` using a per-project storage model. That model is wrong for Scribble because:

1. **Multi-tenancy.** One Scribble container serves many users across many channels. Auto-memory collapses all of them into one "project" per channel slug — cross-tenant memory bleed.
2. **Architectural duplication.** Scribble already has a richer multi-tenant memory architecture: `learn_behavior` (global rules), `set_channel_instruction` (channel-scoped rules), and `wiki_create`/`wiki_edit` (markdown knowledge). All flow through `WikiManager.commit()` to a configured git repo. Auto-memory bypasses every one of them.
3. **Durability.** `/home/scribble/` is not under `DATA_DIRECTORY` and is not volume-mounted by Scribble's `docker-compose.yml`. Container recreation discards memory writes.

Bot-toolkit currently hard-codes `settingSources: ['user', 'project']` in `sessionManagerSDK.ts:137`, which leaves auto-memory enabled with no consumer opt-out path. Any bot-toolkit consumer (Scribble and the other Prime Radiant bots) has no way to control this today short of patching the toolkit.

## Goals

- Disable Claude Agent SDK auto-memory in Scribble so durable memory flows only through Scribble's wiki and learned-behavior tools.
- Add a first-class, back-compat opt-out config in bot-toolkit so every present and future consumer can make the same choice without patching.
- Preserve existing bot-toolkit consumers' current behavior — no surprise breakage for single-tenant consumers (e.g., per-user PA) that may legitimately rely on auto-memory.
- Position the work for the broader prompt-injection hardening conversation (a separate ticket) by establishing the same config-shape pattern.

## Non-Goals

- Do not disable the SDK's `Write`/`Edit`/`Glob`/`Read`/`Bash` tools in this slice. That broader `disallowedTools` work is the prompt-injection hardening ticket, filed separately.
- Do not propose a Scribble-side `attachment_read` MCP replacement for `Read`. Out of scope.
- Do not change bot-toolkit's `permissionMode: 'bypassPermissions'`, `allowDangerouslySkipPermissions: true`, or `settingSources: ['user', 'project']`.
- Do not modify Docker hardening (`read_only`, `cap_drop`, `security_opt`) here; that pairs with the hardening ticket.
- Do not redirect auto-memory storage to a durable location. The SDK's storage path is hard-coded; redirection is not reachable without an upstream SDK change.
- Do not file an upstream SDK issue asking for `autoMemoryEnabled` to be a programmatic option. Worth doing eventually but does not block this slice.

## Design

### Mechanism

The Claude Agent SDK exposes two equivalent disable gates for auto-memory (verified in `node_modules/@anthropic-ai/claude-agent-sdk/cli.js:7553` and `sdk.d.ts:3886`):

1. `autoMemoryEnabled: false` in `.claude/settings.json` (project- or user-scoped, discovered via `settingSources`).
2. `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` environment variable on the SDK subprocess.

The flag is **not** exposed on the programmatic `query()` `Options` type at `sdk.d.ts:811`. It lives only in the SDK's settings-file schema and env-gate path. Per-call passthrough through bot-toolkit's `SendMessageOptions` is therefore impossible today.

Bot-toolkit will set the env var on the SDK subprocess when its `Config.autoMemory === 'disabled'`. This avoids settings-file plumbing, file-ownership pitfalls under the entrypoint, and operator volume-mount shadowing.

### bot-toolkit Config Shape

Add one field to the existing `Config` interface (`/Users/drewritter/prime-rad/sen/bot-toolkit/src/config/config.ts`):

```ts
export interface Config {
  // …existing fields…
  /** Controls the Claude Agent SDK's auto-memory feature.
   *  - 'enabled' (default) preserves current SDK behavior.
   *  - 'disabled' sets CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 in the SDK subprocess
   *    env, removing the system-prompt memory section and the memory-write gate.
   *  Multi-tenant bots with their own memory architecture (wiki, learned
   *  behaviors) should set this to 'disabled'. Single-tenant per-user bots can
   *  leave it enabled. */
  autoMemory?: 'enabled' | 'disabled';
}
```

Constructor-level placement matches how `useAgentSDK`, `dataDirectory`, and `timezone` already live on `Config`. The decision is session-manager-lifetime stable; per-call would be overkill.

### bot-toolkit Env Builder

In `/Users/drewritter/prime-rad/sen/bot-toolkit/src/core/sessionManagerSDK.ts`, the `buildSdkEnv` helper composes the env passed to the SDK subprocess. Add a branch:

```ts
const env: Record<string, string> = {
  // …existing entries…
};
if (config.autoMemory === 'disabled') {
  env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1';
}
return env;
```

`buildSdkEnv` already produces the env object passed to the SDK; adding a new key is purely additive. Bot-toolkit's existing `SDK_ENV_ALLOWLIST` controls only which parent-process env vars are forwarded; bot-toolkit can unconditionally add its own keys to the output env regardless of the allowlist.

### Default: 'enabled' (back-compat)

The default preserves current behavior. Existing bot-toolkit consumers (PA, Brainstorm, Spec-together) keep auto-memory active on a routine bot-toolkit upgrade. Scribble — and any future consumer with a richer memory architecture — explicitly opts out by setting `autoMemory: 'disabled'`.

This trades safer-by-default for zero-surprise upgrades. The owner of all current bot-toolkit consumers (Drew) chose back-compat to keep the change purely additive.

### Scribble Construction

In `/Users/drewritter/prime-rad/sen/scribble/src/index.ts`, `buildBotToolkitConfig` (lines 29-45) adds one field:

```ts
function buildBotToolkitConfig(
  scribbleConfig: ReturnType<typeof loadConfig>,
  configDir: string
): BotToolkitConfig {
  return {
    claude: { paDirectory: '', configDir },
    database: { path: path.join(scribbleConfig.dataDirectory, 'sessions.db') },
    dataDirectory: scribbleConfig.dataDirectory,
    timezone: scribbleConfig.timezone,
    useAgentSDK: true,
    autoMemory: 'disabled',
  };
}
```

No `.claude/` directory in the Scribble repo, no `Dockerfile` change, no `docker-compose.yml` change, no `docker/entrypoint-scribble.sh` change.

### Version Bump

- bot-toolkit `1.0.1` → `1.0.2`. Purely additive new field on `Config`, no breakage. Could justify `1.1.0` as a "new capability" but the npm consumer surface treats both as `^1.0.0`-compatible; semver patch is fine.
- Scribble's `package.json` bumps `@primeradianthq/bot-toolkit` from `^1.0.0` to `^1.0.2`. Lockfile regenerated via `npm install`.

## Tests

### bot-toolkit

Add a `describe` block to bot-toolkit's existing test coverage for `sessionManagerSDK` / `buildSdkEnv`:

```ts
describe('autoMemory config', () => {
  it("sets CLAUDE_CODE_DISABLE_AUTO_MEMORY when 'disabled'", () => {
    const env = buildSdkEnv(process.env, platformEnv, { autoMemory: 'disabled' });
    expect(env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe('1');
  });

  it("omits CLAUDE_CODE_DISABLE_AUTO_MEMORY when 'enabled'", () => {
    const env = buildSdkEnv(process.env, platformEnv, { autoMemory: 'enabled' });
    expect(env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBeUndefined();
  });

  it('omits CLAUDE_CODE_DISABLE_AUTO_MEMORY when option absent (back-compat)', () => {
    const env = buildSdkEnv(process.env, platformEnv, {});
    expect(env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBeUndefined();
  });
});
```

The third case locks the back-compat promise: omitting the option produces no behavior change for existing consumers.

### Scribble

Export `buildBotToolkitConfig` from `src/index.ts` and add a sibling test:

```ts
// src/__tests__/index.test.ts
import { buildBotToolkitConfig } from '../index.js';

it('disables Claude Agent SDK auto-memory; Scribble owns memory via wiki + _scribble/', () => {
  // Use the loadConfig path's existing minimal-env test pattern from
  // src/config/__tests__/config.test.ts to produce a scribbleConfig fixture,
  // or hand-construct the minimal { dataDirectory, timezone, ... } object.
  const scribbleConfig = makeMinimalScribbleConfig();
  const config = buildBotToolkitConfig(scribbleConfig, '/tmp/cfg');
  expect(config.autoMemory).toBe('disabled');
});
```

The test name documents intent. Catches accidental removal of the line in future refactors. `makeMinimalScribbleConfig` is an inline helper the implementer either lifts from `config.test.ts` or writes from scratch — it just needs `dataDirectory`, `timezone`, and any other required `loadConfig` return fields.

### Not in CI

The Slack-handshake round-trip — connect → "remember X" → assert no `MEMORY.md` file written — is the integration evidence that motivated this work. The PRI-1532 rehearsal performed this manually; re-running it post-fix is part of the implementation plan but not part of CI.

### Manual smoke post-deploy

After the bot-toolkit publish and Scribble bump land in production:

```
docker exec ecs-scribble-...-scribble-... env | grep CLAUDE_CODE_DISABLE_AUTO_MEMORY
```

Should print `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`. Confirms the env is reaching the SDK subprocess.

## Docs

### bot-toolkit

- JSDoc on the `Config.autoMemory` field (already in the design above).
- `CHANGELOG.md` entry under `1.0.2`: *"Add `Config.autoMemory` option; defaults to `'enabled'` for back-compat. Setting `'disabled'` sets `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` in the SDK subprocess env."*

### Scribble

Add a "Memory durability" paragraph in `README.md` under the existing **"What Scribble Reads and How Data Flows"** section (current lines 219-234):

> Scribble's durable memory of facts shared with the bot flows through `wiki_create`/`wiki_edit` (markdown knowledge) and `learn_behavior`/`set_channel_instruction` (operator-visible rules) — all of which are committed to the configured `WIKI_REPO`. Scribble explicitly disables the Claude Agent SDK's built-in auto-memory tool, which would otherwise write to container-local storage that is lost on container recreation and invisible to operators.

`CLAUDE.md` requires no change. The directory layout already names `wiki/_scribble/` as the memory home.

## Rollout

Strict order, because Scribble's `^1.0.2` constraint requires `1.0.2` to exist on npm before the Scribble bump merges:

1. **bot-toolkit PR:** Add `Config.autoMemory`, env-builder branch, three tests, `CHANGELOG.md`. Land on `main`, tag `v1.0.2`, `npm publish`.
2. **Scribble PR:** Bump `@primeradianthq/bot-toolkit` to `^1.0.2`, regen lockfile, add `autoMemory: 'disabled'` to `buildBotToolkitConfig`, export it, add the sibling test, update README. Land on `main`. Public CI verifies (`npm ci`, `npm test`, `npm audit --omit=dev`, docker build, streamlinear smoke).
3. **Production deploy:** `sen-deploy`'s `build-parallel.yml` workflow run with `repo=scribble` and the new Scribble commit SHA. Manual env-check smoke after task definition `scribble:19` reaches stable.

## Alternatives Considered

Five delivery paths were evaluated by four staff-SWE-perspective subagents during brainstorming:

- **A. Bake `.claude/settings.json` into the Docker image** via `Dockerfile` COPY. Rejected because the entrypoint already owns `/home/scribble/.claude/`, `chown`s it, and the file would be shadowed by any operator volume mount on that path — image lies about what's running.
- **B. Entrypoint-written settings file** with idempotent "write if absent" semantics. Rejected because it solves the problem only for Scribble; every other bot-toolkit consumer would rediscover the same footgun. Also adds shell logic to a runtime contract surface (`entrypoint-scribble.sh`) when a config knob in the library is cleaner.
- **C. Env-var passthrough via bot-toolkit's `SDK_ENV_ALLOWLIST`.** Rejected because it leaks SDK jargon (`CLAUDE_CODE_DISABLE_AUTO_MEMORY`) into the operator's vocabulary and forces every operator to discover and own the decision, contradicting the README's "wiki is durable storage" promise.
- **D. bot-toolkit hardcodes `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` for all consumers.** Rejected because it's too coarse. PA runs per-user single-tenant containers where auto-memory's single-user storage model is correct; force-disabling for every consumer removes legitimate functionality.
- **D-prime (chosen). bot-toolkit adds a `Config.autoMemory` field, default `'enabled'`.** Each consumer decides. Scribble opts out, PA leaves default, future consumers make an explicit call.

The full agent reports are in `/private/tmp/claude-501/-Users-drewritter-prime-rad-sen-scribble/2b8bdbab-0f27-46b4-913e-32962db22226/tasks/` and are not part of source. The key load-bearing facts from those reports are reproduced inline above.

## Ticket Hygiene

- **PRI-1555** — rename and narrow. Current title implies disabling all SDK filesystem tools; new scope is auto-memory only. Suggested new title: *"Disable Claude Agent SDK auto-memory in Scribble."* Description updated to point at this spec. State `Backlog` → `In Dev` when implementation starts.
- **New child ticket** under PRI-1499 — *"Restrict Claude Agent SDK built-in tools (`disallowedTools`) for prompt-injection defense in Scribble."* Captures the broader hardening conversation deferred from this slice: which built-in tools to disallow (Write/Edit/Bash/Read/Glob/Grep), what to do about attachment reading, and the paired Docker hardening (`read_only`, `cap_drop`, `security_opt`). References the threat-model evidence collected during PRI-1532 (Bash → env exfil prompt-injection scenario).
- **PRI-1499** — final-audit ticket PRI-1534 already gates on PRI-1555 plus the new hardening ticket before flipping repo visibility public, per the existing comment thread.
- **PRI-1554** (F4 — auto-commit `_scribble/`) — unaffected by this slice but stays open as a separate fix.

## References

- PRI-1532 install rehearsal comment (verbatim commands, all five findings, branch reference)
- PRI-1555 production-state comment (11 dirs, 0 files; latent vulnerability)
- `/Users/drewritter/prime-rad/sen/scribble/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` — `Options` at 811, `autoMemoryEnabled` at 3886, preset shape at 1281
- `/Users/drewritter/prime-rad/sen/scribble/node_modules/@anthropic-ai/claude-agent-sdk/cli.js:7553` — env-var gate
- `/Users/drewritter/prime-rad/sen/bot-toolkit/src/core/sessionManagerSDK.ts:137` — `settingSources` hardcode site, lines 199-231 — `queryOptions` build site, `buildSdkEnv` helper
- `/Users/drewritter/prime-rad/sen/scribble/src/index.ts:29-45` — Scribble's `buildBotToolkitConfig`
- `/Users/drewritter/prime-rad/sen/scribble/README.md:219-234` — data-flow section that gets the new memory-durability paragraph
