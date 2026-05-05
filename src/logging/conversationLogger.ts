import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../utils/logger.js';
import { SlackMessage, ConversationMessage } from '../core/types.js';
import { formatUser } from '../utils/idFormatter.js';

const logger = new Logger('ConversationLogger');
const SLACK_CHANNEL_ID = /^[A-Z0-9]{9,}$/;

function isValidSlackChannelId(id: string): boolean {
  return SLACK_CHANNEL_ID.test(id);
}

export interface StoredMessage {
  role: 'user' | 'assistant';
  userId?: string;
  userName: string;
  text: string;
  timestamp: string;
  messageTs: string;
}

export class ConversationLogger {
  private dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = path.join(dataDir, 'conversations');
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  /**
   * Log a message to the appropriate channel/thread file
   * Structure: conversations/{channel_id}/{date}/{thread_ts}.md and .json
   * @deprecated Use logChannelMessage instead
   */
  async logMessage(message: SlackMessage): Promise<void> {
    return this.logChannelMessage(message);
  }

  /**
   * Log a message - routes to main or thread file based on threadTs
   * Main channel messages go to main.md/main.json
   * Thread messages go to {thread_ts}.md/{thread_ts}.json
   */
  async logChannelMessage(message: SlackMessage): Promise<void> {
    if (message.threadTs) {
      return this.logThreadMessage(message);
    }
    return this.logMainMessage(message);
  }

  /**
   * Log a message to the main channel file (not in a thread)
   */
  private async logMainMessage(message: SlackMessage): Promise<void> {
    const dateStr = this.getDateString();
    const channelDir = path.join(this.dataDir, message.channelId, dateStr);

    if (!fs.existsSync(channelDir)) {
      fs.mkdirSync(channelDir, { recursive: true });
    }

    const mainFile = path.join(channelDir, 'main.md');
    const mainJson = path.join(channelDir, 'main.json');

    const formattedMessage = this.formatMessage(message);
    fs.appendFileSync(mainFile, formattedMessage);

    const storedMessage: StoredMessage = {
      role: 'user',
      userId: message.userId,
      userName: message.userName,
      text: message.text,
      timestamp: new Date(parseFloat(message.messageTs) * 1000).toISOString(),
      messageTs: message.messageTs,
    };
    this.appendToJsonFile(mainJson, storedMessage);

    logger.debug('Channel message logged to main', {
      channel: message.channelId,
      messageTs: message.messageTs,
    });
  }

  /**
   * Log a message to a thread-specific file
   */
  private async logThreadMessage(message: SlackMessage): Promise<void> {
    const dateStr = this.getDateString();
    const channelDir = path.join(this.dataDir, message.channelId, dateStr);

    if (!fs.existsSync(channelDir)) {
      fs.mkdirSync(channelDir, { recursive: true });
    }

    const threadId = message.threadTs!;
    const threadFile = path.join(channelDir, `${threadId}.md`);
    const jsonFile = path.join(channelDir, `${threadId}.json`);

    const formattedMessage = this.formatMessage(message);
    fs.appendFileSync(threadFile, formattedMessage);

    const storedMessage: StoredMessage = {
      role: 'user',
      userId: message.userId,
      userName: message.userName,
      text: message.text,
      timestamp: new Date(parseFloat(message.messageTs) * 1000).toISOString(),
      messageTs: message.messageTs,
    };
    this.appendToJsonFile(jsonFile, storedMessage);

    logger.debug('Thread message logged', {
      channel: message.channelId,
      thread: threadId,
      messageTs: message.messageTs,
    });
  }

  /**
   * Get recent main channel context for a channel
   * Loads from main.json files across recent dates
   */
  async getChannelContext(channelId: string, limit: number = 100): Promise<StoredMessage[]> {
    if (!isValidSlackChannelId(channelId)) {
      logger.warn('Rejecting malformed channel_id in getChannelContext', { channelId });
      return [];
    }

    const channelDir = path.join(this.dataDir, channelId);
    if (!fs.existsSync(channelDir)) {
      return [];
    }

    const allMessages: StoredMessage[] = [];
    const dateDirs = this.getSubdirectories(channelDir).sort().reverse(); // Most recent first

    for (const dateDir of dateDirs) {
      const mainJson = path.join(dateDir, 'main.json');
      if (fs.existsSync(mainJson)) {
        try {
          const content = fs.readFileSync(mainJson, 'utf-8');
          const messages: StoredMessage[] = JSON.parse(content);
          allMessages.push(...messages);
          if (allMessages.length >= limit) break;
        } catch (error) {
          logger.warn('Failed to parse main.json', { mainJson, error });
        }
      }
    }

    // Sort by timestamp and limit
    return allMessages
      .sort((a, b) => parseFloat(a.messageTs) - parseFloat(b.messageTs))
      .slice(-limit);
  }

