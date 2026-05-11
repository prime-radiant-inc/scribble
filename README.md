# Scribble

[![CI](https://github.com/prime-radiant-inc/scribble/actions/workflows/ci.yml/badge.svg)](https://github.com/prime-radiant-inc/scribble/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node: 24+](https://img.shields.io/badge/node-%3E%3D24-43853d.svg)](./package.json)

Scribble is a self-hosted Slack knowledge bot that acts like a diligent colleague. It watches conversations it is invited to, keeps durable notes in a Git-backed wiki, and answers when mentioned, DM'd, called by name, or already active in a thread.

It is built on `@primeradianthq/bot-toolkit`, the Claude Agent SDK, Bolt Socket Mode, and two MCP servers:

- `scribble-mcp` for wiki, conversation, learning, decision-log, and channel-management tools.
- `@primeradianthq/streamlinear` for Linear ticket operations when `LINEAR_API_KEY` is configured.

## Contents

- [Quickstart](#quickstart)
- [Required environment](#required-environment)
- [Security at a glance](#security-at-a-glance)
- [Slack app setup](#slack-app-setup)
- [Wiki repository](#wiki-repository)
- [Linear](#linear)
- [Optional environment](#optional-environment)
- [Data layout](#data-layout)
- [Local development](#local-development)
- [Troubleshooting](#troubleshooting)
- [Security and privacy](#security-and-privacy)
- [Contributing and license](#contributing-and-license)

## Quickstart

Docker Compose is the supported runtime for self-hosting.

1. Clone this repository and `cd` into it.
2. Create a Slack app from [`slack-app-manifest.yaml`](./slack-app-manifest.yaml), install it to your workspace, enable Socket Mode, and create an app-level token with `connections:write`. See [Slack app setup](#slack-app-setup) for the full walkthrough.
3. Create the runtime environment file: `cp .env.example .env`, then fill in `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `ANTHROPIC_API_KEY`, and `WIKI_REPO`.
4. Build and start the bot: `docker compose up --build`. Follow logs with `docker compose logs -f scribble`.
5. Invite the bot to a channel and mention it.

`./data` is created on the host and mounted into the container at `/data`. Compose forces `DATA_DIRECTORY=/data` inside the container regardless of what is in `.env`.

## Required environment

- `SLACK_BOT_TOKEN`: Slack bot token, starts with `xoxb-`.
- `SLACK_APP_TOKEN`: Slack app-level Socket Mode token, starts with `xapp-`.
- `ANTHROPIC_API_KEY`: Anthropic API key. Required unless `CLAUDE_CODE_USE_BEDROCK=1` is set, in which case Claude is sourced through AWS Bedrock and `ANTHROPIC_API_KEY` becomes optional.
- `WIKI_REPO`: GitHub repository in `owner/name` form, for example `your-org/your-wiki`. There is no default.
- `GITHUB_TOKEN`: GitHub token with write access to the wiki repo so Scribble can commit wiki updates. Prefer a fine-grained token scoped only to the wiki repo, with contents write permission. (Strictly optional if the wiki repo is public and read-only.)

## Security at a glance

Scribble is for Slack workspaces where the operator intentionally grants broad bot visibility and is comfortable with passive logging in invited conversations, cross-channel context, and global conversation search. Scribble does **not** currently provide guest boundaries, Slack Connect isolation, per-channel privacy controls, retention/deletion automation, or admin approval gates for durable memory and wiki/tool side effects. Do not install Scribble in a workspace or channel where that data flow would be surprising or unacceptable. See [Security and privacy](#security-and-privacy) for the full posture, operator responsibilities, and the per-surface table.

## Slack app setup

1. Open [api.slack.com/apps](https://api.slack.com/apps).
2. Create a new app from [`slack-app-manifest.yaml`](./slack-app-manifest.yaml).
3. If you want Slack's visible app name or bot display name to be something other than Scribble, edit the manifest before importing it.
4. Install the app to your workspace.
5. Copy the bot token from **OAuth & Permissions**. It starts with `xoxb-`.
6. Enable **Socket Mode**.
7. Create an app-level token with `connections:write`. It starts with `xapp-`.
8. Invite Scribble to the channels it should watch.

Socket Mode is required. Scribble does not need a public HTTP endpoint for Slack events.

Runtime bot identity and Slack app identity are separate. `SCRIBBLE_BOT_NAME` and `SCRIBBLE_BOT_ALIASES` control prompt identity and engagement matching. The Slack manifest controls the visible Slack app name and bot display name. Reinstall or update the Slack app after changing scopes, events, or display metadata.

The shipped manifest is the full-behavior profile. The bot scopes it requests are:

- Channel access: `channels:history`, `channels:join`, `channels:read`, `groups:history`, `groups:read`.
- Direct messages: `im:history`, `im:read`, `im:write`, `mpim:history`, `mpim:read`.
- Messaging: `chat:write`, `chat:write.public`.
- Files: `files:read`, `files:write`.
- Reactions: `reactions:read`, `reactions:write`.
- Users: `users:read`, `users:read.email`.
- App: `app_mentions:read`.

The bot event subscriptions are:

- Messages: `message.channels`, `message.groups`, `message.im`, `message.mpim`.
- Mentions: `app_mention`.
- Membership: `member_joined_channel`, `channel_left`.
- Context: `reaction_added`, `user_change`.

The manifest does not ship a minimal-scope alternative. Review it before installing.

## Wiki repository

Scribble clones `WIKI_REPO` into `{DATA_DIRECTORY}/wiki` and commits wiki changes there. `WIKI_REPO` is required and has no default.

- An empty GitHub repository is fine. Scribble seeds `_scribble/` automatically on first run.
- For a private repo, set `GITHUB_TOKEN`.
- For a public repo, a token is not required for reads, but is still required if you want Scribble to push wiki changes back to GitHub.
- Prefer a fine-grained GitHub token scoped only to the wiki repo, with write content access if pushes are wanted.

The wiki tools are intentionally limited to safe markdown paths inside the wiki root. They reject absolute paths, traversal, dot-prefixed paths, `_scribble` internals, non-markdown entry writes, and symlink escapes.

## Linear

Linear is optional. Leave `LINEAR_API_KEY=` blank to keep Linear disabled.

When `LINEAR_API_KEY` is set in Docker, Scribble configures the `linear` MCP server as:

```json
{
  "command": "node",
  "args": ["/app/node_modules/.bin/streamlinear"],
  "envFrom": ["LINEAR_API_TOKEN"]
}
```

`LINEAR_API_KEY` is stored in `secrets.json` as `LINEAR_API_TOKEN` instead of being embedded directly in `instance.json`. For local development or nonstandard installs, set `STREAMLINEAR_MCP_PATH` only when you need to override the packaged streamlinear entrypoint; leave it unset in Docker.

## Optional environment

Tenant identity:

- `SCRIBBLE_ORG_NAME`: Workspace/company name used in prompts. Runtime default: `Your Organization`.
- `SCRIBBLE_BOT_NAME`: Runtime bot name used in prompts and engagement aliases. Runtime default: `Scribble`.
- `SCRIBBLE_BOT_ALIASES`: Comma-separated names that trigger engagement. Runtime default: `scribble,scrib`.
- `SCRIBBLE_DECISION_LOG_CHANNEL`: Decision-log channel name or ID. Runtime default: `decision-log`. Public channel names are looked up by name; use a channel ID for private channels. The channel must exist in the workspace *before* Scribble is asked to log a decision. The `log_decision` tool is invocation-driven (Claude calls it on demand) rather than always-on, so a missing channel surfaces as a tool-call failure, not a startup error.
- `SCRIBBLE_WIKI_GIT_AUTHOR_NAME`: Git author name for wiki commits. Runtime default: `Scribble Bot`.
- `SCRIBBLE_WIKI_GIT_AUTHOR_EMAIL`: Git author email for wiki commits. Runtime default: `scribble@example.com`.
- `TZ`: Runtime timezone. Public sample: `Etc/UTC`.

Other:

- `LINEAR_API_KEY`: Enables the packaged `streamlinear` MCP server. Leave blank to disable Linear.
- `STREAMLINEAR_MCP_PATH`: Local-development or nonstandard path to the streamlinear MCP entrypoint. Docker uses the installed package bin at `/app/node_modules/.bin/streamlinear`.
- `DATA_DIRECTORY`: Persistent data directory. `./data` is acceptable for local development. Docker Compose forces `/data` in the container.
- `LOG_LEVEL`: `debug`, `info`, `warn`, or `error`.
- `LOG_FORMAT`: Set to `json` for structured logs.
- `OTEL_ENABLED`: Set to `true` to expose Prometheus metrics.
- `PROMETHEUS_PORT`: Metrics port, default `9464`.
- `CLAUDE_CODE_USE_BEDROCK`: Set to `1` to source Claude through AWS Bedrock instead of the Anthropic API. When this is set, `ANTHROPIC_API_KEY` is optional and the standard AWS credential chain is used; otherwise `ANTHROPIC_API_KEY` is required.

## Data layout

```text
{DATA_DIRECTORY}/
├── config/
│   ├── instance.json
│   └── secrets.json
├── sessions.db
├── rooms/
├── conversations/
└── wiki/
    └── _scribble/
        ├── constitution-learned.json
        ├── constitution-log.json
        └── channel-instructions.json
```

There is no top-level `constitution/` directory. Learned behaviors, the modification log, and channel-specific instructions all live inside the wiki under `_scribble/` as JSON files (see [`src/constitution/manager.ts`](./src/constitution/manager.ts)).

`config/secrets.json` is generated for bot-toolkit's local secrets reader and is written with owner-only permissions when possible. Treat the whole data directory as sensitive: it may contain Slack conversation logs, downloaded files, Claude session data, and wiki credentials.

## Local development

For development against the source in this checkout (Docker is still the supported external runtime):

```bash
npm install
npm run build:all
npm test
npm run dev
```

For production-style local execution:

```bash
npm run build:all
npm start
```

Local development uses `DATA_DIRECTORY=./data` unless you override it. If you need to test Linear outside Docker, run `npm install`, set `LINEAR_API_KEY`, and leave `STREAMLINEAR_MCP_PATH` unset unless you need a nonstandard streamlinear entrypoint.

A raw Docker run is also supported:

```bash
docker build -t scribble:local .
docker run --rm -it \
  --env-file .env \
  -e DATA_DIRECTORY=/data \
  -v "$PWD/data:/data" \
  scribble:local
```

The image healthcheck verifies only that `node dist/index.js` is running. It does not prove Slack Socket Mode is connected.

## Troubleshooting

If the bot does not receive messages:

- Confirm Socket Mode is enabled.
- Confirm the app-level token has `connections:write`.
- Reinstall the Slack app after changing scopes or events.
- Invite the bot to the channel.
- Check logs for missing environment variables or Slack auth errors.

If wiki operations fail:

- Confirm `WIKI_REPO` exists and is in `owner/name` form.
- Confirm `GITHUB_TOKEN` can read and write that repo.
- Check that `DATA_DIRECTORY` is writable by the Scribble process.

If Linear tools fail:

- Confirm `LINEAR_API_KEY` is set.
- Confirm `/app/node_modules/.bin/streamlinear` exists in Docker, or run the Docker build above.
- Outside Docker, run `npm install` and confirm `STREAMLINEAR_MCP_PATH`, if set, points to an existing streamlinear MCP entrypoint.

If `docker compose config` fails before rendering: create `.env` first. Compose intentionally fails before rendering config when `.env` is absent because the runtime secrets file is part of the supported install path.

If `OTEL_ENABLED=true` but metrics are not exposed: uncomment the metrics `ports` block in [`docker-compose.yml`](./docker-compose.yml).

## Security and privacy

Scribble's privacy boundary is based on operator-managed invitation and scope choices. It can read public channels, private channels, DMs, and group DMs according to the scopes you grant and the conversations where the bot is present. It stores conversation logs, downloaded files, generated config, secrets references, Claude session data, and wiki data under `DATA_DIRECTORY`.

Public CI for this repository runs `npm ci`, `npm run build:all`, `npm test`, `npm audit --omit=dev`, and a Docker image build without internal infrastructure or deployment credentials. Scribble is Docker-first and consumes both `@primeradianthq/bot-toolkit` and `@primeradianthq/streamlinear` from npm, so a clean checkout can build without sibling source repositories.

Operator responsibilities:

- Review the shipped Slack manifest before installing; it is the full-behavior profile, not a minimal-scope profile.
- Invite Scribble only where broad context and durable logs are acceptable.
- Protect `DATA_DIRECTORY`, because it contains operational state, logs, downloaded files, sessions, and generated config.

Once invited to a channel, Scribble:

- Logs messages from that channel to `DATA_DIRECTORY/conversations/<channel_id>/<date>/`. Both regular and threaded messages.
- Includes recent context from other public channels Scribble is also a member of in its system prompt when responding. This cross-channel context is on by default and is not opt-in per channel.
- Searches across all logged channels by default when an internal `conversation_search` happens. Channel-scoped search is supported by passing a `channel_id`, but the default is global.

If Scribble is invited to both `#engineering` and `#strategy`, recent public-channel messages from the latter may surface as system-prompt context when answering a question in the former. Separately, logged private-channel, DM, or group-DM content may still surface as tool output when Scribble runs a global `conversation_search`. Invite Scribble only to conversations where this data flow is acceptable.

Scribble's durable memory of facts shared with the bot flows through `wiki_create`/`wiki_edit` (markdown knowledge) and `learn_behavior`/`set_channel_instruction` (operator-visible rules) — all of which are committed to the configured `WIKI_REPO`. Scribble explicitly disables the Claude Agent SDK's built-in auto-memory tool, which would otherwise write to container-local storage that is lost on container recreation and invisible to operators.

| Surface | Current behavior | Operator implication |
| --- | --- | --- |
| Invited conversations | Scribble passively logs messages in channels, DMs, and group DMs where it is present. | Invite it only where durable logging is acceptable. |
| Cross-channel context | Recent public-channel activity can be injected as background context while answering elsewhere. | Treat public channels with Scribble present as part of one shared workspace context. |
| `conversation_search` | Searches all logged channels by default when no `channel_id` is supplied. | Sensitive conversations should not rely on channel separation as a privacy boundary. |
| Wiki and learned behavior tools | Durable writes are available to the agent when the corresponding tool is used. | Use a dedicated wiki repo and review learned behavior/wiki changes like operational state. |
| Slack write scopes | The manifest supports public writes, replies, reactions, files, and channel join flows. | Review scopes before install and use a dedicated Slack app per workspace. |
| Local data | `DATA_DIRECTORY` contains operational state and sensitive logs. | Back it up, restrict filesystem access, and rotate credentials if exposed. |

Recommended self-hosting defaults:

- Invite Scribble only to channels where passive logging is acceptable.
- Use a dedicated wiki repo and least-privilege GitHub token.
- Use a dedicated Slack app per workspace.
- Review the Slack manifest scopes before installing.
- Back up and protect `DATA_DIRECTORY`.
- Rotate Slack, GitHub, Linear, and Anthropic credentials if the data directory is exposed.

For vulnerability reports, see [SECURITY.md](./SECURITY.md).

## Contributing and license

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, supported runtime, and dependency policy. Scribble is released under the [MIT License](./LICENSE).
