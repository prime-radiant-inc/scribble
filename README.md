# Scribble

Prime Radiant's company-wide Slack knowledge bot.

Scribble reads all messages in public channels, mines conversations for facts/tasks/issues, maintains the company wiki, and helps team members find information.

## Features

- **Passive Listening**: Reads all messages in joined public channels
- **Knowledge Mining**: Extracts facts, decisions, tasks, and issues using Claude AI
- **Wiki Maintenance**: Automatically updates the `scribble-wiki` repository
- **Interactive Help**: Responds to @mentions and DMs with context-aware answers
- **Conversation Search**: Helps find information across logged conversations

## Quick Start

### 1. Create the Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App**
3. Select **From an app manifest**
4. Choose your workspace
5. Paste the contents of [`slack-app-manifest.yaml`](./slack-app-manifest.yaml)
6. Click **Create**

### 2. Configure the App

After creating the app:

1. **Install to Workspace**
   - Go to **Install App** in the sidebar
   - Click **Install to Workspace**
   - Authorize the requested permissions
   - Copy the **Bot User OAuth Token** (`xoxb-...`)

2. **Enable Socket Mode**
   - Go to **Socket Mode** in the sidebar
   - Toggle **Enable Socket Mode** ON
   - Click **Generate** to create an app-level token
   - Name it `scribble-socket` with scope `connections:write`
   - Copy the **App-Level Token** (`xapp-...`)

3. **Verify Event Subscriptions**
   - Go to **Event Subscriptions**
   - Ensure it's enabled (should be from manifest)
   - Verify all bot events are listed

### 3. Set Up Secrets

Create SSM parameters in AWS (or use `.env` for local development):

```bash
# Required: Slack credentials
aws ssm put-parameter \
  --name "/sen/scribble/SLACK_BOT_TOKEN" \
  --type SecureString \
  --value "xoxb-YOUR-BOT-TOKEN"

aws ssm put-parameter \
  --name "/sen/scribble/SLACK_APP_TOKEN" \
  --type SecureString \
  --value "xapp-YOUR-APP-TOKEN"

# Required: Anthropic API key
aws ssm put-parameter \
  --name "/sen/scribble/ANTHROPIC_API_KEY" \
  --type SecureString \
  --value "sk-ant-YOUR-KEY"

# Required: GitHub token (for wiki repo access)
# Create at: https://github.com/settings/tokens
# Scopes needed: repo (full access to private repos)
aws ssm put-parameter \
  --name "/sen/scribble/GITHUB_TOKEN" \
  --type SecureString \
  --value "ghp_YOUR-TOKEN"

# Optional: Linear API key (for future integration)
aws ssm put-parameter \
  --name "/sen/scribble/LINEAR_API_KEY" \
  --type SecureString \
  --value "lin_api_YOUR-KEY"
```

### 4. Deploy

Deploy via Terraform (in `sen-deploy` repo):

```bash
cd sen-deploy/terraform
terraform apply
```

Or run locally for development:

```bash
# Create .env file
cat > .env << EOF
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
ANTHROPIC_API_KEY=sk-ant-...
GITHUB_TOKEN=ghp_...
EOF

# Install and run
npm install
npm run dev
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Slack Workspace                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│  │ #general │ │ #eng     │ │ #random  │ │ DMs      │            │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘            │
└───────┼────────────┼────────────┼────────────┼──────────────────┘
        │            │            │            │
        └────────────┴────────────┴────────────┘
                           │
                    Socket Mode
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Scribble Bot                              │
│                                                                  │
│  ┌─────────────────┐    ┌─────────────────┐                     │
│  │  Slack Adapter  │───▶│   Orchestrator  │                     │
│  │  (all messages) │    │                 │                     │
│  └─────────────────┘    └───────┬─────────┘                     │
│                                 │                                │
│           ┌─────────────────────┼─────────────────────┐         │
│           │                     │                     │         │
│           ▼                     ▼                     ▼         │
│  ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐│
│  │  Conversation   │   │   Claude API    │   │  Wiki Manager   ││
│  │     Logger      │   │   (Haiku)       │   │   (Git ops)     ││
│  └────────┬────────┘   └────────┬────────┘   └────────┬────────┘│
│           │                     │                     │         │
│           ▼                     │                     ▼         │
│  ┌─────────────────┐            │            ┌─────────────────┐│
│  │   /app/data/    │            │            │  scribble-wiki  ││
│  │  conversations/ │            │            │   (GitHub)      ││
│  └─────────────────┘            │            └─────────────────┘│
│                                 │                                │
│                                 ▼                                │
│                        ┌─────────────────┐                      │
│                        │    Responses    │                      │
│                        │  (@mentions/DMs)│                      │
│                        └─────────────────┘                      │
└─────────────────────────────────────────────────────────────────┘
```

### Message Flow

