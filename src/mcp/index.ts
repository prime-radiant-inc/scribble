// src/mcp/index.ts
// MCP server for Scribble tools - wiki, linear, learning, conversation search

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { WikiManager } from '../wiki/wikiManager.js';
import { ConstitutionManager } from '../constitution/manager.js';
import { ConversationLogger } from '../logging/conversationLogger.js';
import { StreamLinearTools } from '../tools/streamlinear.js';

// Configuration from environment
const DATA_DIR = process.env.DATA_DIRECTORY || './data';
const WIKI_REPO = process.env.WIKI_REPO || 'prime-radiant-inc/scribble-wiki';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const LINEAR_API_KEY = process.env.LINEAR_API_KEY;

// Initialize managers
const wikiManager = new WikiManager(`${DATA_DIR}/wiki`, WIKI_REPO, GITHUB_TOKEN);
const constitutionManager = new ConstitutionManager(`${DATA_DIR}/wiki`);
const conversationLogger = new ConversationLogger(DATA_DIR);
const linearTools = LINEAR_API_KEY ? new StreamLinearTools(LINEAR_API_KEY) : null;

// Create MCP server
const server = new McpServer({
  name: 'scribble',
  version: '1.0.0',
});

// ============================================================================
// Respond Tool
// ============================================================================

const RespondParams = z.object({
  directed_at_me: z.boolean().describe(`Your persona is QUIET and COMPETENT. You do not engage in banter, small talk, or respond just for the sake of human connection. You speak only when you have something substantive to contribute.

Set to true ONLY if:
1. Message contains @scribble mention with a question or request
2. Message explicitly addresses Scribble by name ("scribble", "scrib") with a task or question
3. Someone states something factually incorrect that you can correct with a specific source. You MUST include a hyperlink (Slack message, Linear ticket, or wiki page) to the contradicting evidence. No link = no response. This is ONLY for direct factual contradictions (e.g., "we don't have docs on X" when a wiki page exists), NOT for adding context, offering help, or sharing related information.

CRITICAL - Pronoun disambiguation:
- Pronouns like "you", "your", "yourself" do NOT count as addressing you
- In conversations between multiple people, assume "you" refers to the OTHER HUMAN, not to you
- Unless your name (Scribble/scrib) or @mention appears in the message, you are NOT being addressed
- "I want it to work for you" between two humans = NOT addressing you
- "Scribble, I want it to work for you" = addressing you

CRITICAL - Message formatting:
- Messages include timestamps like [Name | Feb 9, 2:30 PM]. Use these to understand conversational flow and recency.
- Characters like "❯", "$", ">", "#", "%" at the start of a message are TERMINAL PROMPT CHARACTERS, not indicators that someone is addressing you. These appear when people paste terminal output or write example commands.
- Second-person language ("I want to deploy", "we need to build") in a channel conversation is almost never directed at you unless your name or @mention appears.

Set to false for:
- Greetings, thanks, or social pleasantries (do not respond to "good morning" or "thanks scribble")
- Casual conversation between others (even if they use "you" - it's not you)
- Messages where you'd just be acknowledging or agreeing
- Messages containing pasted terminal output, example commands, or prompt text
- Anything where staying silent is reasonable

You can use tools (wiki, linear, etc.) even when directed_at_me is false. Taking action silently is often better than announcing what you're doing. A checkmark reaction will indicate you acted.`),
  reason: z.string().describe('One short sentence explaining your engagement decision'),
  message: z.string().optional().describe('REQUIRED when directed_at_me is true. The actual response to send. Be direct and concise - no filler, no pleasantries, no "Sure!" or "Happy to help!"'),
});

server.tool(
  'respond',
  'You MUST call this tool for EVERY message. This is the only way to send visible responses to Slack.',
  RespondParams.shape,
  async ({ directed_at_me, reason, message }) => {
    // The real handling happens in the orchestrator's onToolUse callback.
    // This handler just acknowledges the call.
    if (directed_at_me && message) {
      return { content: [{ type: 'text' as const, text: `Response registered (directed_at_me=${directed_at_me}).` }] };
    }
    return { content: [{ type: 'text' as const, text: `Engagement decision registered (directed_at_me=${directed_at_me}).` }] };
  }
);

