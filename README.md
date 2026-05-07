# Scribble

Scribble is a self-hosted Slack knowledge bot that acts like a diligent colleague. It watches the conversations it is invited to, keeps durable notes in a Git-backed wiki, remembers useful operating instructions, searches prior conversations, and answers when mentioned, DM'd, called by name, or already active in a thread.

Scribble is built on `@primeradiant/bot-toolkit`, the Claude Agent SDK, Bolt Socket Mode, and two MCP servers:

- `scribble-mcp` for wiki, conversation, learning, decision-log, and channel-management tools
- `streamlinear` for Linear ticket operations when `LINEAR_API_KEY` is configured

## Current OSS Status

This repository is being prepared for external self-hosting in trusted Slack workspaces. Until `PRI-1500` publishes `@primeradiant/bot-toolkit` and finalizes the package install story, this repo is Docker-first but not yet a standalone single-repo build.

Local Docker builds use BuildKit named contexts pointing at sibling checkouts of `bot-toolkit` and `streamlinear`. That temporary bridge mirrors the production image without defining the final public install shape.

## Requirements

- Docker with Compose v2 and BuildKit support
- Git
- A Slack workspace where you can create and install apps
- An Anthropic API key
- A GitHub repository for the wiki, public or private
- Source access to the temporary bridge repositories until the dependencies are public
- Optional for local development: Node.js 20+ and npm 10+
- Optional: a Linear API key

## Supported Runtime

The supported external runtime for this bridge release is Docker. Docker Compose is the friendly single-host path because it provides one env file, persistent `/data`, restart behavior, and a single command to run the bot.

Plain `npm ci` / `npm start` is useful for local development in this checkout, but it is not the promised external install path until `PRI-1500` removes the temporary dependency bridge.

## Temporary Bridge Checkout Layout

Until `PRI-1500`, the Docker build requires sibling source checkouts:

```text
prime-rad/
├── streamlinear/
└── sen/
    ├── bot-toolkit/
    └── scribble/
```

The compatible commits and bot-toolkit lockfile integrity live in [`docs/bridge-refs.json`](./docs/bridge-refs.json). Verify the required bridge checkouts with:

```bash
node scripts/check-bridge-refs.mjs
```

That command fails if either sibling checkout is missing or at the wrong commit. In an isolated checkout where the bridge repositories are intentionally absent, `node scripts/check-bridge-refs.mjs --allow-missing-checkouts` performs only the lockfile-integrity check; that partial mode is not enough for a Docker bridge release.

If those repositories are not public, this bridge install is limited to trusted/invited testers with source access. Source access alone is not enough: use compatible refs from `docs/bridge-refs.json` or verify the packed bot-toolkit tarball matches the lockfile integrity recorded there.

## Slack App Setup

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

## Environment

Copy the example file and fill in your values:

```bash
cp .env.example .env
```

Required:

- `SLACK_BOT_TOKEN`: Slack bot token, `xoxb-...`
- `SLACK_APP_TOKEN`: Slack app-level Socket Mode token, `xapp-...`
- `ANTHROPIC_API_KEY`: Anthropic API key
- `WIKI_REPO`: Required GitHub repo in `owner/name` form, for example `your-org/your-wiki`. There is no default.

Tenant identity:

- `SCRIBBLE_ORG_NAME`: Workspace/company name used in prompts. Runtime default: `Prime Radiant`; public sample: `Your Company`.
- `SCRIBBLE_BOT_NAME`: Runtime bot name used in prompts and engagement aliases. Runtime default: `Scribble`.
- `SCRIBBLE_BOT_ALIASES`: Comma-separated names that trigger engagement. Runtime default: `scribble,scrib`.
- `SCRIBBLE_DECISION_LOG_CHANNEL`: Decision-log channel name or ID. Runtime default: `decision-log`. Public channel names are looked up by name; use a channel ID for private channels.
- `SCRIBBLE_WIKI_GIT_AUTHOR_NAME`: Git author name for wiki commits. Runtime default: `Scribble Bot`.
- `SCRIBBLE_WIKI_GIT_AUTHOR_EMAIL`: Git author email for wiki commits. Runtime default: `scribble-bot@invalid`; public sample: `scribble@example.com`.
- `TZ`: Runtime timezone. Public sample: `Etc/UTC`.

Optional:

- `GITHUB_TOKEN`: GitHub token for private wiki repos and for pushing wiki changes. Prefer a fine-grained token scoped only to the wiki repo.
- `LINEAR_API_KEY`: Enables the bundled `streamlinear` MCP server. Leave blank to disable Linear.
- `DATA_DIRECTORY`: Persistent data directory. `./data` is acceptable for local development. Docker Compose forces `/data` in the container.
- `LOG_LEVEL`: `debug`, `info`, `warn`, or `error`.
- `LOG_FORMAT`: Set to `json` for structured logs.
- `OTEL_ENABLED`: Set to `true` to expose Prometheus metrics.
- `PROMETHEUS_PORT`: Metrics port, default `9464`.

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

For a configuration-only check, create `.env` first, then run `docker compose config`. Compose intentionally fails before rendering config when `.env` is absent because the runtime secrets file is part of the supported install path.

If `OTEL_ENABLED=true`, uncomment the metrics `ports` block in [`docker-compose.yml`](./docker-compose.yml) before exposing Prometheus metrics.

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

The image healthcheck verifies only that `node dist/index.js` is running. It does not prove Slack Socket Mode is connected.

## Local Development

Until `PRI-1500`, local `npm install` also needs the bot-toolkit tarball that Docker packs automatically. From the documented sibling checkout layout:

