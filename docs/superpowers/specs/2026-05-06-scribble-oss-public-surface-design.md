# Scribble OSS Public Surface Design

## Status

Approved for planning. This is a design spec only; no implementation work is included in this commit.

## Context

Scribble is being prepared for an external self-hosted install in a friend-of-the-company Slack workspace. The target shape is one Slack workspace, a small set of trusted users, and an operator who should not need Prime Radiant infrastructure knowledge.

Recent PRI-1499 work already moved the repo a long way toward that goal: README, `.env.example`, SECURITY, CONTRIBUTING, Docker packaging, wiki path hardening, token-safe wiki auth, attachment checks, policy hardening, and deploy-boundary cleanup have all landed. PRI-1503 should not redo that work or reopen broad security policy.

The remaining problem is public fit and finish. External installers should not have to edit TypeScript source to remove Prime Radiant assumptions or to make Scribble fit their workspace.

## Goals

- Make the supported external install path Docker-first and coherent.
- Add a small runtime tenant config surface for the identity and channel values that currently leak Prime Radiant assumptions.
- Keep Scribble's current product behavior intact: broad Slack manifest, passive logging in invited conversations, global conversation search, cross-channel context, decision logging, wiki writes, and optional Linear when configured.
- Make the Slack manifest, README, `.env.example`, SECURITY, package metadata, and repo guidance agree with the actual runtime behavior.
- Keep the temporary dependency bridge honest until PRI-1500 publishes and switches Scribble to the final bot-toolkit package story.

## Non-Goals

- Do not publish `@primeradiant/bot-toolkit` or switch Scribble to the npm dependency. That remains PRI-1500.
- Do not make plain `npm start` the supported external install target during the temporary dependency bridge.
- Do not add a minimal Slack manifest, Slack security profile, or privacy profile system.
- Do not make passive listening, global conversation search, or cross-channel context configurable in this slice.
- Do not add admin/trusted-user gates, data retention, deletion, current-channel-only search, or streamlinear confirmation wrappers.
- Do not solve local streamlinear packaging beyond documenting the Docker boundary; Linear MCP path polish is tracked by PRI-1519.
- Do not resolve the final public security reporting contact in this slice. Keep SECURITY guidance accurate but do not invent or ship a placeholder contact.

## Product Contract

Scribble's supported external runtime is Docker. The README should lead with a Docker Compose path because it is the most approachable single-host operator flow: `.env`, persistent `/data`, restart behavior, and one command to run the bot. Raw `docker build` and `docker run` commands should remain as a transparent/debuggable path.

During the temporary dependency bridge, this is Docker-first but not yet a standalone single-repo external install. The operator docs must say exactly which checkouts are required and where they must live for named build contexts to work. The product promise for PRI-1503 is an honest bridge install with coherent public defaults, not the final standalone install.

The external operator should understand the temporary bridge:

- Docker currently builds with named contexts for sibling `bot-toolkit` and `streamlinear` source checkouts.
- The documented checkout layout must match the Dockerfile's expected contexts, such as `bot-toolkit=../bot-toolkit` and `streamlinear=../../streamlinear`.
- The docs must say where those bridge checkouts come from. If they are not public yet, say the bridge install is only for trusted/invited testers with source access.
- The docs must identify compatible bridge refs or an equivalent provenance check for those sibling checkouts. Source access alone is not enough if the operator can accidentally build against mismatched `bot-toolkit` or `streamlinear` revisions.
- `streamlinear` may remain a Docker build dependency during this bridge even when `LINEAR_API_KEY` is unset, but the runtime config must keep Linear disabled and quiet when the key is absent.
- That bridge is intentional before PRI-1500 and does not define the final install story.
- A clean external `npm ci` is not promised until PRI-1500 changes the dependency to the published package.

The public behavior remains the full Scribble behavior. The shipped Slack manifest is broad by design. Passive listening and cross-channel context are not opt-in per channel in this slice; the docs should explain the data flow plainly so operators invite Scribble only where that behavior is acceptable.

