# Contributing

Thanks for helping improve Scribble.

## Development

```bash
npm install
npm run build:all
npm test
```

Use Node.js 24 or newer. Keep changes scoped to the behavior being fixed or added.

Docker builds install Scribble's reusable runtime dependencies from npm. Run `npm ci`, `npm run build:all`, `npm test`, and a Docker build before changing Docker or Linear packaging behavior.

## Runtime Changes

Scribble is designed to preserve a quiet, engagement-based Slack behavior:

- It responds to direct mentions, DMs, name mentions, and active threads.
- It stays silent when a message is not directed at it.
- It uses MCP tools for wiki, learning, conversation search, decision logging, and optional Linear operations.

When changing runtime behavior, include tests that show the old and new behavior clearly.

## Security And Privacy

Be careful with changes touching:

- Wiki file paths and Git operations
- Slack channel, thread, and user authorization
- Conversation search and cross-channel context
- Downloaded files
- Generated config and secrets

Do not log secrets or raw tokens. Do not broaden Slack or GitHub permissions without documenting why.