  /**
   * Log a bot response to the thread
   */
  async logBotResponse(
    channelId: string,
    threadTs: string,
    text: string,
    responseTs: string
  ): Promise<void> {
    const dateStr = this.getDateString();
    const channelDir = path.join(this.dataDir, channelId, dateStr);

    if (!fs.existsSync(channelDir)) {
      fs.mkdirSync(channelDir, { recursive: true });
    }

    const threadFile = path.join(channelDir, `${threadTs}.md`);
    const jsonFile = path.join(channelDir, `${threadTs}.json`);

    // Append to markdown
    const timestamp = new Date(parseFloat(responseTs) * 1000).toISOString();
    const formattedResponse = `### Scribble (${timestamp})\n\n${text}\n\n---\n\n`;
    fs.appendFileSync(threadFile, formattedResponse);

    // Append to JSON
    const storedMessage: StoredMessage = {
      role: 'assistant',
      userName: 'Scribble',
      text,
      timestamp,
      messageTs: responseTs,
    };
    this.appendToJsonFile(jsonFile, storedMessage);

    logger.info('Bot response logged to thread', {
      channel: channelId,
      thread: threadTs,
      responseTs,
      file: jsonFile,
    });
  }

  /**
   * Get thread messages as structured conversation turns
   * Searches all date directories and merges messages from fragmented thread files
   */
  async getThreadMessages(channelId: string, threadTs: string): Promise<ConversationMessage[]> {
    if (!isValidSlackChannelId(channelId)) {
      logger.warn('Rejecting malformed channel_id in getThreadMessages', { channelId });
      return [];
    }

    const channelDir = path.join(this.dataDir, channelId);
    if (!fs.existsSync(channelDir)) {
      logger.info('No channel directory found', { channel: channelId });
      return [];
    }

    // Collect messages from all date directories that have this thread
    const allMessages: StoredMessage[] = [];
    const foundFiles: string[] = [];
    const dateDirs = this.getSubdirectories(channelDir).sort(); // Sort chronologically

    for (const dateDir of dateDirs) {
      const jsonFile = path.join(dateDir, `${threadTs}.json`);
      if (fs.existsSync(jsonFile)) {
        try {
          const content = fs.readFileSync(jsonFile, 'utf-8');
          const messages: StoredMessage[] = JSON.parse(content);
          allMessages.push(...messages);
          foundFiles.push(jsonFile);
        } catch (error) {
          logger.warn('Failed to parse thread JSON', { jsonFile, error });
        }
      }
    }

    if (allMessages.length === 0) {
      logger.info('No thread history found', {
        channel: channelId,
        thread: threadTs,
      });
      return [];
    }

    // Sort by messageTs to ensure correct order and deduplicate by messageTs
    const seen = new Set<string>();
    const dedupedMessages = allMessages
      .sort((a, b) => parseFloat(a.messageTs) - parseFloat(b.messageTs))
      .filter(m => {
        if (seen.has(m.messageTs)) return false;
        seen.add(m.messageTs);
        return true;
      });

    logger.info('Thread history loaded (merged from multiple dates)', {
      channel: channelId,
      thread: threadTs,
      files: foundFiles,
      totalMessages: dedupedMessages.length,
    });

    return dedupedMessages.map(m => ({
      role: m.role,
      userId: m.userId,
      userName: m.userName,
      text: m.text,
      timestamp: m.timestamp,
    }));
  }