This release is for trusted Slack workspaces. It does not provide guest boundaries, Slack Connect isolation, per-channel privacy controls, retention/deletion controls, or admin authorization gates for durable memory and wiki/tool side effects. The README and SECURITY docs should distinguish read/logging scope from write scope, including `chat:write.public` and `slack_reply`.

## Runtime Tenant Config

Extend the existing config loading path with a small tenant config object. Defaults should preserve current Prime Radiant behavior so existing deployments do not need immediate env changes. Public examples should use external-safe placeholders rather than Prime Radiant values.

Add these env vars to `.env.example` and README:

```env
SCRIBBLE_ORG_NAME=Your Company
SCRIBBLE_BOT_NAME=Scribble
SCRIBBLE_BOT_ALIASES=scribble,scrib
SCRIBBLE_DECISION_LOG_CHANNEL=decision-log
SCRIBBLE_WIKI_GIT_AUTHOR_NAME=Scribble Bot
SCRIBBLE_WIKI_GIT_AUTHOR_EMAIL=scribble@example.com
TZ=Etc/UTC
LOG_FORMAT=
```

Use them as follows:

- `SCRIBBLE_ORG_NAME` and `SCRIBBLE_BOT_NAME` feed the base constitution identity text.
- `SCRIBBLE_BOT_ALIASES` feeds engagement matching and any prompt/tool guidance that names the bot. The effective alias set must always include `SCRIBBLE_BOT_NAME` in addition to the comma-separated aliases, after trimming and deduplication.
- `SCRIBBLE_DECISION_LOG_CHANNEL` feeds decision-log channel resolution and the constitution wording.
- `SCRIBBLE_WIKI_GIT_AUTHOR_NAME` and `SCRIBBLE_WIKI_GIT_AUTHOR_EMAIL` feed the git author config used by wiki commits.
- `TZ` remains the runtime timezone knob and should be documented as part of external setup.
- `LOG_FORMAT=json` enables structured JSON logs and should be documented as an optional operator setting.

### Config Propagation Contract

The tenant config must be shared by both the main process and the `scribble-mcp` subprocess. Do not make `scribble-mcp` call the full `loadConfig()` path, because that would couple the MCP subprocess to Slack and Anthropic requirements it does not need. Add a small tenant-only parser, for example `parseTenantConfig(env)`, that both processes can use.

The main process should parse tenant config once, then pass normalized tenant env values through generated `instance.json` env wiring so `scribble-mcp` sees the same effective config. This avoids divergent raw-env parsing between processes.

| Env var | Runtime default if unset | Public sample | Main-process consumer | MCP-process consumer | Required tests |
| --- | --- | --- | --- | --- | --- |
| `SCRIBBLE_ORG_NAME` | `Prime Radiant` | `Your Company` | constitution renderer | tool guidance if it references org identity | default and custom constitution text |
| `SCRIBBLE_BOT_NAME` | `Scribble` | `Scribble` | constitution renderer, effective aliases, logs where user-visible | MCP tool descriptions/guidance that name the bot | bot name is included in engagement/dismissal aliases |
| `SCRIBBLE_BOT_ALIASES` | `scribble,scrib` | `scribble,scrib` | effective engagement `nameMentions`, dismissal patterns | MCP `respond` guidance examples | aliases parse, regex escaping, engagement and dismissal use bot name plus configured aliases |
| `SCRIBBLE_DECISION_LOG_CHANNEL` | `decision-log` | `decision-log` | decision-log resolver, constitution renderer | `log_decision` tool description | configured channel name appears in prompt/tool guidance and resolver tests |
| `SCRIBBLE_WIKI_GIT_AUTHOR_NAME` | `Scribble Bot` | `Scribble Bot` | none unless surfaced in docs | `WikiManager` git config | wiki manager writes configured git author |
| `SCRIBBLE_WIKI_GIT_AUTHOR_EMAIL` | `scribble@prime-radiant.ai` | `scribble@example.com` | none unless surfaced in docs | `WikiManager` git config | wiki manager writes configured git email |
| `TZ` | current `America/Los_Angeles` behavior | `Etc/UTC` | bot-toolkit config timezone, container timezone | inherited process env if needed | config/default docs coverage |
| `LOG_FORMAT` | human-readable logs | blank or `json` | logger | inherited process env | logger docs and existing JSON logger tests |
| `LINEAR_API_KEY` | unset / Linear disabled | blank | integration availability for constitution renderer | `linear` MCP enablement via generated secrets | disabled path has no runtime Linear config |

