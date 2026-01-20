import * as fs from 'fs';
import * as path from 'path';
import { ProcessedMessageRecord, ChannelRecord, ActiveThread } from './types.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('StateStore');

export class StateStore {
  private stateDir: string;
  private processedDir: string;
  private channelsFile: string;
  private activeThreadsFile: string;

  constructor(dataDir: string) {
    this.stateDir = path.join(dataDir, 'state');
    this.processedDir = path.join(this.stateDir, 'processed');
    this.channelsFile = path.join(this.stateDir, 'channels.json');
    this.activeThreadsFile = path.join(this.stateDir, 'active-threads.json');
    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    [this.stateDir, this.processedDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  // Processed messages - stored by date to enable cleanup
  isMessageProcessed(messageTs: string): boolean {
    const date = this.getDateFromTs(messageTs);
    const file = path.join(this.processedDir, `${date}.json`);
    if (!fs.existsSync(file)) return false;
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      return messageTs in data;
    } catch {
      logger.warn('Corrupted JSON file, returning false', { file });
      return false;
    }
  }

  markMessageProcessed(messageTs: string, channelId: string): void {
    const date = this.getDateFromTs(messageTs);
    const file = path.join(this.processedDir, `${date}.json`);
    let data: Record<string, ProcessedMessageRecord> = {};
    if (fs.existsSync(file)) {
      try {
        data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      } catch {
        logger.warn('Corrupted JSON file, starting fresh', { file });
      }
    }
    data[messageTs] = { messageTs, channelId, processedAt: Date.now() };
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  }

  private getDateFromTs(ts: string): string {
    const timestamp = parseFloat(ts) * 1000;
    return new Date(timestamp).toISOString().split('T')[0];
  }

  // Channel membership
  getJoinedChannels(): string[] {
    if (!fs.existsSync(this.channelsFile)) return [];
    try {
      const data: Record<string, ChannelRecord> = JSON.parse(
        fs.readFileSync(this.channelsFile, 'utf-8')
      );
      return Object.values(data)
        .filter(c => c.isMember)
        .map(c => c.channelId);
    } catch {
      logger.warn('Corrupted channels file, returning empty', { file: this.channelsFile });
      return [];
    }
  }

  markChannelJoined(channelId: string, channelName: string): void {
    let data: Record<string, ChannelRecord> = {};
    if (fs.existsSync(this.channelsFile)) {
      try {
        data = JSON.parse(fs.readFileSync(this.channelsFile, 'utf-8'));
      } catch {
        logger.warn('Corrupted channels file, starting fresh', { file: this.channelsFile });
      }
    }
    data[channelId] = {
      channelId,
      channelName,
      joinedAt: Date.now(),
      isMember: true,
    };
    fs.writeFileSync(this.channelsFile, JSON.stringify(data, null, 2));
  }

  markChannelLeft(channelId: string): void {
    if (!fs.existsSync(this.channelsFile)) return;
    let data: Record<string, ChannelRecord>;
    try {
      data = JSON.parse(fs.readFileSync(this.channelsFile, 'utf-8'));
    } catch {
      logger.warn('Corrupted channels file, cannot mark left', { file: this.channelsFile });
      return;
    }
    if (data[channelId]) {
      data[channelId].isMember = false;
      fs.writeFileSync(this.channelsFile, JSON.stringify(data, null, 2));
    }
  }

  // Cleanup old processed messages
  cleanOldMessages(daysToKeep: number = 30): void {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysToKeep);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    const files = fs.readdirSync(this.processedDir).filter(f => f.endsWith('.json'));
    let deleted = 0;
    for (const file of files) {
      const date = file.replace('.json', '');
      if (date < cutoffStr) {
        fs.unlinkSync(path.join(this.processedDir, file));
        deleted++;
      }
    }
    logger.info('Cleaned old processed messages', { deleted });
  }

  // Active thread tracking
  private getActiveThreadsData(): Record<string, ActiveThread> {
    if (!fs.existsSync(this.activeThreadsFile)) return {};
    try {
      return JSON.parse(fs.readFileSync(this.activeThreadsFile, 'utf-8'));
    } catch {
      logger.warn('Failed to parse active threads file', { file: this.activeThreadsFile });
      return {};
    }
  }

  private saveActiveThreadsData(data: Record<string, ActiveThread>): void {
    fs.writeFileSync(this.activeThreadsFile, JSON.stringify(data, null, 2));
  }

  private threadKey(channelId: string, threadId: string): string {
    return `${channelId}:${threadId}`;
  }

  isThreadActive(channelId: string, threadId: string): boolean {
    const data = this.getActiveThreadsData();
    return this.threadKey(channelId, threadId) in data;
  }

  getActiveThread(channelId: string, threadId: string): ActiveThread | null {
    const data = this.getActiveThreadsData();
    return data[this.threadKey(channelId, threadId)] || null;
  }

  setActiveThread(thread: ActiveThread): void {
    const data = this.getActiveThreadsData();
    data[this.threadKey(thread.channelId, thread.threadId)] = thread;
    this.saveActiveThreadsData(data);
  }

  removeActiveThread(channelId: string, threadId: string): void {
    const data = this.getActiveThreadsData();
    delete data[this.threadKey(channelId, threadId)];
    this.saveActiveThreadsData(data);
  }

  getAllActiveThreads(): ActiveThread[] {
    return Object.values(this.getActiveThreadsData());
  }

  updateThreadActivity(channelId: string, threadId: string): void {
    const thread = this.getActiveThread(channelId, threadId);
    if (thread) {
      thread.lastActivity = Date.now();
      this.setActiveThread(thread);
    }
  }
}