// ============================================================================
// Decision Log Tool
// ============================================================================

const LogDecisionParams = z.object({
  decision: z.string().describe('The decision that was made — a clear, concise statement'),
  tags: z.array(z.string()).describe('Categorization tags (e.g., "engineering", "hiring", "product", "finance")'),
});

server.tool(
  'log_decision',
  'Log a business decision to #decision-log with a link back to the source message',
  LogDecisionParams.shape,
  async ({ decision, tags }) => {
    // Real posting happens in the orchestrator's onToolUse callback.
    return { content: [{ type: 'text' as const, text: `Decision logged: ${decision} [${tags.join(', ')}]` }] };
  }
);

// ============================================================================
// Wiki Tools
// ============================================================================

const WikiCreateParams = z.object({
  path: z.string().describe('Full path for the entry (e.g., "knowledge/people/john-doe.md")'),
  content: z.string().describe('Full markdown content for the entry'),
});

server.tool(
  'wiki_create',
  'Create or update a wiki entry',
  WikiCreateParams.shape,
  async ({ path, content }) => {
    try {
      // Extract title from first H1 heading or derive from path
      const titleMatch = content.match(/^#\s+(.+)$/m);
      const title = titleMatch
        ? titleMatch[1]
        : path.replace(/\.md$/, '').split('/').pop() || 'Untitled';
      await wikiManager.writeEntry({ path, title, content });
      await wikiManager.commit(`Create/update: ${path}`);
      return { content: [{ type: 'text' as const, text: `Wiki entry created/updated: ${path}` }] };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error creating wiki entry: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

const WikiReadParams = z.object({
  path: z.string().describe('Path to the wiki entry (e.g., "knowledge/people/john-doe.md")'),
});

server.tool(
  'wiki_read',
  'Read a wiki entry',
  WikiReadParams.shape,
  async ({ path }) => {
    try {
      const content = await wikiManager.readEntry(path);
      if (!content) {
        return { content: [{ type: 'text' as const, text: `Wiki entry not found: ${path}` }] };
      }
      return { content: [{ type: 'text' as const, text: content }] };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error reading wiki entry: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

const WikiEditParams = z.object({
  path: z.string().describe('Path to the wiki entry'),
  content: z.string().describe('New full content for the entry'),
});

server.tool(
  'wiki_edit',
  'Edit an existing wiki entry (full replacement)',
  WikiEditParams.shape,
  async ({ path, content }) => {
    try {
      const existing = await wikiManager.readEntry(path);
      if (!existing) {
        return { content: [{ type: 'text' as const, text: `Wiki entry not found: ${path}` }] };
      }
      // Extract title from first H1 heading or derive from path
      const titleMatch = content.match(/^#\s+(.+)$/m);
      const title = titleMatch
        ? titleMatch[1]
        : path.replace(/\.md$/, '').split('/').pop() || 'Untitled';
      await wikiManager.writeEntry({ path, title, content });
      await wikiManager.commit(`Edit: ${path}`);
      return { content: [{ type: 'text' as const, text: `Wiki entry updated: ${path}` }] };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error editing wiki entry: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

const WikiDeleteParams = z.object({
  path: z.string().describe('Path to the wiki entry to delete'),
});

server.tool(
  'wiki_delete',
  'Delete a wiki entry',
  WikiDeleteParams.shape,
  async ({ path }) => {
    try {
      const deleted = await wikiManager.deleteEntry(path);
      if (!deleted) {
        return { content: [{ type: 'text' as const, text: `Wiki entry not found: ${path}` }] };
      }
      await wikiManager.commit(`Delete: ${path}`);
      return { content: [{ type: 'text' as const, text: `Wiki entry deleted: ${path}` }] };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error deleting wiki entry: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

const WikiRenameParams = z.object({
  old_path: z.string().describe('Current path of the entry'),
  new_path: z.string().describe('New path for the entry'),
});

server.tool(
  'wiki_rename',
  'Rename/move a wiki entry',
  WikiRenameParams.shape,
  async ({ old_path, new_path }) => {
    try {
      const renamed = await wikiManager.renameEntry(old_path, new_path);
      if (!renamed) {
        return { content: [{ type: 'text' as const, text: `Wiki entry not found: ${old_path}` }] };
      }
      await wikiManager.commit(`Rename: ${old_path} -> ${new_path}`);
      return { content: [{ type: 'text' as const, text: `Wiki entry renamed: ${old_path} -> ${new_path}` }] };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error renaming wiki entry: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

const WikiSearchParams = z.object({
  query: z.string().describe('Search query'),
});

server.tool(
  'wiki_search',
  'Search wiki content',
  WikiSearchParams.shape,
  async ({ query }) => {
    try {
      const results = await wikiManager.search(query);
      if (results.length === 0) {
        return { content: [{ type: 'text' as const, text: `No wiki entries found for: ${query}` }] };
      }
      const formatted = results.map(r => `**${r.title}** (${r.path})\n${r.snippet}`).join('\n\n---\n\n');
      return { content: [{ type: 'text' as const, text: formatted }] };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error searching wiki: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

const WikiListParams = z.object({
  category: z.string().optional().describe('Filter by category (e.g., "knowledge/people")'),
});

server.tool(
  'wiki_list',
  'List all wiki pages',
  WikiListParams.shape,
  async ({ category }) => {
    try {
      if (category) {
        const entries = await wikiManager.listEntries(category);
        if (entries.length === 0) {
          return { content: [{ type: 'text' as const, text: `No entries found in category: ${category}` }] };
        }
        return { content: [{ type: 'text' as const, text: entries.join('\n') }] };
      }
      const entries = await wikiManager.listAllEntries();
      if (entries.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No wiki entries found' }] };
      }
      const formatted = entries.map(e => `${e.path} - ${e.title} (${e.lines} lines)`).join('\n');
      return { content: [{ type: 'text' as const, text: formatted }] };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error listing wiki: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

const WikiHistoryParams = z.object({
  path: z.string().describe('Path to the wiki entry'),
  limit: z.number().optional().describe('Number of commits to return (default: 10)'),
});

server.tool(
  'wiki_history',
  'Get commit history for a wiki entry',
  WikiHistoryParams.shape,
  async ({ path, limit }) => {
    try {
      const history = await wikiManager.getHistory(path, limit ?? 10);
      if (history.length === 0) {
        return { content: [{ type: 'text' as const, text: `No history found for: ${path}` }] };
      }
      const formatted = history.map(c => `${c.shortHash} - ${c.date} - ${c.message} (${c.author})`).join('\n');
      return { content: [{ type: 'text' as const, text: formatted }] };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error getting wiki history: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

const WikiReadVersionParams = z.object({
  path: z.string().describe('Path to the wiki entry'),
  commit: z.string().describe('Commit hash (short or full)'),
});

server.tool(
  'wiki_read_version',
  'Read a specific version of a wiki entry from git history',
  WikiReadVersionParams.shape,
  async ({ path, commit }) => {
    try {
      const content = await wikiManager.readVersion(path, commit);
      if (!content) {
        return { content: [{ type: 'text' as const, text: `Version not found: ${path} @ ${commit}` }] };
      }
      return { content: [{ type: 'text' as const, text: content }] };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error reading wiki version: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

// ============================================================================
// Conversation Search Tool
// ============================================================================

const ConversationSearchParams = z.object({
  query: z.string().describe('Search query'),
  channel_id: z.string().optional().describe('Filter to specific channel'),
  date: z.string().optional().describe('Filter by date (YYYY-MM-DD) or range (YYYY-MM-DD:YYYY-MM-DD)'),
  context: z.number().optional().describe('Number of messages to show before and after each match'),
  limit: z.number().optional().describe('Maximum results (default: 10)'),
});

server.tool(
  'conversation_search',
  'Search past Slack conversations',
  ConversationSearchParams.shape,
  async ({ query, channel_id, date, context, limit }) => {
    try {
      const results = await conversationLogger.search(query, {
        channelId: channel_id,
        date,
        context,
        limit: limit ?? 10
      });
      if (results.length === 0) {
        return { content: [{ type: 'text' as const, text: `No conversations found for: ${query}` }] };
      }
      const formatted = results.map(r => {
        let text = `**${r.channelId}** (${r.date})\n${r.snippet}`;
        if (r.contextMessages && r.contextMessages.length > 0) {
          const contextText = r.contextMessages
            .map(m => `  ${m.userName} [${m.timestamp}]: ${m.text}`)
            .join('\n');
          text += `\n\n**Context:**\n${contextText}`;
        }
        return text;
      }).join('\n\n---\n\n');
      return { content: [{ type: 'text' as const, text: formatted }] };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error searching conversations: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

// ============================================================================
// Learning Tools
// ============================================================================

const LearnBehaviorParams = z.object({
  behavior: z.string().describe('The behavior to learn (e.g., "Always format code in fenced blocks")'),
  reasoning: z.string().describe('Why this behavior is being added'),
  requested_by: z.string().optional().describe('Who requested this behavior'),
});

server.tool(
  'learn_behavior',
  'Add a persistent global behavioral rule',
  LearnBehaviorParams.shape,
  async ({ behavior, reasoning, requested_by }) => {
    try {
      constitutionManager.addLearnedBehavior(behavior, requested_by || 'unknown', reasoning);
      return { content: [{ type: 'text' as const, text: `Learned behavior added: ${behavior}` }] };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error adding behavior: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

const ListBehaviorsParams = z.object({});

server.tool(
  'list_behaviors',
  'List all learned behaviors',
  ListBehaviorsParams.shape,
  async () => {
    try {
      const behaviors = constitutionManager.getLearnedBehaviors();
      if (behaviors.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No learned behaviors' }] };
      }
      const formatted = behaviors.map(b => `- [${b.id}] ${b.behavior}\n  Added: ${b.addedAt} by ${b.requestedBy}\n  Reason: ${b.reasoning}`).join('\n\n');
      return { content: [{ type: 'text' as const, text: formatted }] };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error listing behaviors: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

const SetChannelInstructionParams = z.object({
  channel_id: z.string().optional().describe('Slack channel ID (e.g., "C0A93A7H820"). Provide this, channel_name, or both.'),
  channel_name: z.string().optional().describe('Slack channel name (e.g., "morning-standup"). Provide this, channel_id, or both.'),
  instruction: z.string().describe('The instruction for this channel'),
  requested_by: z.string().optional().describe('Who requested this instruction'),
});

server.tool(
  'set_channel_instruction',
  'Add a channel-specific standing instruction. Provide channel_id and/or channel_name — both is best.',
  SetChannelInstructionParams.shape,
  async ({ channel_id, channel_name, instruction, requested_by }) => {
    try {
      constitutionManager.addChannelInstruction({
        channelId: channel_id,
        channelName: channel_name,
        instruction,
        requestedBy: requested_by || 'unknown',
      });
      const label = channel_name ? `#${channel_name}` : channel_id || 'unknown';
      return { content: [{ type: 'text' as const, text: `Channel instruction added for ${label}: ${instruction}` }] };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error adding channel instruction: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

const ListChannelInstructionsParams = z.object({
  channel_id: z.string().optional().describe('Filter by channel ID'),
  channel_name: z.string().optional().describe('Filter by channel name'),
});

server.tool(
  'list_channel_instructions',
  'List channel-specific instructions',
  ListChannelInstructionsParams.shape,
  async ({ channel_id, channel_name }) => {
    try {
      const query = (channel_id || channel_name) ? { channelId: channel_id, channelName: channel_name } : undefined;
      const instructions = constitutionManager.getChannelInstructions(query);
      if (instructions.length === 0) {
        const label = channel_name || channel_id;
        return { content: [{ type: 'text' as const, text: label ? `No instructions for channel ${label}` : 'No channel instructions' }] };
      }
      const formatted = instructions.map(i => {
        const channelLabel = i.channelName ? `#${i.channelName}` : (i.channelId || 'unknown');
        return `- [${i.id}] ${channelLabel}: ${i.instruction}\n  Added: ${i.addedAt} by ${i.requestedBy}`;
      }).join('\n\n');
      return { content: [{ type: 'text' as const, text: formatted }] };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error listing instructions: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

// ============================================================================
// Linear Integration Tools
// ============================================================================

if (linearTools) {
  const LinearSearchParams = z.object({
    query: z.string().describe('Search query for Linear issues'),
  });

  server.tool(
    'linear_search',
    'Search Linear issues',
    LinearSearchParams.shape,
    async ({ query }) => {
      try {
        const results = await linearTools.searchIssues(query);
        if (results.length === 0) {
          return { content: [{ type: 'text' as const, text: `No Linear issues found for: ${query}` }] };
        }
        const formatted = results.map(t => linearTools.formatTicket(t)).join('\n\n');
        return { content: [{ type: 'text' as const, text: formatted }] };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error searching Linear: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  const LinearSuggestParams = z.object({
    title: z.string().describe('Ticket title'),
    description: z.string().describe('Ticket description'),
    channel_id: z.string().optional().describe('Channel where this was suggested'),
  });

  server.tool(
    'linear_suggest',
    'Suggest creating a Linear ticket (requires confirmation)',
    LinearSuggestParams.shape,
    async ({ title, description, channel_id }) => {
      try {
        const suggestion = linearTools.suggestTicket(title, description, 'scribble-mcp', channel_id);
        return {
          content: [{
            type: 'text' as const,
            text: `Ticket suggestion created:\n- Title: ${title}\n- ID: ${suggestion.id}\n\nUse linear_confirm with this ID to create the ticket, or linear_cancel to discard.`,
          }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error creating suggestion: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  const LinearConfirmParams = z.object({
    suggestion_id: z.string().describe('The suggestion ID from linear_suggest'),
  });

  server.tool(
    'linear_confirm',
    'Confirm and create a previously suggested Linear ticket',
    LinearConfirmParams.shape,
    async ({ suggestion_id }) => {
      try {
        const suggestion = linearTools.getSuggestion(suggestion_id);
        if (!suggestion) {
          return { content: [{ type: 'text' as const, text: `Suggestion not found: ${suggestion_id}` }] };
        }
        const ticket = await linearTools.createIssue(suggestion.title, suggestion.description);
        linearTools.removeSuggestion(suggestion_id);
        return { content: [{ type: 'text' as const, text: `Ticket created:\n${linearTools.formatTicket(ticket)}` }] };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error creating ticket: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  const LinearCancelParams = z.object({
    suggestion_id: z.string().describe('The suggestion ID to cancel'),
  });

  server.tool(
    'linear_cancel',
    'Cancel a ticket suggestion',
    LinearCancelParams.shape,
    async ({ suggestion_id }) => {
      const removed = linearTools.removeSuggestion(suggestion_id);
      if (!removed) {
        return { content: [{ type: 'text' as const, text: `Suggestion not found: ${suggestion_id}` }] };
      }
      return { content: [{ type: 'text' as const, text: `Suggestion cancelled: ${suggestion_id}` }] };
    }
  );
}

// ============================================================================
// Channel Management Tool
// ============================================================================

const LeaveChannelParams = z.object({
  channel_id: z.string().describe('Channel ID to leave'),
});

server.tool(
  'leave_channel',
  'Request to leave a Slack channel (Scribble will stop monitoring it)',
  LeaveChannelParams.shape,
  async ({ channel_id }) => {
    // Note: This tool just returns a message - actual leaving is handled by the Slack adapter
    return {
      content: [{
        type: 'text' as const,
        text: `Request to leave channel ${channel_id} noted. The Slack adapter will handle this request.`,
      }],
    };
  }
);

// Start the server
async function main() {
  // Initialize wiki manager (clone repo if needed)
  await wikiManager.initialize();

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('MCP server error:', error);
  process.exit(1);
});