The implementation may choose helper names freely, but the contract above should be visible in tests so future changes do not silently leave one process behind.

Validation should stay boring and startup-oriented:

- Trim string values.
- Treat an unset required tenant env var as "use the runtime default"; treat a present-but-empty or whitespace-only required tenant env var as invalid.
- Treat blank optional env vars like `LOG_FORMAT=` and `LINEAR_API_KEY=` as unset.
- Parse aliases as comma-separated non-empty names.
- Build effective aliases from `SCRIBBLE_BOT_NAME` plus parsed `SCRIBBLE_BOT_ALIASES`, dedupe case-insensitively, and escape every alias before generating regexes.
- Keep defaults equal to current behavior.
- Produce env-var-specific errors for invalid values.

Do not introduce a settings UI, database-backed settings, multi-tenant support, or a profile system.

### Decision-Log Channel Contract

`SCRIBBLE_DECISION_LOG_CHANNEL` should accept either a Slack channel ID or a channel name. A leading `#` should be normalized away for names.

Resolution contract:

- If the value is a Slack channel ID, use it directly and skip channel-list lookup.
- If the value is a name, look it up by public channel name for this slice.
- If an operator wants a private decision-log channel, require a channel ID and document that path.
- Document the public-name lookup limitation in README.

Missing channel behavior should be actionable. Do not cache a miss forever in a way that requires a process restart after the operator creates or invites the configured channel; retry lookup on the next decision-log attempt or use a short miss TTL.

## Slack Manifest And Identity

Runtime bot identity and Slack app identity are related but separate.

The runtime config controls what Scribble calls itself in prompts and which names/aliases it listens for. Slack's visible app name and bot display name are controlled by `slack-app-manifest.yaml` and Slack app settings during installation.

README should tell external installers to keep these aligned:

- Set `SCRIBBLE_BOT_NAME` and `SCRIBBLE_BOT_ALIASES` in `.env`.
- Edit the Slack manifest name/display name before importing if they want a visible Slack name other than Scribble.
- Reinstall or update the Slack app after changing scopes, events, or display metadata.

The manifest should remain the single full-behavior manifest for now. Do not add a minimal alternative manifest in this slice.

## Linear And Streamlinear

Linear remains optional.

- With `LINEAR_API_KEY` unset, Scribble should generate config with Linear disabled and should not require streamlinear at runtime.
- With `LINEAR_API_KEY` set in Docker, Scribble should use the bundled `/app/lib/streamlinear-mcp.js` produced by the Docker build.
- During the temporary bridge, streamlinear may remain a Docker build dependency because the image bundles it unconditionally. Docs should distinguish build-time bridge requirements from runtime Linear enablement.
- `STREAMLINEAR_MCP_PATH`, if mentioned, should be documented only as a local-development or nonstandard override.
- Deeper cleanup of the local Linear MCP path story is tracked by PRI-1519.

The constitution and README should avoid implying Linear is always available. They should describe Linear as available when configured.

## Documentation Updates

Update README around this flow:

1. Create/import the Slack app from the manifest.
2. Create `.env` from `.env.example`.
3. Set Slack, Anthropic, wiki, tenant identity, and optional integration values.
4. Run with Docker Compose.
5. Verify first run.

Add an operator truth table for the temporary bridge:

