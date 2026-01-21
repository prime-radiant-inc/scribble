import { ConversationLogger } from '../logging/conversationLogger.js';
import { ContextMessage, AssembledContext, ContextOptions, ThreadMessage } from './types.js';
import { SlackMessage } from '../core/types.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('ContextAssembler');

const DEFAULT_OPTIONS: ContextOptions = {
  maxMessages: 20,
  maxTokens: 4000,
  includeWiki: true,
  includeLinear: true,
};

// WikiManager interface for type safety when wiki is available
interface WikiManager {
  search(query: string): Promise<Array<{ title: string; snippet: string }>>;
}

export class ContextAssembler {
  private conversationLogger: ConversationLogger;
  private wikiManager: WikiManager | null;

  constructor(conversationLogger: ConversationLogger, wikiManager: WikiManager | null) {
    this.conversationLogger = conversationLogger;
    this.wikiManager = wikiManager;
  }

  async assemble(
    message: SlackMessage,
    options: ContextOptions = {}
  ): Promise<AssembledContext> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    // Get structured thread messages for the conversation
    const threadMessages = await this.getThreadMessages(message);

    // Build background context for system prompt
    const channelRecent = await this.getChannelRecent(message, opts.maxMessages!);
    const crossChannel = await this.getCrossChannelContext(message, opts.maxMessages!);
    const wikiReferences = opts.includeWiki
      ? await this.getWikiReferences(message.text)
      : '';

    const backgroundParts: string[] = [];
    if (channelRecent) {
      backgroundParts.push(`## Recent Channel Activity\n${channelRecent}`);
    }
    if (crossChannel) {
      backgroundParts.push(`## Related Context from Other Channels\n${crossChannel}`);
    }
    if (wikiReferences) {
      backgroundParts.push(`## Wiki References\n${wikiReferences}`);
    }

    return {
      threadMessages,
      backgroundContext: backgroundParts.join('\n\n'),
    };
  }

  private async getThreadMessages(message: SlackMessage): Promise<ThreadMessage[]> {
    const threadTs = message.threadTs || message.messageTs;
    const messages = await this.conversationLogger.getThreadMessages(message.channelId, threadTs);

    return messages.map(m => ({
      role: m.role,
      userName: m.userName || 'Unknown',
      text: m.text,
    }));
  }

  private async getChannelRecent(message: SlackMessage, limit: number): Promise<string> {
    const messages = await this.conversationLogger.getRecentMessages(message.channelId, limit);
    return messages.slice(0, limit).join('\n\n---\n\n');
  }

  private async getCrossChannelContext(message: SlackMessage, limit: number): Promise<string> {
    const searchTerms = this.extractSearchTerms(message.text);
    if (searchTerms.length === 0) return '';

    const results = await this.conversationLogger.search(searchTerms.join(' '), { limit });
    const crossChannelResults = results.filter(r => r.channelId !== message.channelId);

    return crossChannelResults
      .map(r => `[From #${r.channelId}, ${r.date}]\n${r.snippet}`)
      .join('\n\n');
  }

  /**
   * Extract meaningful search terms from text, filtering out stop words
   */
  extractSearchTerms(text: string): string[] {
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
      'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
      'and', 'but', 'if', 'or', 'because', 'until', 'while',
      'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her',
      'it', 'its', 'they', 'them', 'their', 'what', 'which', 'who', 'this', 'that',
      'over', 'runs',
    ]);

    const words = text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w));

    return [...new Set(words)].slice(0, 5);
  }

  private async getWikiReferences(text: string): Promise<string> {
    if (!this.wikiManager) return '';

    try {
      const searchTerms = this.extractSearchTerms(text);
      if (searchTerms.length === 0) return '';

      const results = await this.wikiManager.search(searchTerms.join(' '));
      return results
        .slice(0, 3)
        .map(r => `[Wiki: ${r.title}]\n${r.snippet}`)
        .join('\n\n');
    } catch (error) {
      logger.warn('Wiki search failed', { error: String(error) });
      return '';
    }
  }

  formatCrossChannelContext(
    messages: ContextMessage[],
    options: { maxMessages?: number } = {}
  ): string {
    const limit = options.maxMessages || 20;
    return messages
      .slice(0, limit)
      .map(m => {
        const date = new Date(m.timestamp).toLocaleDateString();
        return `[From #${m.channelName}, ${date}]\n${m.userName}: ${m.text}`;
      })
      .join('\n\n');
  }
}
