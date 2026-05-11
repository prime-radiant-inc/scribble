# Scribble Bot

Scribble is a company-wide Slack bot that acts as a diligent colleague. It watches conversations, maintains documentation, tracks tasks, and helps the team stay organized. It engages when mentioned, spoken to by name, or in active threads.

## Architecture

Scribble uses a modern architecture built on `@primeradianthq/bot-toolkit` and the Claude Agent SDK:

### Core Components
- **SlackAdapterSDK**: Listens to messages via Socket Mode with engagement-based filtering
- **ConversationOrchestrator** (from `@primeradianthq/bot-toolkit`): Routes messages to Claude via Agent SDK
- **ClaudeSessionManagerSDK** (from `@primeradianthq/bot-toolkit`): Manages resumable conversation sessions
- **scribble-mcp**: MCP server providing wiki, learning, and conversation tools
- **@primeradianthq/streamlinear**: External MCP server for Linear ticket operations (search, get, update, comment, create)

### Engagement System
- **AttentionTracker** (from `@primeradianthq/bot-toolkit`): Manages engagement state per thread
- Engages on: @mentions, DMs, configured bot name/alias mentions, active threads
- Disengages on: configured dismissal patterns such as "thanks <bot alias>", "got it", etc.
- Thread timeout: 30 minutes of inactivity

### Support Components
- **ConstitutionManager**: Two-layer constitution (immutable base + mutable learned behaviors)
- **ConversationLogger**: Stores messages in markdown files organized by channel/date
- **WikiManager**: Manages the configured wiki Git repository
- **StreamLinear MCP**: Linear ticket integration via external `@primeradianthq/streamlinear` MCP server

## Message Flow

1. **Receive**: SlackAdapterSDK receives message via Bolt Socket Mode
2. **Engage**: AttentionTracker checks if message warrants engagement:
   - @mention or DM: always engage
   - Configured bot name/alias mention: engage and track thread
   - Active thread: continue engagement
   - Dismissal pattern: disengage from thread
3. **Route**: ScribbleOrchestrator sends message to Claude via Agent SDK session
4. **Tools**: Claude accesses scribble-mcp tools for wiki, learning operations and streamlinear MCP for Linear operations
5. **Engage**: Claude calls the `respond` tool to signal its engagement decision:
   - `directed_at_me=true` + message → orchestrator posts response to Slack
   - `directed_at_me=false` → orchestrator stays silent
   - If Claude generates freeform text without calling `respond`, the orchestrator retries once with a system-reminder
6. **Side effects**: Other intercepted tools (e.g., `log_decision`) are processed after the engagement decision

## MCP Tools (scribble-mcp)

Tools come from two MCP servers: `scribble-mcp` (defined in `src/mcp/index.ts`) and `streamlinear` (from `@primeradianthq/streamlinear`).

### Engagement Tools (intercepted by orchestrator)
| Tool | Description |
|------|-------------|
| `respond` | **Required for every message.** Sends visible responses to Slack. Claude must call this with `directed_at_me=true/false` to signal engagement decisions. |
| `log_decision` | Log a business decision to the configured decision-log channel with permalink and tags |

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

### Linear Tools (via streamlinear MCP, when LINEAR_API_KEY is set)
| Tool | Description |
|------|-------------|
| `linear` | Single tool with action dispatch: search, get, update, comment, create, graphql, help |

Linear operations use the external `@primeradianthq/streamlinear` MCP server installed from npm. Docker uses the packaged entrypoint at `/app/node_modules/.bin/streamlinear`. The `LINEAR_API_KEY` env var is stored in generated secrets as `LINEAR_API_TOKEN` for streamlinear. When scribble creates or updates a ticket, it responds affirmatively rather than using a silent checkmark reaction.

### Channel Management
| Tool | Description |
|------|-------------|
| `leave_channel` | Request to leave a Slack channel |

## Directory Structure

```
{DATA_DIRECTORY}/
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
└── wiki/                     # Cloned wiki repository (Git)
    ├── knowledge/
    │   ├── people/
    │   ├── projects/
    │   ├── decisions/
    │   └── processes/
    └── _scribble/            # Constitution and channel instructions live here
        ├── constitution-learned.json  # Mutable behaviors
        ├── constitution-log.json      # Modification history
        └── channel-instructions.json  # Channel-specific instructions
```

## Development

```bash
npm install
npm run build       # Compile TypeScript
npm run build:mcp   # Bundle MCP server
npm run build:all   # Compile TypeScript and bundle MCP server
npm run dev         # Development mode with tsx
npm run dev:mcp     # Run MCP server in dev mode
npm start           # Run production build
npm test            # Run tests
```

