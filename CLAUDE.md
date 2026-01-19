# Scribble Bot

Scribble is a company-wide Slack bot that reads all messages, mines for facts/tasks/issues, maintains a wiki, and helps team members find information.

## Architecture

- **Slack Adapter**: Listens to ALL messages in joined channels using Socket Mode
- **Orchestrator**: Routes messages between logging, mining, and interactive responses
- **Conversation Logger**: Stores all messages in markdown files organized by channel/date
- **Wiki Manager**: Manages the scribble-wiki Git repository
- **Database**: SQLite for deduplication and metadata

## Message Flow

1. **All Messages**: Logged to `conversations/{channel_id}/{date}/{thread_ts}.md`
2. **Background Mining**: Haiku extracts facts, tasks, issues -> Wiki
3. **Interactive (@mention/DM)**: Haiku responds using conversation context + wiki

## Directory Structure

```
/app/data/
├── scribble.db           # SQLite database
├── conversations/        # Logged conversations
│   └── {channel_id}/
│       └── {date}/
│           └── {thread_ts}.md
├── wiki/                 # Cloned wiki repository
│   └── (scribble-wiki contents)
└── downloads/            # Downloaded file attachments
```

## Development

```bash
npm install
npm run dev     # Development mode with tsx
npm run build   # Compile TypeScript
npm start       # Run production build
npm test        # Run tests
```

## Environment Variables

Required:
- `SLACK_BOT_TOKEN` - Slack bot OAuth token (xoxb-...)
- `SLACK_APP_TOKEN` - Slack app-level token (xapp-...)
- `ANTHROPIC_API_KEY` - Anthropic API key

Optional:
- `WIKI_REPO` - GitHub wiki repo (default: prime-radiant-inc/scribble-wiki)
- `GITHUB_TOKEN` - GitHub token for wiki access
- `LINEAR_API_KEY` - Linear API key (for future integration)
- `DATA_DIRECTORY` - Data storage path (default: ./data)
- `LOG_LEVEL` - Logging level (default: info)

## Slack App Configuration

Required scopes:
- `channels:history` - Read messages in public channels
- `channels:join` - Join public channels
- `channels:read` - List and get info about channels
- `chat:write` - Send messages
- `files:read` - Access file info
- `reactions:read` - Read reactions
- `reactions:write` - Add reactions
- `users:read` - Get user info

Required events:
- `message.channels` - Messages in public channels
- `message.groups` - Messages in private channels
- `message.im` - Direct messages
- `message.mpim` - Group DMs
- `app_mention` - @mentions
- `member_joined_channel` - Bot added to channel
- `channel_left` - Bot removed from channel

Enable Socket Mode for real-time events without a public URL.