| Topic | Docker external path | Local development path |
| --- | --- | --- |
| Runtime data directory | Force `DATA_DIRECTORY=/data` in Compose and mount host `./data` to `/data` | `DATA_DIRECTORY=./data` is acceptable |
| `bot-toolkit` dependency | Requires documented sibling named context until PRI-1500 | Requires local tarball path or future npm package |
| `streamlinear` dependency | Requires documented sibling named context while Docker bundles streamlinear | Needed only when testing Linear locally; use `STREAMLINEAR_MCP_PATH` if necessary |
| Bridge refs | Use documented compatible refs, SHAs, or provenance checks for sibling checkouts | Same compatibility requirement while the tarball bridge exists |
| Metrics | Expose `PROMETHEUS_PORT` only when `OTEL_ENABLED=true` | local port from env |
| First-run status | Use `docker compose logs -f scribble` and expected Slack Socket Mode/startup messages | use `npm run dev` logs |

Compose must set `DATA_DIRECTORY=/data` explicitly even when `.env` contains `DATA_DIRECTORY=./data`, or the docs must separate local and container env files. The implementation should avoid a path where following the documented Docker flow writes state to a non-mounted container directory.

Raw Docker commands must have the same safety property. If README keeps raw `docker run --env-file .env` examples, those examples must either override `DATA_DIRECTORY=/data`, use a Docker-specific env file, or tell the operator to remove/replace the local-development `DATA_DIRECTORY=./data` value before running the container. The raw Docker path should not silently write runtime state to an unmounted relative path inside the image.

Add a first-run checklist:

- Docker image builds.
- Bridge dependency checkouts are present at the documented paths and match the documented compatible refs or provenance check.
- Container starts and uses persistent `/data`.
- `docker compose logs -f scribble` shows the expected startup and Slack Socket Mode connection signal, or an actionable Slack auth error.
- Slack Socket Mode connects.
- Bot is invited to a channel.
- Mentioning the configured bot name or alias gets an in-thread response.
- Wiki repo clones, or auth failure is actionable and distinguishable from Slack auth failure.
- Linear stays disabled when `LINEAR_API_KEY` is unset.
- If decision logging is used, the configured decision-log channel exists and the bot can post there.
- Operator has reviewed broad read/logging scopes and write scopes, including `chat:write.public`.
- Operator understands this release assumes a trusted workspace and does not provide guest, Slack Connect, per-channel privacy, retention/deletion, or admin authorization controls.

Clean up public-surface mismatches:

- Fix `AGENTS.md` and `CLAUDE.md` where they still describe a Prime Radiant wiki default.
- Keep `SECURITY.md` truthful without inventing a security contact. If no real reporting path is approved during implementation, leave the guidance generic and note that a concrete public reporting path is deferred.
- Update package metadata so the package is not described as a Prime Radiant-only company bot.
- Keep internal `sen-deploy` notes demoted behind the public install path.
- Treat old `docs/plans/*` as archival unless a specific stale public claim needs a short disclaimer.
- Explain broad Slack scope classes in README: passive message reads, private/DM reads when invited/granted, file access, reactions, public writes, and user/email lookup. Document only real current dependencies; if a scope is present for deferred or future behavior, say that instead of inventing runtime behavior.
- Avoid presenting `leave_channel` or channel-management tool acknowledgements as an enforced privacy boundary unless implementation actually makes the bot leave and stop monitoring the channel.

## Implementation Shape

Keep the code change small and direct:

- Extend `Config` in `src/config/config.ts` with a tenant config object.
- Add a tenant-only config parser/helper that can be used by both `loadConfig()` and `scribble-mcp` without requiring Slack or Anthropic secrets in the MCP process.
- Thread the tenant config into engagement config construction in `src/index.ts`.
- Convert the base constitution from a fixed string export into a small renderer or template that receives tenant config.
- Thread decision-log channel config into `ScribbleOrchestrator`.
- Thread wiki git author config into `WikiManager`, including the `scribble-mcp` process that constructs it.
- Pass normalized tenant env vars through generated `instance.json` env wiring so `scribble-mcp` sees the same config as the main process.
- Generate dismissal patterns from configured aliases using escaped regexes.
- Render Linear guidance conditionally based on whether Linear is configured.
- Add `docker-compose.yml` for the Docker-first external path.
- Update README, `.env.example`, SECURITY, package metadata, `AGENTS.md`, and `CLAUDE.md`.

