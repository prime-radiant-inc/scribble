# Scribble Bot

Scribble is a company-wide Slack bot that acts as a diligent colleague. It watches every conversation, extracts knowledge, maintains documentation, tracks tasks, and helps the team stay organized—but only speaks when spoken to.

## Architecture

### Core Components
- **Slack Adapter**: Listens to ALL messages in joined channels using Socket Mode
- **Orchestrator**: Three-stage pipeline (classify → extract → respond)
- **StateStore**: JSON file-based state storage (channels, threads, processed messages)

### Pipeline Stages
- **MessageClassifier**: Pattern-based detection of standups, commitments, tasks, blockers
- **KnowledgeExtractor**: Uses Haiku to extract structured data from messages
- **ContextAssembler**: Builds context from thread, channel, wiki, and cross-channel sources

### Support Components
- **AttentionTracker**: Manages engagement state per thread (active vs passive)
- **ConstitutionManager**: Two-layer constitution (immutable base + mutable learned behaviors)
- **StandupTracker**: Tracks commitments and follow-ups with fuzzy text matching
- **ConversationLogger**: Stores all messages in markdown files organized by channel/date
- **WikiManager**: Manages the scribble-wiki Git repository
- **LinearTools**: Ticket suggestion with confirmation pattern (never auto-creates)

## Message Flow

1. **Classify**: Determine engagement (mention, name, active thread, DM) and message type
2. **Extract**: Mine facts, tasks, decisions, blockers from every message (passive)
3. **Respond**: Only when engaged - assemble context and generate response

## Directory Structure

```
/app/data/
├── state/                    # StateStore JSON files
│   ├── channels.json         # Channel membership tracking
│   ├── active-threads.json   # Currently engaged conversations
│   └── processed/            # Message deduplication by date
│       └── {YYYY-MM-DD}.json
├── conversations/            # Logged conversations
│   └── {channel_id}/
│       └── {date}/
│           └── {thread_ts}.md
├── standups/                 # Standup commitment tracking
│   └── {person}/
│       └── {date}.md
├── constitution/             # Constitution files
│   ├── learned.md            # Mutable behaviors
│   └── changelog.md          # Modification history
├── wiki/                     # Cloned wiki repository (Git)
│   ├── knowledge/
│   │   ├── people/
│   │   ├── projects/
│   │   ├── decisions/
│   │   └── processes/
│   └── _scribble/
│       ├── constitution-base.md
│       └── constitution-learned.md
└── downloads/                # Downloaded file attachments
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
- `LINEAR_API_KEY` - Linear API key for ticket creation (suggest_linear_ticket tool)
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
