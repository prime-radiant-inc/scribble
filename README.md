# Scribble

Scribble is a Slack bot that acts like a diligent colleague. It watches the channels it is invited to, keeps durable notes in a Git-backed wiki, remembers useful operating instructions, searches prior conversations, and answers when mentioned, DM'd, called by name, or already active in a thread.

Scribble is built on `@primeradiant/bot-toolkit`, the Claude Agent SDK, Bolt Socket Mode, and two MCP servers:

- `scribble-mcp` for wiki, conversation, learning, decision-log, and channel-management tools
- `streamlinear` for Linear ticket operations when `LINEAR_API_KEY` is configured

## Current OSS Status

This repository is being prepared for external self-hosting. Until `PRI-1500` publishes `@primeradiant/bot-toolkit` and finalizes package metadata, local Docker builds use BuildKit named contexts pointing at sibling checkouts of `bot-toolkit` and `streamlinear`.

That temporary shape mirrors the production image without changing Scribble's behavior. Once the packages are public, the Docker build should switch to normal package installs.

## Requirements

- Node.js 20+
- npm 10+
- Git
- A Slack workspace where you can create and install apps
- An Anthropic API key, unless you run through the production Bedrock path
- A GitHub repository for the wiki, public or private
- Optional: a Linear API key

## Slack App Setup

1. Open [api.slack.com/apps](https://api.slack.com/apps).
2. Create a new app from [`slack-app-manifest.yaml`](./slack-app-manifest.yaml).
3. Install the app to your workspace.
4. Copy the bot token from **OAuth & Permissions**. It starts with `xoxb-`.
5. Enable **Socket Mode**.
6. Create an app-level token with `connections:write`. It starts with `xapp-`.
7. Invite Scribble to the channels it should watch.

Socket Mode is required. Scribble does not need a public HTTP endpoint for Slack events.

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

Optional:

- `GITHUB_TOKEN`: GitHub token for private wiki repos. Prefer a fine-grained token scoped only to the wiki repo.
- `LINEAR_API_KEY`: Enables the bundled `streamlinear` MCP server.
- `DATA_DIRECTORY`: Persistent data directory. Defaults to `./data` locally and `/data` in Docker.
- `LOG_LEVEL`: `debug`, `info`, `warn`, or `error`.
- `OTEL_ENABLED`: Set to `true` to expose Prometheus metrics.
- `PROMETHEUS_PORT`: Metrics port, default `9464`.

## Local Development

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

## Docker

The Dockerfile preserves the production runtime layout: compiled app, bundled `dist/mcp.js`, bundled `streamlinear`, `/data` persistence, and an entrypoint that fixes mounted volume ownership before running as the `scribble` user.

Current pre-npm build:

```bash
docker build \
  --build-context bot-toolkit=../bot-toolkit \
  --build-context streamlinear=../../streamlinear \
  -t scribble:local .
```

Run it:

```bash
docker run --rm -it \
  --env-file .env \
  -v "$PWD/data:/data" \
  scribble:local
```

The container healthcheck verifies that `node dist/index.js` is running. The image includes `procps` so the healthcheck works in the same shape as production.

## Wiki Repository

Scribble clones `WIKI_REPO` into `{DATA_DIRECTORY}/wiki` and commits wiki changes there. For a private repo, set `GITHUB_TOKEN`. For a public repo, a token is not required for reads but is still required if Scribble should push changes.

The generic wiki tools are intentionally limited to safe markdown paths inside the wiki root. They reject absolute paths, traversal, dot-prefixed paths, `_scribble` internals, non-markdown entry writes, and symlink escapes.

## Linear

When `LINEAR_API_KEY` is set, Scribble configures the `linear` MCP server as:

```json
{
  "command": "node",
  "args": ["/app/lib/streamlinear-mcp.js"],
  "envFrom": ["LINEAR_API_TOKEN"]
}
```

`LINEAR_API_KEY` is stored in `secrets.json` as `LINEAR_API_TOKEN` instead of being embedded directly in `instance.json`. This mirrors production. If Linear is not configured, leave `LINEAR_API_KEY` unset.

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

## Privacy And Security

Scribble can read public channels, private channels, DMs, and group DMs according to the scopes you grant and the conversations where the bot is present. It stores conversation logs and downloaded files under `DATA_DIRECTORY`.

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

## Production Notes

Prime Radiant production currently deploys through `sen-deploy` to ECS Fargate. The repo-local Dockerfile is intended to mirror that production image so future self-hosted installs and production deploys share one runtime contract.
