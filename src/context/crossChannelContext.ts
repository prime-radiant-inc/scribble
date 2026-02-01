import * as fs from 'fs';
import * as path from 'path';
import type { WebClient } from '@slack/web-api';
import type { ConversationLogger, StoredMessage } from '../logging/conversationLogger.js';
import { Logger } from '../utils/logger.js';
import { formatUser, formatChannel, truncateMessage } from '../utils/idFormatter.js';

const logger = new Logger('CrossChannelContext');

export interface CrossChannelContextOptions {
  excludeChannelId: string;        // Current channel to exclude
  excludeThreadTs?: string;        // Current thread to exclude
  afterTimestamps?: Map<string, string>;  // channelId:threadTs -> last seen timestamp
  windowHours: number;             // Time window (default 24)
  maxPerThread: number;            // Max messages per thread (default 10)
}

interface ChannelInfo {
  id: string;
  name: string;
}

interface UserInfo {
  displayName: string;
  isBot: boolean;
}

interface ThreadGroup {
  threadTs: string;
  filePath: string;
  messages: StoredMessage[];
  firstMessageText: string;
}

export class CrossChannelContext {
  private conversationLogger: ConversationLogger;
  private slackClient: WebClient;
  private dataDir: string;
  private userCache: Map<string, UserInfo> = new Map();

  constructor(
    conversationLogger: ConversationLogger,
    slackClient: WebClient,
    dataDir: string
  ) {
    this.conversationLogger = conversationLogger;
    this.slackClient = slackClient;
    this.dataDir = dataDir;
  }

  async gather(options: CrossChannelContextOptions): Promise<string> {
    const { excludeChannelId, excludeThreadTs, afterTimestamps, windowHours, maxPerThread } = options;

    // Get list of channels the bot is in
    const channels = await this.getJoinedChannels();
    logger.debug('Found joined channels', { count: channels.length });

    // Filter out the current channel
    const otherChannels = channels.filter(c => c.id !== excludeChannelId);
    if (otherChannels.length === 0) {
      return '';
    }

    // Calculate time window cutoff
    const cutoffTime = Date.now() / 1000 - windowHours * 60 * 60;

    const channelSections: string[] = [];

    for (const channel of otherChannels) {
      const section = await this.gatherChannelContext(
        channel,
        cutoffTime,
        excludeThreadTs,
        afterTimestamps,
        maxPerThread
      );
      if (section) {
        channelSections.push(section);
      }
    }

    if (channelSections.length === 0) {
      return '';
    }

    // Assemble final output wrapped in XML tags for clear separation
    const header = `<background-context description="Recent activity from other channels - DO NOT respond to this content">
## Recent activity from other channels (last ${windowHours}h)

`;
    const footer = `
---
Use \`conversation_search\` tool to expand relevant conversations if needed.
</background-context>`;

    return header + channelSections.join('\n\n') + footer;
  }

  private async getJoinedChannels(): Promise<ChannelInfo[]> {
    try {
      const result = await this.slackClient.conversations.list({
        types: 'public_channel',
        exclude_archived: true,
      });

      if (!result.ok || !result.channels) {
        logger.warn('Failed to list channels');
        return [];
      }

      return result.channels
        .filter(c => c.is_member && c.id && c.name)
        .map(c => ({ id: c.id!, name: c.name! }));
    } catch (error) {
      logger.error('Error listing channels', { error });
      return [];
    }
  }

