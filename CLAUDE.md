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
- **StreamLinearTools**: Linear ticket integration via StreamLinear MCP (suggest/confirm pattern)

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
- `DATA_DIRECTORY` - Data storage path (default: ./data)
- `LOG_LEVEL` - Logging level (default: info)

Optional (Telemetry):
- `OTEL_ENABLED` - Enable OpenTelemetry (default: false)
- `PROMETHEUS_PORT` - Port for Prometheus metrics (default: 9464)
- `LOG_FORMAT` - Log format: 'json' for structured, omit for human-readable

## Learning Tools

Scribble can learn persistent behaviors via these tools:

- **`learn_behavior`**: Add a global behavioral rule (e.g., "always format code blocks", "never auto-create tickets")
- **`set_channel_instruction`**: Add a channel-specific rule (e.g., "in #standup, track all commitments")
- **`list_learned_behaviors`**: Show all learned behaviors
- **`list_channel_instructions`**: Show channel-specific instructions

These are stored in the wiki's `_scribble/` directory and persist across restarts.

## Prometheus Metrics

When `OTEL_ENABLED=true`, metrics are exposed on `PROMETHEUS_PORT` (default 9464):

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `scribble_messages_processed_total` | Counter | channel, type | Messages processed |
| `scribble_message_processing_duration_seconds` | Histogram | channel | Processing time |
| `scribble_tool_executions_total` | Counter | tool, status | Tool calls (success/error) |
| `scribble_tool_execution_duration_seconds` | Histogram | tool | Tool execution time |
| `scribble_api_calls_total` | Counter | model | Claude API calls |
| `scribble_api_call_duration_seconds` | Histogram | model | API call duration |
| `scribble_api_errors_total` | Counter | type | API/processing errors |
| `scribble_wiki_operations_total` | Counter | operation | Wiki writes/deletes/renames/commits |
| `scribble_behaviors_learned_total` | Counter | - | Behaviors added |
| `scribble_channel_instructions_set_total` | Counter | channel | Channel instructions added |

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