  private appendToJsonFile(filePath: string, message: StoredMessage): void {
    let messages: StoredMessage[] = [];
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        messages = JSON.parse(content);
      } catch {
        // Start fresh if corrupted
        messages = [];
      }
    }
    messages.push(message);
    fs.writeFileSync(filePath, JSON.stringify(messages, null, 2));
  }

  /**
   * Format a message for the log file
   */
  private formatMessage(message: SlackMessage): string {
    const timestamp = new Date(parseFloat(message.messageTs) * 1000).toISOString();
    // Use ID formatter - assume non-bot for now, bot detection happens at a higher level
    const userDisplay = formatUser(message.userId, message.userName, false);
    const header = `### ${userDisplay} (${timestamp})`;

    let content = message.text;

    // Add file info if present
    if (message.files && message.files.length > 0) {
      const fileList = message.files
        .map(f => `- ${f.name} (${f.mimetype}, ${f.size} bytes)`)
        .join('\n');
      content += `\n\n**Attachments:**\n${fileList}`;
    }

    return `${header}\n\n${content}\n\n---\n\n`;
  }

  /**
   * Get current date string for directory naming
   */
  private getDateString(): string {
    const now = new Date();
    return now.toISOString().split('T')[0]; // YYYY-MM-DD
  }

  /**
   * Search conversations for a query
   * Returns matching file paths and snippets
   */
  async search(query: string, options?: {
    channelId?: string;
    date?: string;           // YYYY-MM-DD or YYYY-MM-DD:YYYY-MM-DD
    context?: number;        // messages before/after
    startDate?: Date;        // Keep for backward compat
    endDate?: Date;          // Keep for backward compat
    limit?: number;
  }): Promise<SearchResult[]> {
    if (options?.channelId !== undefined && !isValidSlackChannelId(options.channelId)) {
      logger.warn('Rejecting malformed channel_id in search', { channelId: options.channelId });
      return [];
    }

    const results: SearchResult[] = [];
    const limit = options?.limit ?? 50;
    const queryLower = query.toLowerCase();

    // Parse date option into start/end dates
    let effectiveStartDate: string | undefined;
    let effectiveEndDate: string | undefined;

    if (options?.date) {
      const { startDate, endDate } = this.parseDateOption(options.date);
      effectiveStartDate = startDate;
      effectiveEndDate = endDate;
    } else {
      effectiveStartDate = options?.startDate ? this.formatDate(options.startDate) : undefined;
      effectiveEndDate = options?.endDate ? this.formatDate(options.endDate) : undefined;
    }

    // Walk through conversation directories
    const channelDirs = options?.channelId
      ? [path.join(this.dataDir, options.channelId)]
      : this.getSubdirectories(this.dataDir);

    for (const channelDir of channelDirs) {
      if (!fs.existsSync(channelDir)) continue;

      const dateDirs = this.getSubdirectories(channelDir);
      for (const dateDir of dateDirs) {
        // Check date filter
        const dateStr = path.basename(dateDir);
        if (effectiveStartDate && dateStr < effectiveStartDate) continue;
        if (effectiveEndDate && dateStr > effectiveEndDate) continue;

        const files = fs.readdirSync(dateDir).filter(f => f.endsWith('.md'));
        for (const file of files) {
          const filePath = path.join(dateDir, file);
          const content = fs.readFileSync(filePath, 'utf-8');

          if (content.toLowerCase().includes(queryLower)) {
            const snippet = this.extractSnippet(content, queryLower);
            const result: SearchResult = {
              channelId: path.basename(channelDir),
              date: dateStr,
              threadTs: file.replace('.md', ''),
              filePath,
              snippet,
            };

            // Load context messages if requested
            if (options?.context && options.context > 0) {
              const jsonFile = filePath.replace('.md', '.json');
              result.contextMessages = this.getContextMessages(jsonFile, query, options.context);
            }

            results.push(result);

            if (results.length >= limit) {
              return results;
            }
          }
        }
      }
    }

    return results;
  }

  /**
   * Parse date option string into start and end dates
   * Supports: "YYYY-MM-DD" (single day) or "YYYY-MM-DD:YYYY-MM-DD" (range)
   */
  private parseDateOption(dateOption: string): { startDate: string; endDate: string } {
    if (dateOption.includes(':')) {
      const [startDate, endDate] = dateOption.split(':');
      return { startDate, endDate };
    }
    // Single date - filter to that day only
    return { startDate: dateOption, endDate: dateOption };
  }

  /**
   * Get context messages around a search match from a JSON file
   */
  private getContextMessages(jsonFile: string, query: string, contextCount: number): StoredMessage[] {
    if (!fs.existsSync(jsonFile)) {
      return [];
    }

    try {
      const content = fs.readFileSync(jsonFile, 'utf-8');
      const messages: StoredMessage[] = JSON.parse(content);
      const queryLower = query.toLowerCase();

      // Find the message that matches the query
      const matchIndex = messages.findIndex(m => m.text.toLowerCase().includes(queryLower));
      if (matchIndex === -1) {
        return [];
      }

      // Return N messages before and N after (plus the match)
      const startIndex = Math.max(0, matchIndex - contextCount);
      const endIndex = Math.min(messages.length, matchIndex + contextCount + 1);

      return messages.slice(startIndex, endIndex);
    } catch (error) {
      logger.warn('Failed to load context messages', { jsonFile, error });
      return [];
    }
  }

  private getSubdirectories(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .map(name => path.join(dir, name))
      .filter(p => fs.statSync(p).isDirectory());
  }

  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  private extractSnippet(content: string, query: string): string {
    const lines = content.split('\n');
    const queryLower = query.toLowerCase();

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(queryLower)) {
        // Return surrounding context
        const start = Math.max(0, i - 2);
        const end = Math.min(lines.length, i + 3);
        return lines.slice(start, end).join('\n');
      }
    }

    return content.substring(0, 200) + '...';
  }

  /**
   * Get recent messages from a channel
   */
  async getRecentMessages(channelId: string, limit: number = 10): Promise<string[]> {
    if (!isValidSlackChannelId(channelId)) {
      logger.warn('Rejecting malformed channel_id in getRecentMessages', { channelId });
      return [];
    }

    const channelDir = path.join(this.dataDir, channelId);
    if (!fs.existsSync(channelDir)) return [];

    const messages: string[] = [];
    const dateDirs = this.getSubdirectories(channelDir).sort().reverse();

    for (const dateDir of dateDirs) {
      const files = fs.readdirSync(dateDir)
        .filter(f => f.endsWith('.md'))
        .sort()
        .reverse();

      for (const file of files) {
        const content = fs.readFileSync(path.join(dateDir, file), 'utf-8');
        messages.push(content);

        if (messages.length >= limit) {
          return messages;
        }
      }
    }

    return messages;
  }
}

export interface SearchResult {
  channelId: string;
  date: string;
  threadTs: string;
  filePath: string;
  snippet: string;
  contextMessages?: StoredMessage[];
}