### MCP Tool Name Prefixing (Important)

The Agent SDK prefixes MCP tool names as `mcp__{server-name}__{tool-name}`. When the `onToolUse` callback fires in bot-toolkit's `sessionManagerSDK.ts`, tool names arrive as e.g. `mcp__scribble-mcp__respond`, not `respond`.

The orchestrator strips this prefix before matching:
```typescript
const toolName = name.includes('__') ? name.split('__').pop()! : name;
```

If you add a new tool and the orchestrator doesn't recognize it, check the prefix.

### Adding a New Intercepted Tool

For tools where the real logic happens in the orchestrator (like `respond` and `log_decision`):

1. **Parser** (`src/core/responseSchema.ts`): Define input interface + parse function returning `null` on invalid input. Add tests in `src/core/__tests__/responseSchema.test.ts`.
2. **MCP tool** (`src/mcp/index.ts`): Define params with zod. Handler returns acknowledgment text only — real work is in the orchestrator.
3. **Orchestrator** (`src/orchestrator/scribbleOrchestrator.ts`): Intercept in `createEngagementCallbacks()` → `onToolUse` (matching the stripped tool name). Add to `WRITE_TOOLS` if it mutates state. Add post-processing called from all three handlers.
4. **Constitution** (`src/constitution/base.ts`): Add usage guidance. For mandatory tools, put instructions at TOP and BOTTOM of the prompt.
5. **Tests** (`src/orchestrator/__tests__/scribbleOrchestrator.test.ts`): Tests use bare tool names which work because the prefix-stripping handles both forms.

## Deployment

This repo does not deploy any infrastructure. CI runs build, tests, and a Docker smoke check; nothing in this repo pushes images or touches production.

The repo-local `Dockerfile` and `docker/entrypoint-scribble.sh` are the Scribble runtime contract — operators wire those up to run Scribble in their own environment, owning image build, secrets, and runtime topology in their own pipeline.

**bot-toolkit changes:** Scribble consumes `@primeradianthq/bot-toolkit` from npm. Bot-toolkit changes reach Scribble through an intentional dependency/lockfile update, not through any out-of-band deployment trigger.

## Environment Variables

Required:
- `SLACK_BOT_TOKEN` - Slack bot OAuth token (xoxb-...)
- `SLACK_APP_TOKEN` - Slack app-level token (xapp-...)
- `ANTHROPIC_API_KEY` - Anthropic API key

Optional:
- `WIKI_REPO` - GitHub wiki repo in `owner/name` form; required, no default
- `GITHUB_TOKEN` - GitHub token for wiki access
- `LINEAR_API_KEY` - Linear API key (stored as `LINEAR_API_TOKEN` for the streamlinear MCP server)
- `STREAMLINEAR_MCP_PATH` - Local-development or nonstandard path to the streamlinear MCP entrypoint; Docker uses `/app/node_modules/.bin/streamlinear`
- `DATA_DIRECTORY` - Data storage path (default: ./data locally, /data in Docker)
- `LOG_LEVEL` - Logging level (default: info)
- `TZ` - Timezone (default: America/Los_Angeles)
- `SCRIBBLE_ORG_NAME` - Workspace/company name used in prompts (default: Prime Radiant)
- `SCRIBBLE_BOT_NAME` - Runtime bot name used in prompts and engagement aliases (default: Scribble)
- `SCRIBBLE_BOT_ALIASES` - Comma-separated names that trigger engagement (default: scribble,scrib)
- `SCRIBBLE_DECISION_LOG_CHANNEL` - Decision-log channel name or ID (default: decision-log)
- `SCRIBBLE_WIKI_GIT_AUTHOR_NAME` - Git author name for wiki commits (default: Scribble Bot)
- `SCRIBBLE_WIKI_GIT_AUTHOR_EMAIL` - Git author email for wiki commits (default: scribble-bot@invalid; public examples should set this to an operator-owned address such as `scribble@example.com`)

Optional (Telemetry):
- `OTEL_ENABLED` - Enable OpenTelemetry (default: false)
- `PROMETHEUS_PORT` - Port for Prometheus metrics (default: 9464)
- `LOG_FORMAT` - Log format: 'json' for structured, omit for human-readable

## Dependencies

Scribble depends on:
- **@primeradianthq/bot-toolkit**: Session management, orchestration, attention tracking, and Claude Agent SDK session handling.
- **@modelcontextprotocol/sdk**: MCP server framework
- **@slack/bolt**: Slack app framework
- **@primeradianthq/streamlinear** (external MCP installed from npm): Linear ticket operations

Docker builds install bot-toolkit and streamlinear from npm through the package lockfile; no sibling source checkout is required for those packages.

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
