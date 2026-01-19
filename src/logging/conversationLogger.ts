import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../utils/logger.js';
import { SlackMessage } from '../core/types.js';

const logger = new Logger('ConversationLogger');

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
   * Structure: conversations/{channel_id}/{date}/{thread_ts}.md
   */
  async logMessage(message: SlackMessage): Promise<void> {
    const dateStr = this.getDateString();
    const channelDir = path.join(this.dataDir, message.channelId, dateStr);

    if (!fs.existsSync(channelDir)) {
      fs.mkdirSync(channelDir, { recursive: true });
    }

    // Use thread_ts if in a thread, otherwise use message_ts
    const threadId = message.threadTs ?? message.messageTs;
    const threadFile = path.join(channelDir, `${threadId}.md`);

    const formattedMessage = this.formatMessage(message);

    // Append to the thread file
    fs.appendFileSync(threadFile, formattedMessage);

    logger.debug('Logged message', {
      channel: message.channelId,
      thread: threadId,
      user: message.userName,
    });
  }

  /**
   * Format a message for the log file
   */
  private formatMessage(message: SlackMessage): string {
    const timestamp = new Date(parseFloat(message.messageTs) * 1000).toISOString();
    const header = `### ${message.userName} (${timestamp})`;

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
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  }): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const limit = options?.limit ?? 50;
    const queryLower = query.toLowerCase();

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
        if (options?.startDate && dateStr < this.formatDate(options.startDate)) continue;
        if (options?.endDate && dateStr > this.formatDate(options.endDate)) continue;

        const files = fs.readdirSync(dateDir).filter(f => f.endsWith('.md'));
        for (const file of files) {
          const filePath = path.join(dateDir, file);
          const content = fs.readFileSync(filePath, 'utf-8');

          if (content.toLowerCase().includes(queryLower)) {
            const snippet = this.extractSnippet(content, queryLower);
            results.push({
              channelId: path.basename(channelDir),
              date: dateStr,
              threadTs: file.replace('.md', ''),
              filePath,
              snippet,
            });

            if (results.length >= limit) {
              return results;
            }
          }
        }
      }
    }

    return results;
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
}
