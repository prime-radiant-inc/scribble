# Scribble Policy Hardening Design

## Status

Approved for planning. This is a design spec only; no implementation work is included in this commit.

## Context

Scribble is being prepared for external self-hosted use while preserving the current product behavior: a diligent Slack colleague that watches invited conversations, keeps memory, maintains a wiki, follows up in threads, and logs decisions.

The previous OSS-readiness pass handled install/runtime parity, public-facing docs, Docker packaging, wiki path hardening, token-safe wiki auth, attachment download status checks, and dependency audit cleanup. The remaining security work is mostly around sensitive Slack/tool behavior that is currently protected by prompts and convention more than code structure.

This slice should be a behavior-preserving hardening refactor, not a new security profile.

## Goals

- Make sensitive behaviors easier to reason about and test without changing valid current behavior.
- Add real validation, normalization, redaction, and structured sensitive-operation logging where it reduces risk now.
- Keep the broad/full Scribble Slack manifest as the only shipped manifest for now.
- Preserve current permissive behavior for valid inputs.
- Use a heavily test-first workflow so any behavior drift is caught immediately.

## Non-Goals

- Do not remove Slack scopes or events.
- Do not ship a second Slack manifest or security profile.
- Do not make writes admin-only.
- Do not make cross-channel context opt-in.
- Do not make `conversation_search` current-channel-only by default.
- Do not add a new audit JSONL file, database table, or retention subsystem.
- Do not change wiki overwrite semantics.
- Do not wrap streamlinear in a new hard confirmation flow.
- Do not add data retention or deletion behavior.

## Current Behavior To Preserve

- `slack_reply` can post to any valid Slack channel/thread supplied by tool input.
- `log_decision` posts decision text, tags, and source permalink to the resolved `decision-log` channel.
- `conversation_search` searches globally when `channel_id` is omitted.
- Cross-channel context includes recent messages from other joined public channels.
- `learn_behavior` and `set_channel_instruction` persist by default.
- Wiki write/delete/rename tools remain available under the existing path-hardening rules.
- Linear is available through streamlinear when `LINEAR_API_KEY` is configured.
- The Slack manifest remains the full-behavior manifest.

## Design

### Security Primitives

Add a small `src/security/` layer with helpers that perform real work immediately:

- `slackIdentifiers.ts`
  - Validate Slack channel IDs, user IDs, and Slack timestamp/thread timestamp shapes.
  - Use these validators in intercepted Slack side-effect parsing and conversation search channel scoping.

- `conversationSearchGuards.ts`
  - Normalize `query`, `channel_id`, `date`, `limit`, and `context`.
  - Reject empty search queries.
  - Reject malformed `channel_id` values so search cannot path-walk through `DATA_DIRECTORY`.
  - Cap `limit` and `context` to reasonable maximums while preserving normal caller behavior.

- `redaction.ts`
  - Redact common secrets and sensitive URLs before data reaches operational logs.
  - Cover Slack private file URLs, bearer tokens, Slack tokens, Anthropic keys, GitHub tokens, Linear keys, and obvious `KEY=VALUE` secret shapes.

- `sensitiveOperationLog.ts`
  - Wrap the existing logger with metadata-only structured events for sensitive operations.
  - Log operation name, actor/channel/thread IDs where available, target IDs, content length, and status.
  - Do not log message bodies, decision text, learned instruction content, wiki page content, tokens, private URLs, or full tool inputs.
  - Do not create a new audit file or database.

Do not add dummy `return true` policy functions. If a helper does not validate, normalize, redact, log, or remove duplication, it should not exist in this slice.

### Integration Points

- `src/core/responseSchema.ts`
  - Tighten `slack_reply` and `log_decision` parsing.
  - Preserve current invalid-tool behavior by returning `null` for invalid intercepted inputs.
  - Require valid Slack-shaped channel/thread identifiers for `slack_reply`.
  - Require non-empty message text.
  - Require `log_decision.tags` to be strings and cap tag count/length.

- `src/mcp/index.ts`
  - Normalize `conversation_search` arguments before calling `ConversationLogger.search()`.
  - Keep the public MCP tool shape unless implementation proves a schema description update is necessary.

- `src/logging/conversationLogger.ts`
  - Add a defensive channel ID guard for scoped searches so direct callers cannot escape the conversations directory.
  - Keep global search behavior unchanged for omitted `channel_id`.

- `src/orchestrator/scribbleOrchestrator.ts`
  - Replace logger calls that include full tool input or decision content with redacted metadata.
  - Emit sensitive-operation logs after successful `slack_reply` and `log_decision`.

- `src/context/crossChannelContext.ts`
  - Do not change behavior in this slice.
  - Add characterization coverage if needed so future policy changes are safer.

- Docs
  - Update README and SECURITY notes to make clear that the shipped Slack manifest is the full-behavior profile and intentionally broad.
  - Do not add a second manifest/profile yet.

## Test Strategy

Implementation must start with characterization tests before refactoring behavior-sensitive code.

Characterization tests:

- `slack_reply` still posts to any valid Slack channel/thread from tool input.
- `log_decision` still posts to the resolved `decision-log` channel.
- `conversation_search` still searches globally when `channel_id` is omitted.
- Cross-channel context still includes other joined public channels.
- Learned behavior and channel instruction tools still persist by default.
- The Slack manifest stays unchanged.

Hardening tests:

- Malformed Slack channel IDs are rejected for `slack_reply`.
- Malformed Slack timestamps are rejected for `slack_reply`.
- Empty `conversation_search.query` is rejected.
- Malformed `conversation_search.channel_id` is rejected.
- `conversation_search.limit` and `conversation_search.context` are capped.
- `log_decision.tags` must be strings and stay within configured count/length caps.
- Redaction removes private Slack URLs and common API token shapes.
- Sensitive-operation logging records metadata and content lengths, not full content.

Full verification after implementation:

- `npm run build:all`
- `npm test`
- `npm audit --json`
- Docker build if Docker/runtime files change

## Acceptance Criteria

- Valid current behavior is unchanged and covered by characterization tests.
- Invalid or unsafe input is rejected or normalized in a narrow, documented way.
- Sensitive operational logs no longer include full intercepted tool inputs, decision text, tokens, or private Slack URLs.
- Sensitive operations emit structured metadata through the existing logger.
- No Slack scopes/events are removed.
- No second Slack manifest/profile is added.
- The implementation remains small enough that each helper has an immediate security or clarity purpose.

## Future Work

These are intentionally deferred:

- Admin/trusted-user gates for durable memory and wiki writes.
- Current-channel or membership-scoped conversation search.
- Cross-channel context restrictions for DMs, guests, or Slack Connect users.
- Separate minimal OSS Slack manifest.
- Durable audit log or retention policy.
- Hard confirmation wrapper around streamlinear mutating actions.
