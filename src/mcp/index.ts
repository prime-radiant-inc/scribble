// src/mcp/index.ts
// MCP server for Scribble tools - wiki, linear, learning, conversation search

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { WikiManager } from '../wiki/wikiManager.js';
import { ConstitutionManager } from '../constitution/manager.js';
import { ConversationLogger } from '../logging/conversationLogger.js';
import { normalizeConversationSearchArgs } from './conversationSearchArgs.js';
import { requireWikiRepo } from '../config/wikiRepo.js';
import { clampWikiLimit, clampWikiResults } from './wikiHandlerCaps.js';
import { parseOptionalEnv, parseTenantConfig } from '../config/tenantConfig.js';
import {
  buildConversationSearchDescription,
  buildLeaveChannelDescription,
  buildLogDecisionDescription,
  buildRespondDirectedAtMeDescription,
  buildRespondToolDescription,
} from './toolDescriptions.js';
// Configuration from environment
const DATA_DIR = process.env.DATA_DIRECTORY || './data';
const WIKI_REPO = requireWikiRepo();
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const tenantConfig = parseTenantConfig(process.env);
const linearEnabled = parseLinearEnabled(process.env);
const integrations = { linear: linearEnabled };

function parseLinearEnabled(env: Record<string, string | undefined>): boolean {
  const flag = parseOptionalEnv(env, 'SCRIBBLE_LINEAR_ENABLED');
  if (flag !== undefined) {
    if (flag === 'true') return true;
    if (flag === 'false') return false;
    throw new Error('SCRIBBLE_LINEAR_ENABLED must be true or false when set');
  }
  return Boolean(parseOptionalEnv(env, 'LINEAR_API_KEY'));
}

// Initialize managers
const wikiManager = new WikiManager(`${DATA_DIR}/wiki`, WIKI_REPO, GITHUB_TOKEN, {
  gitAuthorName: tenantConfig.wikiGitAuthorName,
  gitAuthorEmail: tenantConfig.wikiGitAuthorEmail,
});
const constitutionManager = new ConstitutionManager(`${DATA_DIR}/wiki`, {
  tenant: tenantConfig,
  integrations,
});
const conversationLogger = new ConversationLogger(DATA_DIR);

// Create MCP server
const server = new McpServer({
  name: 'scribble',
  version: '1.0.0',
});

// ============================================================================
// Respond Tool
// ============================================================================

const RespondParams = z.object({
  directed_at_me: z.boolean().describe(buildRespondDirectedAtMeDescription(tenantConfig, integrations)),
  reason: z.string().describe('One short sentence explaining your engagement decision'),
  message: z.string().optional().describe('REQUIRED when directed_at_me is true. The actual response to send. Be direct and concise - no filler, no pleasantries, no "Sure!" or "Happy to help!"'),
});

server.tool(
  'respond',
  buildRespondToolDescription(),
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
// Slack Reply Tool (threaded replies to arbitrary messages)
// ============================================================================

const SlackReplyParams = z.object({
  channel_id: z.string().describe('Slack channel ID to post in'),
  thread_ts: z.string().describe('Timestamp of the message to reply to (creates a threaded reply)'),
  message: z.string().describe('The message text to post as a threaded reply'),
});

server.tool(
  'slack_reply',
  'Post a threaded reply to a specific Slack message. Use this to reply in-thread to messages you are not currently processing.',
  SlackReplyParams.shape,
  async ({ channel_id, thread_ts, message }) => {
    // Real posting happens in the orchestrator's onToolUse callback.
    return { content: [{ type: 'text' as const, text: `Threaded reply queued for ${channel_id} thread ${thread_ts}.` }] };
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
  buildLogDecisionDescription(tenantConfig),
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
      const results = clampWikiResults(await wikiManager.search(query));
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
      const history = await wikiManager.getHistory(path, clampWikiLimit(limit));
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
  buildConversationSearchDescription(),
  ConversationSearchParams.shape,
  async ({ query, channel_id, date, context, limit }) => {
    try {
      const normalized = normalizeConversationSearchArgs({ query, channel_id, date, limit, context });
      if (!normalized) {
        return { content: [{ type: 'text' as const, text: 'Invalid conversation_search args (empty query or malformed channel_id).' }] };
      }

      const results = await conversationLogger.search(normalized.query, {
        channelId: normalized.channel_id,
        date: normalized.date,
        context: normalized.context,
        limit: normalized.limit ?? 10
      });
      if (results.length === 0) {
        return { content: [{ type: 'text' as const, text: `No conversations found for: ${normalized.query}` }] };
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
      constitutionManager.addLearnedBehavior(
        behavior,
        nonBlankOr(requested_by, 'unknown'),
        nonBlankOr(reasoning, 'unspecified'),
      );
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
        requestedBy: nonBlankOr(requested_by, 'unknown'),
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

function nonBlankOr(value: string | undefined, fallback: string): string {
  return value && value.trim().length > 0 ? value : fallback;
}

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
// Channel Management Tool
// ============================================================================

const LeaveChannelParams = z.object({
  channel_id: z.string().describe('Channel ID to leave'),
});

server.tool(
  'leave_channel',
  buildLeaveChannelDescription(tenantConfig),
  LeaveChannelParams.shape,
  async ({ channel_id }) => {
    // This is only an acknowledgement; no channel-leave side effect is currently wired here.
    return {
      content: [{
        type: 'text' as const,
        text: `Request to leave channel ${channel_id} noted. An operator must remove the app from the channel or implement leave handling before channel access changes.`,
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
