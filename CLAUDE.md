# Scribble Bot

Scribble is a company-wide Slack bot that acts as a diligent colleague. It watches conversations, maintains documentation, tracks tasks, and helps the team stay organized. It engages when mentioned, spoken to by name, or in active threads.

## Architecture

Scribble uses a modern architecture built on bot-toolkit and the Claude Agent SDK:

### Core Components
- **SlackAdapterSDK**: Listens to messages via Socket Mode with engagement-based filtering
- **ConversationOrchestrator** (from bot-toolkit): Routes messages to Claude via Agent SDK
- **ClaudeSessionManagerSDK** (from bot-toolkit): Manages resumable conversation sessions
- **scribble-mcp**: MCP server providing wiki, linear, learning, and conversation tools

### Engagement System
- **AttentionTracker** (from bot-toolkit): Manages engagement state per thread
- Engages on: @mentions, DMs, name mentions ("scribble", "scrib"), active threads
- Disengages on: dismissal patterns ("thanks scrib", "got it", etc.)
- Thread timeout: 30 minutes of inactivity

### Support Components
- **ConstitutionManager**: Two-layer constitution (immutable base + mutable learned behaviors)
- **ConversationLogger**: Stores messages in markdown files organized by channel/date
- **WikiManager**: Manages the scribble-wiki Git repository
- **StreamLinearTools**: Linear ticket integration via suggest/confirm pattern

## Message Flow

1. **Receive**: SlackAdapterSDK receives message via Bolt Socket Mode
2. **Engage**: AttentionTracker checks if message warrants engagement:
   - @mention or DM: always engage
   - Name mention ("scribble", "scrib"): engage and track thread
   - Active thread: continue engagement
   - Dismissal pattern: disengage from thread
3. **Route**: ConversationOrchestrator sends message to Claude via Agent SDK session
4. **Tools**: Claude accesses scribble-mcp tools for wiki, linear, learning operations
5. **Respond**: SlackResponderSDK sends response back to thread

## MCP Tools (scribble-mcp)

The MCP server provides 18 tools across four categories:

### Wiki Tools
| Tool | Description |
|------|-------------|
| `wiki_create` | Create or update a wiki entry |
| `wiki_read` | Read a wiki entry |
| `wiki_edit` | Edit an existing wiki entry (full replacement) |
| `wiki_delete` | Delete a wiki entry |
| `wiki_rename` | Rename/move a wiki entry |
| `wiki_search` | Search wiki content |
| `wiki_list` | List all wiki pages (optionally by category) |
| `wiki_history` | Get commit history for a wiki entry |
| `wiki_read_version` | Read a specific version from git history |

### Conversation Tools
| Tool | Description |
|------|-------------|
| `conversation_search` | Search past Slack conversations |

### Learning Tools
| Tool | Description |
|------|-------------|
| `learn_behavior` | Add a persistent global behavioral rule |
| `list_behaviors` | List all learned behaviors |
| `set_channel_instruction` | Add a channel-specific standing instruction |
| `list_channel_instructions` | List channel-specific instructions |

### Linear Tools (when LINEAR_API_KEY is set)
| Tool | Description |
|------|-------------|
| `linear_search` | Search Linear issues |
| `linear_suggest` | Suggest creating a ticket (requires confirmation) |
| `linear_confirm` | Confirm and create a previously suggested ticket |
| `linear_cancel` | Cancel a ticket suggestion |

### Channel Management
| Tool | Description |
|------|-------------|
| `leave_channel` | Request to leave a Slack channel |

## Directory Structure

```
/app/data/
├── config/                   # Generated bot-toolkit config
│   ├── instance.json         # MCP server configuration
│   └── secrets.json          # Runtime secrets
├── sessions.db               # SQLite database (sessions, attention tracking)
├── rooms/                    # Per-channel/thread data (from bot-toolkit)
│   └── slack-{channel_id}/
│       ├── downloads/        # Downloaded attachments
│       └── messages/         # Raw message logs
├── conversations/            # Logged conversations
│   └── {channel_id}/
│       └── {date}/
│           └── {thread_ts}.md
├── constitution/             # Constitution files
│   ├── learned.md            # Mutable behaviors
│   └── changelog.md          # Modification history
└── wiki/                     # Cloned wiki repository (Git)
    ├── knowledge/
    │   ├── people/
    │   ├── projects/
    │   ├── decisions/
    │   └── processes/
    └── _scribble/
        ├── constitution-base.md
        └── constitution-learned.md
```

## Development

```bash
npm install
npm run build       # Compile TypeScript
npm run build:mcp   # Bundle MCP server
npm run dev         # Development mode with tsx
npm run dev:mcp     # Run MCP server in dev mode
npm start           # Run production build
npm test            # Run tests
```

## Deployment

Scribble auto-deploys when you push to `main`. The workflow:

1. Push to `prime-radiant-inc/scribble` main branch
2. `.github/workflows/trigger-build.yml` sends `repository_dispatch` to sen-deploy
3. sen-deploy's `build-parallel.yml` builds the scribble Docker image
4. Image is pushed to ECR and deployed to ECS Fargate

**To deploy:** Just push to main. No manual steps needed.

```bash
git push origin main
# Watch deployment: gh run list -R prime-radiant-inc/sen-deploy
```

The scribble service runs on ECS Fargate (not EC2 like user PA services).

## Environment Variables

Required:
- `SLACK_BOT_TOKEN` - Slack bot OAuth token (xoxb-...)
- `SLACK_APP_TOKEN` - Slack app-level token (xapp-...)
- `ANTHROPIC_API_KEY` - Anthropic API key

Optional:
- `WIKI_REPO` - GitHub wiki repo (default: prime-radiant-inc/scribble-wiki)
- `GITHUB_TOKEN` - GitHub token for wiki access
- `LINEAR_API_KEY` - Linear API key for ticket integration
- `DATA_DIRECTORY` - Data storage path (default: ./data)
- `LOG_LEVEL` - Logging level (default: info)
- `TZ` - Timezone (default: America/Los_Angeles)

Optional (Telemetry):
- `OTEL_ENABLED` - Enable OpenTelemetry (default: false)
- `PROMETHEUS_PORT` - Port for Prometheus metrics (default: 9464)
- `LOG_FORMAT` - Log format: 'json' for structured, omit for human-readable

## Dependencies

Scribble depends on:
- **bot-toolkit** (local): Session management, orchestration, attention tracking
- **@anthropic-ai/claude-agent-sdk**: Claude Agent SDK for conversation sessions
- **@modelcontextprotocol/sdk**: MCP server framework
- **@slack/bolt**: Slack app framework
- **@linear/sdk**: Linear API client

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
