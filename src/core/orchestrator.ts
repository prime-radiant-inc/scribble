import Anthropic from '@anthropic-ai/sdk';
import { Logger } from '../utils/logger.js';
import { SlackMessage, ExtractedFact } from './types.js';
import { ConversationLogger } from '../logging/conversationLogger.js';
import { WikiManager } from '../wiki/wikiManager.js';
import { SlackResponder } from '../slack/responder.js';
import { Config } from '../config/config.js';
import { AttentionTracker } from '../attention/tracker.js';
import { MessageClassifier } from '../pipeline/classifier.js';
import { KnowledgeExtractor } from '../pipeline/extractor.js';
import { ContextAssembler } from '../context/assembler.js';
import { ConstitutionManager } from '../constitution/manager.js';
import { StandupTracker } from '../standup/tracker.js';
import { StateStore } from '../state/stateStore.js';
import { ClassificationResult } from '../pipeline/types.js';

const logger = new Logger('Orchestrator');

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
  stateStore: StateStore;
  conversationLogger: ConversationLogger;
  wikiManager: WikiManager;
  botUserId: string;
}

export class ScribbleOrchestrator {
  private anthropic: Anthropic;
  private conversationLogger: ConversationLogger;
  private wikiManager: WikiManager;
  private config: Config;
  private stateStore: StateStore;
  private botUserId: string;

  // New pipeline components
  private classifier: MessageClassifier;
  private extractor: KnowledgeExtractor;
  private contextAssembler: ContextAssembler;
  private constitutionManager: ConstitutionManager;
  private standupTracker: StandupTracker;
  private attentionTracker: AttentionTracker;

  constructor(opts: OrchestratorConfig) {
    this.config = opts.config;
    this.conversationLogger = opts.conversationLogger;
    this.wikiManager = opts.wikiManager;
    this.stateStore = opts.stateStore;
    this.botUserId = opts.botUserId;

    this.anthropic = new Anthropic({
      apiKey: this.config.anthropic.apiKey,
    });

    // Initialize new components
    this.classifier = new MessageClassifier(opts.botUserId);
    this.extractor = new KnowledgeExtractor(this.anthropic);
    this.contextAssembler = new ContextAssembler(opts.conversationLogger, opts.wikiManager);
    // ConstitutionManager uses the wiki directory if available, otherwise data directory
    const constitutionDir = opts.config.wiki?.localPath || opts.config.dataDirectory;
    this.constitutionManager = new ConstitutionManager(constitutionDir);
    this.standupTracker = new StandupTracker(opts.config.dataDirectory);
    this.attentionTracker = new AttentionTracker(opts.stateStore, opts.botUserId);
  }

  /**
   * Update the bot user ID (called after Slack adapter initializes)
   */
  setBotUserId(botUserId: string): void {
    this.botUserId = botUserId;
    // Recreate components that depend on bot user ID
    this.classifier = new MessageClassifier(botUserId);
    this.attentionTracker = new AttentionTracker(this.stateStore, botUserId);
  }

  /**
   * Main message processing pipeline
   * Three stages: Classify -> Extract -> Respond (if engaged)
   */
  async processMessage(message: SlackMessage, responder?: SlackResponder): Promise<void> {
    // Always log
    await this.conversationLogger.logMessage(message);

    // Stage 1: Classify
    const classification = this.classifier.classify(message);

    // Stage 2: Extract (background, don't block)
    this.extractor.extract(message).then(extraction => {
      logger.debug('Extracted knowledge', { extraction });
    }).catch(err => logger.error('Extraction failed', err));

    // Handle standup if detected
    if (classification.isStandup) {
      await this.handleStandup(message, classification);
    }

    // Stage 3: Respond (only if engaged)
    const threadId = message.threadTs || message.messageTs;

    // Check for dismissal first
    if (this.attentionTracker.isEngaged(message.channelId, threadId)) {
      if (this.attentionTracker.checkDisengagement(message.channelId, threadId, message.text)) {
        logger.info('Disengaged from thread', { threadId });
        return;
      }
      this.attentionTracker.updateActivity(message.channelId, threadId);
    }

    // Determine if we should respond
    const shouldRespond = classification.requiresResponse ||
      this.attentionTracker.isEngaged(message.channelId, threadId);

    if (shouldRespond && responder) {
      // Engage if not already
      if (!this.attentionTracker.isEngaged(message.channelId, threadId)) {
        this.attentionTracker.engage(
          message.channelId,
          threadId,
          message.channelName,
          message.text.substring(0, 100)
        );
      }

      await this.handleInteractiveMessage(message, responder);
    }
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

      // Assemble context
      const context = await this.contextAssembler.assemble(message);

      // Get constitution (includes learned behaviors)
      const constitution = this.constitutionManager.getFullConstitution();

      // Build user message with context
      const contextMessage = `## Current Thread
${context.currentThread || 'New conversation'}

## Recent Channel Activity
${context.channelRecent || 'None'}

## Relevant Context from Other Channels
${context.crossChannel || 'None'}

## Wiki References
${context.wikiReferences || 'None'}

---

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
          system: constitution,
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

    } catch (error) {
      logger.error('Error handling interactive message', { error, messageTs: message.messageTs });
      await responder.clearProcessing();
      await responder.markError();
      await responder.reply('Sorry, I encountered an error processing your message.');
    }
  }

  /**
   * Handle standup messages - extract and track commitments
   */
  private async handleStandup(message: SlackMessage, classification: ClassificationResult): Promise<void> {
    // Extract standup components
    const commitments = classification.hasCommitment
      ? message.text.match(/(?:today|will|going to)[:\s]+([^\n]+)/gi)?.map(m => m.replace(/^[^:]+:\s*/, '')) || []
      : [];

    const completed = message.text.match(/(?:yesterday|did)[:\s]+([^\n]+)/gi)?.map(m => m.replace(/^[^:]+:\s*/, '')) || [];

    // Record the standup
    this.standupTracker.recordStandup({
      person: message.userId,
      personName: message.userName,
      date: new Date().toISOString().split('T')[0],
      commitments,
      blockers: [],
      completed,
      rawText: message.text,
    });
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
            category: category.split('/')[0] as 'knowledge' | 'task' | 'issue',
            subcategory: category.split('/')[1],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });

          await this.wikiManager.commit(`Add: ${title}`);

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

  private titleToFilename(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50);
  }

  // Legacy methods for backward compatibility with SlackAdapter

  /**
   * Log a message to the conversation logs
   * @deprecated Use processMessage instead
   */
  async logMessage(message: SlackMessage): Promise<void> {
    await this.conversationLogger.logMessage(message);
  }

  /**
   * Mine a message for facts (background processing)
   * @deprecated Use processMessage instead - extraction happens automatically
   */
  async mineMessage(message: SlackMessage): Promise<void> {
    // Skip very short messages
    if (message.text.length < 20) return;

    // Skip messages that are just links or reactions
    if (message.text.match(/^<[^>]+>$/)) return;

    // Use the new extractor
    try {
      const extraction = await this.extractor.extract(message);
      logger.debug('Mined message', { extraction });
    } catch (error) {
      logger.error('Failed to mine message', { error, messageTs: message.messageTs });
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