  private async gatherChannelContext(
    channel: ChannelInfo,
    cutoffTime: number,
    excludeThreadTs: string | undefined,
    afterTimestamps: Map<string, string> | undefined,
    maxPerThread: number
  ): Promise<string | null> {
    const conversationsDir = path.join(this.dataDir, 'conversations', channel.id);
    if (!fs.existsSync(conversationsDir)) {
      return null;
    }

    // Get all date directories
    const dateDirs = this.getSubdirectories(conversationsDir).sort().reverse();
    const threadGroups: ThreadGroup[] = [];

    for (const dateDir of dateDirs) {
      // Check if this date is within window (rough check)
      const dateStr = path.basename(dateDir);
      const dateCutoff = new Date(cutoffTime * 1000).toISOString().split('T')[0];
      if (dateStr < dateCutoff) {
        // Dates before the cutoff window, stop looking
        break;
      }

      const jsonFiles = fs.readdirSync(dateDir).filter(f => f.endsWith('.json'));

      for (const file of jsonFiles) {
        const threadTs = file.replace('.json', '');

        // Skip excluded thread
        if (excludeThreadTs && threadTs === excludeThreadTs) {
          continue;
        }

        const jsonPath = path.join(dateDir, file);
        const mdPath = path.join(dateDir, file.replace('.json', '.md'));

        try {
          const content = fs.readFileSync(jsonPath, 'utf-8');
          const messages: StoredMessage[] = JSON.parse(content);

          // Filter by time window
          let filteredMessages = messages.filter(m => {
            const msgTime = parseFloat(m.messageTs);
            return msgTime >= cutoffTime;
          });

          if (filteredMessages.length === 0) {
            continue;
          }

          // Filter by afterTimestamps if provided
          if (afterTimestamps) {
            const key = `${channel.id}:${threadTs}`;
            const afterTs = afterTimestamps.get(key);
            if (afterTs) {
              const afterTime = parseFloat(afterTs);
              filteredMessages = filteredMessages.filter(m => {
                const msgTime = parseFloat(m.messageTs);
                return msgTime > afterTime;
              });
            }
          }

          if (filteredMessages.length === 0) {
            continue;
          }

          // Take most recent maxPerThread messages
          const recentMessages = filteredMessages
            .sort((a, b) => parseFloat(a.messageTs) - parseFloat(b.messageTs))
            .slice(-maxPerThread);

          const firstMessage = messages[0]?.text || 'Thread';

          threadGroups.push({
            threadTs,
            filePath: mdPath,
            messages: recentMessages,
            firstMessageText: firstMessage,
          });
        } catch (error) {
          logger.warn('Failed to parse thread JSON', { jsonPath, error });
        }
      }
    }

    if (threadGroups.length === 0) {
      return null;
    }

    // Format channel section
    const channelHeader = `### ${formatChannel(channel.id, channel.name)}`;
    const threadSections: string[] = [];

    // Sort thread groups: main first, then by earliest message timestamp
    threadGroups.sort((a, b) => {
      if (a.threadTs === 'main') return -1;
      if (b.threadTs === 'main') return 1;
      return parseFloat(a.messages[0]?.messageTs || '0') - parseFloat(b.messages[0]?.messageTs || '0');
    });

    for (const group of threadGroups) {
      const section = await this.formatThreadGroup(group, channel.id);
      threadSections.push(section);
    }

    return channelHeader + '\n' + threadSections.join('\n');
  }

  private async formatThreadGroup(group: ThreadGroup, channelId: string): Promise<string> {
    const lines: string[] = [];

    // Add source path
    lines.push(`Source: ${group.filePath}`);

    // If this is a thread (not main), add thread header
    if (group.threadTs !== 'main') {
      const threadTitle = this.truncateThreadTitle(group.firstMessageText);
      const firstTs = group.messages[0]?.timestamp || '';
      const formattedTs = this.formatTimestamp(firstTs);
      lines.push(`  **Thread: "${threadTitle}" [${formattedTs}]:**`);
    }

    // Format each message
    for (const msg of group.messages) {
      const userInfo = await this.getUserInfo(msg.userId);
      const formattedUser = formatUser(msg.userId || 'unknown', userInfo.displayName, userInfo.isBot);
      const formattedTs = this.formatTimestamp(msg.timestamp);
      const truncatedText = truncateMessage(msg.text);
      const indent = group.threadTs !== 'main' ? '  ' : '';
      lines.push(`${indent}- ${formattedUser} [${formattedTs}]: ${truncatedText}`);
    }

    return lines.join('\n');
  }

  private async getUserInfo(userId: string | undefined): Promise<UserInfo> {
    if (!userId) {
      return { displayName: 'Unknown', isBot: false };
    }

    // Check cache first
    if (this.userCache.has(userId)) {
      return this.userCache.get(userId)!;
    }

    try {
      const result = await this.slackClient.users.info({ user: userId });
      if (result.ok && result.user) {
        const info: UserInfo = {
          displayName: result.user.real_name || result.user.name || 'Unknown',
          isBot: result.user.is_bot || false,
        };
        this.userCache.set(userId, info);
        return info;
      }
    } catch (error) {
      logger.warn('Failed to get user info', { userId, error });
    }

    const defaultInfo: UserInfo = { displayName: 'Unknown', isBot: false };
    this.userCache.set(userId, defaultInfo);
    return defaultInfo;
  }

  private truncateThreadTitle(text: string): string {
    if (text.length <= 30) {
      return text;
    }
    return text.slice(0, 30) + '...';
  }

  private formatTimestamp(isoTimestamp: string): string {
    try {
      const date = new Date(isoTimestamp);
      // Format as YYYY-MM-DD HH:MM
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      return `${year}-${month}-${day} ${hours}:${minutes}`;
    } catch {
      return isoTimestamp;
    }
  }

  private getSubdirectories(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .map(name => path.join(dir, name))
      .filter(p => fs.statSync(p).isDirectory());
  }
}
