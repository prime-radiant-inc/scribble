import Anthropic from '@anthropic-ai/sdk';
import { Logger } from '../utils/logger.js';
import { SlackMessage, ExtractedFact } from './types.js';
import { ScribbleDatabase } from './database.js';
import { ConversationLogger } from '../logging/conversationLogger.js';
import { WikiManager } from '../wiki/wikiManager.js';
import { SlackResponder } from '../slack/responder.js';
import { Config } from '../config/config.js';

const logger = new Logger('Orchestrator');

// System prompt for Scribble
const SYSTEM_PROMPT = `# Scribble - Prime Radiant Knowledge Bot

You are Scribble, a helpful, diligent, and resourceful assistant for Prime Radiant.

## Your Role
- Read and understand all Slack conversations
- Extract and organize knowledge in the company wiki
- Track tasks and issues mentioned in conversations
- Search conversation history to answer questions
- Help team members find information

## Interaction Style
- Be helpful, diligent, and resourceful
- Ask clarifying questions when requests are ambiguous
- Proactively offer relevant information from your knowledge base
- Keep responses concise but complete
- Use Slack formatting (bold, lists, code blocks) when appropriate

## When Mining Messages (Background Processing)
When reading messages passively (not @mentioned):
- Extract facts about projects, people, decisions
- Identify action items and tasks
- Note issues or blockers mentioned
- Update wiki with new knowledge

Only extract facts that are:
- Clearly stated (not speculation)
- Significant enough to remember
- Not already captured in the wiki

## When Responding Interactively
When @mentioned or in DM:
- Answer questions using your knowledge of conversations and wiki
- Create or update wiki entries when asked - USE THE TOOLS, don't just describe what you would do
- Search for information using the tools provided
- Summarize discussions when asked

## Tools Available
You have tools to:
- create_wiki_entry: Create or update wiki pages
- search_wiki: Search the wiki for information
- search_conversations: Search conversation history

IMPORTANT: When asked to create or update wiki content, USE the create_wiki_entry tool immediately. Do not say "I would create..." or "In a real implementation..." - actually use the tool.

## Important Notes
- Take action using tools rather than describing what you would do
- Never share private information from one conversation in another
- Respect channel privacy boundaries
- Keep responses concise`;

// Tool definitions for Claude
const TOOLS: Anthropic.Tool[] = [
  {
    name: 'create_wiki_entry',
    description: 'Create or update a wiki entry. Use this to add information to the company knowledge base.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: {
          type: 'string',
          description: 'Title of the wiki entry',
        },
        content: {
          type: 'string',
          description: 'Markdown content for the wiki entry',
        },
        category: {
          type: 'string',
          enum: ['knowledge/projects', 'knowledge/people', 'knowledge/decisions', 'knowledge/processes', 'tasks/open', 'issues/open'],
          description: 'Category for the wiki entry',
        },
      },
      required: ['title', 'content', 'category'],
    },
  },
  {
    name: 'search_wiki',
    description: 'Search the wiki for information on a topic',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_conversations',
    description: 'Search past Slack conversations for information',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default 10)',
        },
      },
      required: ['query'],
    },
  },
];

export interface OrchestratorConfig {
  config: Config;
  database: ScribbleDatabase;
  conversationLogger: ConversationLogger;
  wikiManager: WikiManager;
}

export class ScribbleOrchestrator {
  private anthropic: Anthropic;
  private database: ScribbleDatabase;
  private conversationLogger: ConversationLogger;
  private wikiManager: WikiManager;
  private config: Config;

  constructor(opts: OrchestratorConfig) {
    this.config = opts.config;
    this.database = opts.database;
    this.conversationLogger = opts.conversationLogger;
    this.wikiManager = opts.wikiManager;

    this.anthropic = new Anthropic({
      apiKey: this.config.anthropic.apiKey,
    });
  }

  /**
   * Log a message to the conversation logs
   */
  async logMessage(message: SlackMessage): Promise<void> {
    await this.conversationLogger.logMessage(message);
  }