1. **All Messages** → Logged to `conversations/{channel}/{date}/{thread}.md`
2. **Background Mining** → Haiku extracts facts → Wiki updates
3. **Interactive (@mention/DM)** → Haiku responds with context

## Slack App Configuration Reference

### OAuth Scopes (Bot Token)

| Scope | Purpose |
|-------|---------|
| `channels:history` | Read messages in public channels |
| `channels:join` | Auto-join public channels on startup |
| `channels:read` | List channels and get channel info |
| `groups:history` | Read messages in private channels (when invited) |
| `groups:read` | List private channels bot is member of |
| `im:history` | Read direct message history |
| `im:read` | List DM conversations |
| `im:write` | Send direct messages |
| `mpim:history` | Read group DM history |
| `mpim:read` | List group DM conversations |
| `chat:write` | Send messages and replies |
| `chat:write.public` | Send to channels bot isn't member of |
| `files:read` | Access file metadata and download |
| `files:write` | Upload files |
| `reactions:read` | Read emoji reactions on messages |
| `reactions:write` | Add reactions (processing indicators) |
| `users:read` | Get user info (names, profiles) |
| `users:read.email` | Get user emails (for attribution) |
| `app_mentions:read` | Receive @scribble mentions |

### Event Subscriptions

| Event | Purpose |
|-------|---------|
| `message.channels` | Messages posted in public channels |
| `message.groups` | Messages posted in private channels |
| `message.im` | Direct messages to bot |
| `message.mpim` | Group DM messages |
| `app_mention` | When someone @mentions Scribble |
| `member_joined_channel` | Bot added to a channel |
| `channel_left` | Bot removed from a channel |
| `reaction_added` | (Optional) Track emoji reactions |
| `user_change` | (Optional) Track profile updates |

### Socket Mode

Socket Mode is **required** for Scribble. It allows the bot to receive events via WebSocket without needing a public URL or webhook endpoint.

**App-Level Token Scope**: `connections:write`

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SLACK_BOT_TOKEN` | Yes | Bot OAuth token (`xoxb-...`) |
| `SLACK_APP_TOKEN` | Yes | App-level token for Socket Mode (`xapp-...`) |
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key for Claude |
| `GITHUB_TOKEN` | Yes | GitHub PAT for wiki repo access |
| `WIKI_REPO` | No | Wiki repo (default: `prime-radiant-inc/scribble-wiki`) |
| `LINEAR_API_KEY` | No | Linear API key (future use) |
| `DATA_DIRECTORY` | No | Data storage path (default: `./data`) |
| `DATABASE_PATH` | No | SQLite DB path (default: `{DATA_DIRECTORY}/scribble.db`) |
| `LOG_LEVEL` | No | Logging level: `debug`, `info`, `warn`, `error` |

## Data Storage

```
/app/data/
├── scribble.db              # SQLite: dedup, channel tracking, metadata
├── conversations/           # Logged conversations (markdown)
│   └── {channel_id}/
│       └── {YYYY-MM-DD}/
│           └── {thread_ts}.md
├── wiki/                    # Cloned scribble-wiki repository
│   ├── knowledge/
│   │   ├── projects/
│   │   ├── people/
│   │   ├── decisions/
│   │   └── processes/
│   ├── tasks/
│   │   ├── open/
│   │   └── completed/
│   └── issues/
│       ├── open/
│       └── resolved/
└── downloads/               # Downloaded file attachments
    └── {channel_id}/
```

## Development

```bash
# Install dependencies
npm install

# Run in development mode (with hot reload)
npm run dev

# Build for production
npm run build

# Run production build
npm start

# Run tests
npm test
```

## Deployment

Scribble runs as a single ECS Fargate task with:
- 512 CPU units (0.5 vCPU)
- 1024 MB memory
- EFS volume for persistent data
- No load balancer (Socket Mode connects outbound)

Infrastructure is managed in the `sen-deploy` repository.

## Wiki Repository

The wiki is stored in `prime-radiant-inc/scribble-wiki`:

- **knowledge/** - Facts extracted from conversations
- **tasks/** - Action items and todos
- **issues/** - Problems and blockers

Scribble automatically commits changes with descriptive messages.

## Privacy & Security

- Scribble only reads public channels and channels it's invited to
- Slack Connect (external) users are ignored
- Conversation logs are stored on encrypted EFS
- No data is shared outside the organization
- Wiki repo is private

## Troubleshooting

### Bot not receiving messages

1. Check Socket Mode is enabled
2. Verify event subscriptions are configured
3. Ensure bot is a member of the channel
4. Check CloudWatch logs for errors

### Bot not joining channels

1. Verify `channels:join` scope is granted
2. Check the bot was reinstalled after scope changes
3. Look for errors in startup logs

### Wiki updates failing

1. Verify `GITHUB_TOKEN` has `repo` scope
2. Check the token hasn't expired
3. Ensure wiki repo exists and is accessible
