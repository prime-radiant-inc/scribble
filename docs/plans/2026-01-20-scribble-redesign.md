# Scribble Redesign

## Overview

Scribble is a company-wide Slack bot that acts as a diligent colleague. It watches every conversation, extracts knowledge, maintains documentation, tracks tasks, and helps the team stay organized—but only speaks when spoken to.

## Core Mental Model

Scribble behaves like a human team member who happens to be in every channel with perfect memory.

**Always watching, rarely speaking.** Scribble reads every message and notes:
- Tasks and commitments people make
- Information about projects, people, decisions, processes
- Blockers and issues that need tracking
- Standup commitments to follow up on

**Speaks only when addressed.** Scribble enters active mode when:
- @mentioned
- Its name is used ("hey Scribble", "Scribble, can you...")
- Already engaged in an active thread conversation

**Stays engaged intelligently.** Once active in a thread:
- Continues paying attention for a reasonable time window
- Detects when topic drifts away from its involvement
- Understands async Slack rhythms (doesn't assume silence = done)
- Exits when dismissed ("Scribble, be quiet", "thanks Scribble")

**Cross-channel awareness.** When responding, Scribble can reference relevant context from other channels, always clearly attributed: "Drew mentioned something about this in #engineering yesterday..."

## Data Routing

| Category | Destination | Example |
|----------|-------------|---------|
| Tasks, issues, blockers | Linear (StreamLinear MCP) | "We need to fix the login bug" → offer to create ticket |
| Projects | Linear + Wiki | Status in Linear, context/decisions in wiki |
| People | Wiki | "Sarah is the expert on auth" → update Sarah's page |
| Decisions | Wiki | "We decided to use Postgres" → add to decisions page |
| Processes | Wiki | "Deploys are Fridays now" → update deploy process page |
| Standup commitments | Text files | Track for next-day follow-up |
| Conversation context | Text files | For search and response context |

## Storage

All storage is text files—grep-able, human-readable, version-controllable.

```
data/
  conversations/
    {channel}/
      {date}/
        {thread}.md           # Conversation logs
  standups/
    {person}/
      {date}.md               # Standup commitments (YAML + markdown)
  state/
    active-threads.json       # Currently engaged conversations

wiki/                         # Git repo: prime-radiant-inc/scribble-wiki
  knowledge/
    people/
    projects/
    decisions/
    processes/
  _scribble/
    constitution-base.md      # Immutable (reference copy)
    constitution-learned.md   # Mutable behaviors Scribble can edit
    constitution-log.md       # Change history
```

## Engagement and Attention

### Triggering Active Mode

```
Message arrives
  → Contains @scribble? → ACTIVE
  → Contains "scribble" (case-insensitive)? → ACTIVE
  → In a thread where Scribble is already active? → ACTIVE
  → Otherwise → PASSIVE (watch, extract, stay quiet)
```

### Tracking Active Threads

For each active thread, Scribble tracks:
- `thread_id`: Which thread
- `last_engaged`: Timestamp of last interaction
- `topic_summary`: What the conversation is about
- `participants`: Who's involved

### Disengaging

Scribble exits active mode when:
- Explicitly dismissed ("Scribble, be quiet", "thanks Scribble", "that's all")
- Thread goes quiet for extended time (hours, not minutes—Slack is async)
- Topic clearly drifts to something unrelated
- Conversation naturally concludes

Attention is per-thread, not per-channel. Scribble can be active in multiple threads simultaneously.

## Context Assembly for Responses

When Scribble responds, it assembles context in priority order:

1. **Primary - Current thread**: All messages in the active thread
2. **Secondary - Channel recent**: Last N messages in main channel
3. **Tertiary - Cross-channel**: Topically related recent messages from other channels, clearly attributed
4. **Reference - Wiki**: Relevant wiki pages
5. **Reference - Linear**: Relevant tickets/projects

### Cross-Channel Attribution

When including context from other channels:
```
[From #engineering, yesterday]
Drew: "The auth refactor is blocked on the API changes"
```

### Context Budget

Haiku has limited context. The system:
- Prioritizes recent over old
- Prioritizes same-channel over cross-channel
- Summarizes older context rather than including verbatim
- Always includes current thread in full

## Standup Tracking

### Detection (Hybrid)

Scribble identifies standups by:
- **Channel**: Designated standup channel(s)
- **Content patterns**: Messages with yesterday/today/blockers format, commitment language
- **Time**: Morning hours, but flexible for late posters

### Extraction

From each standup:
- **Person**: Who posted
- **Date**: When
- **Commitments**: What they said they'd do
- **Blockers**: Anything flagged as blocking
- **Completed**: What they said they finished

### Follow-up

When someone posts their next standup, Scribble replies in thread:
- References yesterday's commitments
- Asks for status on incomplete items
- Tone: helpful colleague ("How'd the auth refactor go?"), not interrogation

Edge cases:
- Person skips a day: No follow-up
- No commitments yesterday: No follow-up needed
- Already addressed in standup: Don't repeat

## Linear Integration

Via StreamLinear MCP from github.com/obra.

**Approach: Proactive but confirms.**

Scribble notices something that sounds like a task or issue and asks: "Want me to create a Linear ticket for that?"

Never creates tickets without confirmation.

Tools:
- `search_linear(query)` - Find relevant tickets/projects
- `suggest_linear_ticket(title, description)` - Propose creating (requires confirmation)

## The Constitution

Scribble runs on Haiku, which needs clear, detailed instructions.

### Two-Layer Structure

**Immutable (hardcoded in source):**
- Core identity: diligent colleague, not assistant or chatbot
- Safety: no sharing private channel content inappropriately
- Engagement fundamentals: only speak when addressed

**Mutable (Scribble can modify):**
- Response style preferences
- Domain knowledge
- Workflow preferences
- Channel-specific behaviors
- Follow-up timing

### Modification Flow

1. Someone says "Scribble, remember to X" or Scribble proposes a change
2. Scribble confirms: "I'll add to my learned behaviors: [X]. Sound right?"
3. On confirmation, updates `constitution-learned.md`
4. Logs change with timestamp, requester, reasoning

### Constitution Contents

1. **Identity**: Who Scribble is
2. **Core behaviors**: Always watching, only speaks when addressed
3. **Engagement rules**: When to respond, when to stay quiet, how to disengage
4. **Knowledge extraction**: What to track, where to route it
5. **Response style**: Concise, helpful, human-like
6. **Tool usage**: When to use wiki tools, when to suggest Linear tickets
7. **Standup behavior**: How to track and follow up
8. **Boundaries**: What NOT to do

### Anti-Patterns to Forbid

- "Let me know if you need anything else!"
- Responding to every message once active
- Creating Linear tickets without confirmation
- Sharing context from private channels inappropriately
- Being chatty when dismissed

## Message Processing Pipeline

```
Slack Message
    ↓
┌─────────────────────────────────────┐
│ 1. CLASSIFY                         │
│    - Is this talking to me?         │
│    - Is this a standup?             │
│    - What channel/thread context?   │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ 2. EXTRACT (every message)          │
│    - Tasks, blockers, issues        │
│    - People info, decisions         │
│    - Standup commitments            │
│    - Log to conversation files      │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ 3. RESPOND (only if engaged)        │
│    - Assemble context layers        │
│    - Call Haiku with constitution   │
│    - Execute tool calls             │
│    - Send response                  │
└─────────────────────────────────────┘
```

### Haiku Invocations

Two types:
1. **Classification/extraction** (every message): Fast, cheap, structured output
2. **Response generation** (only when engaged): Full context, tools available

## Tools Available to Haiku

- `read_wiki(path)` - Read a wiki page
- `write_wiki(path, content)` - Update a wiki page
- `search_wiki(query)` - Find relevant wiki content
- `search_conversations(query, options)` - Search conversation history
- `search_linear(query)` - Find relevant Linear tickets/projects
- `suggest_linear_ticket(title, description)` - Propose creating a ticket
- `update_constitution(change, reasoning)` - Modify learned behaviors

## Implementation Components

| Component | Purpose |
|-----------|---------|
| `src/pipeline/classifier.ts` | Determines engagement, message type |
| `src/pipeline/extractor.ts` | Extracts knowledge from every message |
| `src/pipeline/responder.ts` | Assembles context, generates responses |
| `src/attention/tracker.ts` | Tracks active threads, engagement state |
| `src/standup/tracker.ts` | Standup detection and follow-up |
| `src/context/assembler.ts` | Builds context layers for responses |
| `src/constitution/` | Base + learned constitution management |
| `src/tools/` | Wiki, Linear, search tools for Haiku |

## Migration from Current Implementation

The current Scribble has:
- Slack adapter (keep, modify engagement logic)
- Wiki manager (keep, enhance for living docs)
- Conversation logger (keep, remove SQLite dependency)
- Orchestrator (replace with pipeline architecture)
- Database (remove, replace with text files)

Key changes:
1. Replace SQLite with text file storage
2. Add attention tracking system
3. Add standup detection and follow-up
4. Add context assembly with cross-channel awareness
5. Add two-layer constitution with self-modification
6. Integrate StreamLinear MCP
7. Rewrite orchestrator as three-stage pipeline