  /**
   * Mine a message for facts (background processing)
   * Uses Haiku for efficiency
   */
  async mineMessage(message: SlackMessage): Promise<void> {
    // Skip very short messages
    if (message.text.length < 20) return;

    // Skip messages that are just links or reactions
    if (message.text.match(/^<[^>]+>$/)) return;

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 1024,
        system: `You are analyzing Slack messages to extract facts for a company wiki.

Extract significant facts from the message. Only extract facts that are:
- Clearly stated (not speculation or questions)
- About projects, people, decisions, processes, tasks, or issues
- Worth remembering for the company knowledge base

Respond with JSON in this format:
{
  "facts": [
    {
      "type": "project|person|decision|process|task|issue",
      "title": "Short title",
      "content": "The fact content",
      "confidence": 0.0-1.0
    }
  ]
}

If no significant facts, respond with: {"facts": []}`,
        messages: [
          {
            role: 'user',
            content: `Channel: #${message.channelName}
User: ${message.userName}
Message: ${message.text}`,
          },
        ],
      });

      // Parse response - extract JSON from response
      let text = response.content[0].type === 'text' ? response.content[0].text : '';

      // Strip markdown code blocks if present
      text = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

      // Find JSON object in the response (handles extra text before/after)
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.debug('No JSON found in response, skipping', { text: text.substring(0, 100) });
        return;
      }

      const parsed = JSON.parse(jsonMatch[0]);

      if (parsed.facts && parsed.facts.length > 0) {
        for (const fact of parsed.facts) {
          if (fact.confidence >= 0.7) {
            await this.saveFact({
              ...fact,
              source: {
                channelId: message.channelId,
                channelName: message.channelName,
                messageTs: message.messageTs,
                userId: message.userId,
              },
            });
          }
        }
      }

      // Mark as mined
      this.database.markMessageMined(message.messageTs);

    } catch (error) {
      logger.error('Failed to mine message', { error, messageTs: message.messageTs });
    }
  }

  /**
   * Save an extracted fact to the wiki
   */
  private async saveFact(fact: ExtractedFact): Promise<void> {
    const category = this.factTypeToCategory(fact.type);
    const filename = this.titleToFilename(fact.title);
    const entryPath = `${category}/${filename}.md`;

    // Check if entry already exists
    const existing = await this.wikiManager.readEntry(entryPath);
    if (existing) {
      // Append to existing entry
      const updatedContent = `${existing.trim()}\n\n## Update from #${fact.source.channelName}\n\n${fact.content}`;
      await this.wikiManager.writeEntry({
        path: entryPath,
        title: fact.title,
        content: updatedContent,
        category: category.split('/')[0] as 'knowledge' | 'task' | 'issue',
        subcategory: category.split('/')[1],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } else {
      // Create new entry
      await this.wikiManager.writeEntry({
        path: entryPath,
        title: fact.title,
        content: `# ${fact.title}\n\n${fact.content}\n\n---\n_Source: #${fact.source.channelName}_`,
        category: category.split('/')[0] as 'knowledge' | 'task' | 'issue',
        subcategory: category.split('/')[1],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    // Record in database
    this.database.recordWikiEntry(
      entryPath,
      fact.title,
      category,
      fact.source.channelId,
      fact.source.messageTs
    );

    // Commit to wiki repo (batch commits to avoid too many)
    // In production, you'd want to batch these
    try {
      await this.wikiManager.commit(`${category}: ${fact.title}`);
    } catch (error) {
      logger.error('Failed to commit wiki entry', { error, path: entryPath });
    }

    logger.info('Saved fact to wiki', { path: entryPath, title: fact.title });
  }

  private factTypeToCategory(type: string): string {
    switch (type) {
      case 'project':
        return 'knowledge/projects';
      case 'person':
        return 'knowledge/people';
      case 'decision':
        return 'knowledge/decisions';
      case 'process':
        return 'knowledge/processes';
      case 'task':
        return 'tasks/open';
      case 'issue':
        return 'issues/open';
      default:
        return 'knowledge/projects';
    }
  }

  private titleToFilename(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50);
  }

  /**
   * Handle an interactive message (DM or @mention)
   */
  async handleInteractiveMessage(
    message: SlackMessage,
    responder: SlackResponder
  ): Promise<void> {
    try {
      await responder.markProcessing();

      // Get recent conversation context
      const recentMessages = await this.conversationLogger.getRecentMessages(
        message.channelId,
        5
      );

      // Build context
      const contextMessage = `Recent conversation in this channel:
${recentMessages.slice(0, 3).join('\n---\n')}

User message: ${message.text}`;

      // Call Claude with tools
      const messages: Anthropic.MessageParam[] = [
        { role: 'user', content: contextMessage },
      ];

      let finalResponse = '';
      let continueLoop = true;

      while (continueLoop) {
        const response = await this.anthropic.messages.create({
          model: 'claude-haiku-4-5',
          max_tokens: 2048,
          system: SYSTEM_PROMPT,
          tools: TOOLS,
          messages,
        });

        // Process response content
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const block of response.content) {
          if (block.type === 'text') {
            finalResponse += block.text;
          } else if (block.type === 'tool_use') {
            const result = await this.executeTool(block.name, block.input as Record<string, unknown>, message);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: result,
            });
          }
        }

        // If there were tool calls, add them to messages and continue
        if (toolResults.length > 0) {
          messages.push({ role: 'assistant', content: response.content });
          messages.push({ role: 'user', content: toolResults });
        }

        // Check if we should continue
        if (response.stop_reason === 'end_turn' || toolResults.length === 0) {
          continueLoop = false;
        }
      }

      // Send response
      if (finalResponse) {
        await responder.updateResponse(finalResponse);
      } else {
        await responder.updateResponse('Done!');
      }
      await responder.finalizeResponse();
      await responder.clearProcessing();

      // Update conversation tracking
      this.database.updateConversation(
        message.channelId,
        message.threadTs,
        message.userId
      );

    } catch (error) {
      logger.error('Error handling interactive message', { error, messageTs: message.messageTs });
      await responder.clearProcessing();
      await responder.markError();
      await responder.reply('Sorry, I encountered an error processing your message.');
    }
  }

  /**
   * Execute a tool and return the result
   */
  private async executeTool(name: string, input: Record<string, unknown>, message: SlackMessage): Promise<string> {
    logger.info('Executing tool', { name, input });

    try {
      switch (name) {
        case 'create_wiki_entry': {
          const title = input.title as string;
          const content = input.content as string;
          const category = input.category as string;
          const filename = this.titleToFilename(title);
          const entryPath = `${category}/${filename}.md`;

          await this.wikiManager.writeEntry({
            path: entryPath,
            title,
            content: `# ${title}\n\n${content}`,
            category: category.split('/')[0] as 'knowledge' | 'tasks' | 'issues',
            subcategory: category.split('/')[1],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });

          await this.wikiManager.commit(`Add: ${title}`);

          this.database.recordWikiEntry(
            entryPath,
            title,
            category,
            message.channelId,
            message.messageTs
          );

          logger.info('Created wiki entry', { path: entryPath });
          return `Created wiki entry: ${entryPath}`;
        }

        case 'search_wiki': {
          const query = input.query as string;
          const results = await this.wikiManager.search(query);
          if (results.length === 0) {
            return 'No wiki entries found matching the query.';
          }
          return results.slice(0, 5).map(r => `**${r.title}** (${r.path})\n${r.snippet}`).join('\n\n');
        }

        case 'search_conversations': {
          const query = input.query as string;
          const limit = (input.limit as number) || 10;
          const results = await this.conversationLogger.search(query, { limit });
          if (results.length === 0) {
            return 'No conversations found matching the query.';
          }
          return results.slice(0, limit).join('\n---\n');
        }

        default:
          return `Unknown tool: ${name}`;
      }
    } catch (error) {
      logger.error('Tool execution failed', { name, error });
      return `Error executing ${name}: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  /**
   * Search conversations
   */
  async searchConversations(query: string, options?: {
    channelId?: string;
    limit?: number;
  }) {
    return this.conversationLogger.search(query, options);
  }

  /**
   * Search wiki
   */
  async searchWiki(query: string) {
    return this.wikiManager.search(query);
  }
}