```bash
(
  cd ../bot-toolkit
  npm install
  npm pack --pack-destination .
)
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

Local development uses `DATA_DIRECTORY=./data` unless you override it.

## First-Run Checklist

- `docker compose up --build` completes the image build.
- `node scripts/check-bridge-refs.mjs` passes with both sibling bridge checkouts present.
- `docker compose logs -f scribble` shows startup and either Slack Socket Mode connection or an actionable Slack auth error.
- `./data` is created on the host and contains generated `config/instance.json`.
- The bot is invited to a Slack channel.
- Mentioning the configured bot name or one alias gets an in-thread response.
- The wiki repo clones under `./data/wiki`, or the auth error clearly names the wiki problem.
- With `LINEAR_API_KEY=` blank, generated config has Linear disabled.
- If decision logging is used, the configured decision-log channel exists and the bot can post there.
- The operator has reviewed broad read/logging scopes and write scopes, including `chat:write.public` and the internal `slack_reply` tool behavior.
- The operator understands this release assumes a trusted workspace and does not provide guest, Slack Connect, per-channel privacy, retention/deletion, or admin authorization controls.

## Wiki Repository

Scribble clones `WIKI_REPO` into `{DATA_DIRECTORY}/wiki` and commits wiki changes there. `WIKI_REPO` is required and has no default. For a private repo, set `GITHUB_TOKEN`. For a public repo, a token is not required for reads but is still required if Scribble should push changes.

The generic wiki tools are intentionally limited to safe markdown paths inside the wiki root. They reject absolute paths, traversal, dot-prefixed paths, `_scribble` internals, non-markdown entry writes, and symlink escapes.

## Linear

Linear is optional. Leave `LINEAR_API_KEY=` blank to keep Linear disabled.

When `LINEAR_API_KEY` is set in Docker, Scribble configures the `linear` MCP server as:

```json
{
  "command": "node",
  "args": ["/app/lib/streamlinear-mcp.js"],
  "envFrom": ["LINEAR_API_TOKEN"]
}
```

`LINEAR_API_KEY` is stored in `secrets.json` as `LINEAR_API_TOKEN` instead of being embedded directly in `instance.json`. During the temporary bridge, `streamlinear` is still a Docker build dependency because the image bundles it unconditionally, even when Linear is disabled at runtime. Local nonstandard `STREAMLINEAR_MCP_PATH` polish is tracked separately by `PRI-1519`.

## Data Layout

```text
{DATA_DIRECTORY}/
├── config/
│   ├── instance.json
│   └── secrets.json
├── sessions.db
├── rooms/
├── conversations/
├── constitution/
└── wiki/
```

`config/secrets.json` is generated for bot-toolkit's local secrets reader and is written with owner-only permissions when possible. Treat the whole data directory as sensitive: it may contain Slack conversation logs, downloaded files, Claude session data, and wiki credentials.

## What Scribble Reads and How Data Flows

Once invited to a channel, Scribble:

- Logs messages from that channel to `DATA_DIRECTORY/conversations/<channel_id>/<date>/`. Both regular and threaded messages.
- Includes recent context from other public channels Scribble is also a member of in its system prompt when responding. This cross-channel context is on by default and is not opt-in per channel.
- Searches across all logged channels by default when an internal `conversation_search` happens. Channel-scoped search is supported by passing a `channel_id`, but the default is global.

This means: if Scribble is invited to both `#engineering` and `#strategy`, recent public-channel messages from the latter may surface as system-prompt context when answering a question in the former. Separately, logged private-channel, DM, or group-DM content may still surface as tool output when Scribble runs a global `conversation_search`. Invite Scribble only to conversations where this data flow is acceptable.

The shipped Slack manifest is the full-behavior profile. It grants broad scopes (`channels:history`, `groups:history`, `im:history`, etc.) intentionally so Scribble can support passive logging, DMs and group DMs, global conversation search, files, reactions, public writes, and explicit channel join flows. There is no minimal-scope alternative manifest in this release.

When Scribble chooses to answer, it sends visible Slack replies through the bot-token write scopes. The internal `slack_reply` write tool is part of that response path; it is not an operator approval gate.

## Privacy And Security

Scribble can read public channels, private channels, DMs, and group DMs according to the scopes you grant and the conversations where the bot is present. It stores conversation logs and downloaded files under `DATA_DIRECTORY`.

This release is for trusted Slack workspaces. It does not provide guest boundaries, Slack Connect isolation, per-channel privacy controls, retention/deletion controls, or admin authorization gates for durable memory and wiki/tool side effects.

Recommended self-hosting defaults:

- Invite Scribble only to channels where passive logging is acceptable.
- Use a dedicated wiki repo and least-privilege GitHub token.
- Use a dedicated Slack app per workspace.
- Review the Slack manifest scopes before installing.
- Back up and protect `DATA_DIRECTORY`.
- Rotate Slack, GitHub, Linear, and Anthropic credentials if the data directory is exposed.

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
- Confirm `/app/lib/streamlinear-mcp.js` exists in Docker, or run the Docker build above.

## Prime Radiant Production Notes

Prime Radiant production deploys Scribble through `sen-deploy`. This repository does not dispatch internal deployments and does not update ECS directly.

For the temporary pre-`PRI-1500` bridge, `sen-deploy` builds this repository's `Dockerfile` with BuildKit named contexts for explicit `bot-toolkit` and `streamlinear` source refs. Once `@primeradiant/bot-toolkit` is published and Scribble consumes it from npm, the bot-toolkit named context should be removed from the internal deploy path.
