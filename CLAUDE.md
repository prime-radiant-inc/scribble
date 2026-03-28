# Scribble Bot

Scribble is a company-wide Slack bot that acts as a diligent colleague. It watches conversations, maintains documentation, tracks tasks, and helps the team stay organized. It engages when mentioned, spoken to by name, or in active threads.

## Architecture

Scribble uses a modern architecture built on bot-toolkit and the Claude Agent SDK:

### Core Components
- **SlackAdapterSDK**: Listens to messages via Socket Mode with engagement-based filtering
- **ConversationOrchestrator** (from bot-toolkit): Routes messages to Claude via Agent SDK
- **ClaudeSessionManagerSDK** (from bot-toolkit): Manages resumable conversation sessions
- **scribble-mcp**: MCP server providing wiki, learning, and conversation tools
- **streamlinear**: External MCP server for Linear ticket operations (search, get, update, comment, create)

### Engagement System
- **AttentionTracker** (from bot-toolkit): Manages engagement state per thread
- Engages on: @mentions, DMs, name mentions ("scribble", "scrib"), active threads
- Disengages on: dismissal patterns ("thanks scrib", "got it", etc.)
- Thread timeout: 30 minutes of inactivity

### Support Components
- **ConstitutionManager**: Two-layer constitution (immutable base + mutable learned behaviors)
- **ConversationLogger**: Stores messages in markdown files organized by channel/date
- **WikiManager**: Manages the scribble-wiki Git repository
- **StreamLinear MCP**: Linear ticket integration via external `streamlinear` MCP server

## Message Flow

1. **Receive**: SlackAdapterSDK receives message via Bolt Socket Mode
2. **Engage**: AttentionTracker checks if message warrants engagement:
   - @mention or DM: always engage
   - Name mention ("scribble", "scrib"): engage and track thread
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

Tools come from two MCP servers: `scribble-mcp` (defined in `src/mcp/index.ts`) and `streamlinear` (external package).

### Engagement Tools (intercepted by orchestrator)
| Tool | Description |
|------|-------------|
| `respond` | **Required for every message.** Sends visible responses to Slack. Claude must call this with `directed_at_me=true/false` to signal engagement decisions. |
| `log_decision` | Log a business decision to #decision-log with permalink and tags |

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

Linear operations use the external `streamlinear` MCP server (bundled at `/app/lib/streamlinear-mcp.js` at build time). The `LINEAR_API_KEY` env var is mapped to `LINEAR_API_TOKEN` in `createInstanceConfig()`. When scribble creates or updates a ticket, it responds affirmatively rather than using a silent checkmark reaction.

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

**bot-toolkit changes:** bot-toolkit is a standalone repo (`prime-radiant-inc/bot-toolkit`) included as a git submodule at `lib/bot-toolkit/`. Pushes to bot-toolkit main automatically trigger a scribble rebuild. To sync locally: `npm run sync-toolkit`.

**Infrastructure changes:** Dockerfile and entrypoint are in sen-deploy, not this repo. Use the same manual trigger above if you change `docker/Dockerfile.scribble` or `docker/entrypoint-scribble.sh`.

The scribble service runs on ECS Fargate (not EC2 like user PA services).

## Environment Variables

Required:
- `SLACK_BOT_TOKEN` - Slack bot OAuth token (xoxb-...)
- `SLACK_APP_TOKEN` - Slack app-level token (xapp-...)
- `ANTHROPIC_API_KEY` - Anthropic API key

Optional:
- `WIKI_REPO` - GitHub wiki repo (default: prime-radiant-inc/scribble-wiki)
- `GITHUB_TOKEN` - GitHub token for wiki access
- `LINEAR_API_KEY` - Linear API key (mapped to `LINEAR_API_TOKEN` for the streamlinear MCP server)
- `DATA_DIRECTORY` - Data storage path (default: ./data)
- `LOG_LEVEL` - Logging level (default: info)
- `TZ` - Timezone (default: America/Los_Angeles)

Optional (Telemetry):
- `OTEL_ENABLED` - Enable OpenTelemetry (default: false)
- `PROMETHEUS_PORT` - Port for Prometheus metrics (default: 9464)
- `LOG_FORMAT` - Log format: 'json' for structured, omit for human-readable

## Dependencies

Scribble depends on:
- **bot-toolkit** (standalone repo at `prime-radiant-inc/bot-toolkit`, submodule at `lib/bot-toolkit/`): Session management, orchestration, attention tracking. Pushes to bot-toolkit main auto-trigger rebuild.
- **@anthropic-ai/claude-agent-sdk**: Claude Agent SDK for conversation sessions
- **@modelcontextprotocol/sdk**: MCP server framework
- **@slack/bolt**: Slack app framework
- **streamlinear** (external MCP, installed via npx at runtime): Linear ticket operations

The Docker build uses pnpm strict mode — all dependencies must be explicitly declared in `package.json` (transitive deps are not hoisted).

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
