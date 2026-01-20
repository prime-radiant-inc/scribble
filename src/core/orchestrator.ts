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
- Help search for information
- Create or update wiki entries when asked
- Summarize discussions when asked

## Available Context
You have access to:
- Recent conversation history in the current channel/thread
- The company wiki (knowledge base)
- Searchable conversation logs

## Important Notes
- Never share private information from one conversation in another
- Respect channel privacy boundaries
- When unsure, ask for clarification
- Cite sources when providing information from logs`;

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

      // Search wiki for relevant context
      const wikiResults = await this.wikiManager.search(message.text);
      const wikiContext = wikiResults.length > 0
        ? `\n\nRelevant wiki entries:\n${wikiResults.slice(0, 3).map(r => `- ${r.title}: ${r.snippet}`).join('\n')}`
        : '';

      // Build context
      const contextMessage = `Recent conversation in this channel:
${recentMessages.slice(0, 3).join('\n---\n')}
${wikiContext}

User message: ${message.text}`;

      // Call Claude
      const response = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: contextMessage,
          },
        ],
      });

      // Extract response text
      const responseText = response.content[0].type === 'text'
        ? response.content[0].text
        : 'Sorry, I encountered an issue processing your request.';

      // Send response
      await responder.updateResponse(responseText);
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
