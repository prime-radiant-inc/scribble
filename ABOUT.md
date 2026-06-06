# scribble

> Self-hosted Slack knowledge bot that watches invited conversations, keeps durable notes in a Git-backed wiki, and answers when mentioned.

**Family:** bots · **Type:** service · **Lifecycle:** production · **Owner:** obra

## What it does
Scribble is a self-hosted Slack knowledge bot that acts like a diligent colleague. It watches conversations it is invited to, keeps durable notes in a Git-backed wiki, and answers when mentioned, DM'd, called by name, or already active in a thread. It is built on the bot-toolkit core, the Claude Agent SDK, Bolt Socket Mode, and two MCP servers: a built-in `scribble-mcp` for wiki/conversation/learning/decision-log tools, and `@primeradianthq/streamlinear` for Linear ticket operations when configured.

## How it fits
- Depends on: [bot-toolkit](https://github.com/prime-radiant-inc/bot-toolkit) — `@primeradianthq/bot-toolkit` in package.json dependencies; [streamlinear](https://github.com/prime-radiant-inc/streamlinear) — `@primeradianthq/streamlinear` in package.json dependencies (Linear MCP server).
- Used by: —
- External: Slack (Bolt Socket Mode), Anthropic API / AWS Bedrock, GitHub (commits to wiki repo), Linear (via streamlinear). At Prime Radiant it commits to the scribble-wiki repo via the `WIKI_REPO` env var (configurable; not a code dependency).

## Runtime & data
- Runs: Docker Compose container (self-hosted long-running service).
- Data in: Slack events, Anthropic API, the configured Git wiki repo.
- Data out: Slack messages, Markdown commits to the wiki repo, SQLite state in mounted `/data`.

<!-- Maintained by the maintaining-project-map skill. Do not hand-edit; regenerated. -->