Avoid changing Slack scopes, passive logging behavior, conversation search policy, cross-channel context, package publication mechanics, or deployment ownership.

## Test Strategy

Add focused tests for the new config behavior:

- Default config preserves current values.
- Tenant env values are parsed, trimmed, and validated.
- Unset required tenant env values use defaults; present-but-empty required tenant env values fail with env-var-specific errors.
- Aliases parse from comma-separated env, combine with `SCRIBBLE_BOT_NAME`, dedupe, and feed engagement config.
- Dismissal patterns use the effective alias set and escape regex metacharacters.
- Constitution rendering uses configured org name, bot name, aliases, and decision-log channel.
- MCP tool guidance/descriptions no longer retain hard-coded bot identity where configured values should appear.
- Wiki manager uses configured git author name/email.
- Decision-log resolution uses the configured channel value, including channel name normalization, channel ID passthrough, public-channel name lookup, and retry behavior after misses.
- Linear remains disabled when `LINEAR_API_KEY` is unset.
- Manifest drift tests continue to pass.

Verification after implementation:

```bash
npm run build:all
npm test
```

If Docker or Compose files change, also run the relevant Docker/Compose validation or build smoke that matches the temporary named-context bridge.

## Acceptance Criteria

- README presents Docker Compose as the friendly external install path and raw Docker commands as the transparent alternative.
- README and Compose docs state the exact sibling checkout/named-context requirements during the temporary bridge, including compatible refs, SHAs, or provenance checks, and do not claim a standalone single-repo Docker build before PRI-1500.
- README says where required bridge checkouts come from, or states that the bridge install is limited to trusted/invited testers with source access until the dependencies are public.
- Compose and raw Docker examples persist runtime state to mounted `/data` even if `.env.example` includes a local-development `DATA_DIRECTORY=./data` value.
- `.env.example` covers required secrets, optional integrations, and tenant identity config with external-safe samples while README documents current runtime defaults separately.
- Runtime config drives org/company name, bot name, aliases, alias-based dismissals, decision-log channel, wiki git author/email, and timezone docs in both the main process and `scribble-mcp`.
- Slack docs clearly distinguish runtime bot identity from Slack app/manifest identity.
- README distinguishes read/logging scope from write scope, including `chat:write.public` and `slack_reply` behavior.
- Public install docs explicitly say this release is for trusted workspaces and does not provide guest, Slack Connect, per-channel privacy, retention/deletion, or admin authorization controls.
- Passive listening, global search, and cross-channel context remain fixed current behavior and are documented honestly.
- Linear is documented and implemented as optional; deeper local MCP path polish points to PRI-1519.
- Prime Radiant-only deployment and package assumptions are demoted, removed, or clearly identified as temporary/internal.
- SECURITY remains truthful and does not invent a placeholder reporting contact; the concrete public reporting path is deferred.
- Tests cover tenant config parsing and the runtime points it affects.
- `npm run build:all` and `npm test` pass after implementation.

## Future Work

- PRI-1500: publish/switch `@primeradiant/bot-toolkit` and remove the temporary dependency bridge.
- PRI-1519: clarify Linear MCP packaging boundary for Docker installs and local dev.
- Define the final public security reporting path for Scribble before a broader public release.
- Minimal Slack manifest or privacy profile, if product need justifies it later.
- Admin/trusted-user gates for durable memory, wiki writes, or tool side effects.
- Retention/deletion controls for conversations, downloads, sessions, and generated secrets.
