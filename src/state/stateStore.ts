import * as fs from 'fs';
import * as path from 'path';
import { ProcessedMessageRecord, ChannelRecord } from './types.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('StateStore');

export class StateStore {
  private stateDir: string;
  private processedDir: string;
  private channelsFile: string;

  constructor(dataDir: string) {
    this.stateDir = path.join(dataDir, 'state');
    this.processedDir = path.join(this.stateDir, 'processed');
    this.channelsFile = path.join(this.stateDir, 'channels.json');
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
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return messageTs in data;
  }

  markMessageProcessed(messageTs: string, channelId: string): void {
    const date = this.getDateFromTs(messageTs);
    const file = path.join(this.processedDir, `${date}.json`);
    let data: Record<string, ProcessedMessageRecord> = {};
    if (fs.existsSync(file)) {
      data = JSON.parse(fs.readFileSync(file, 'utf-8'));
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
    const data: Record<string, ChannelRecord> = JSON.parse(
      fs.readFileSync(this.channelsFile, 'utf-8')
    );
    return Object.values(data)
      .filter(c => c.isMember)
      .map(c => c.channelId);
  }

  markChannelJoined(channelId: string, channelName: string): void {
    let data: Record<string, ChannelRecord> = {};
    if (fs.existsSync(this.channelsFile)) {
      data = JSON.parse(fs.readFileSync(this.channelsFile, 'utf-8'));
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
    const data: Record<string, ChannelRecord> = JSON.parse(
      fs.readFileSync(this.channelsFile, 'utf-8')
    );
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

    const files = fs.readdirSync(this.processedDir);
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
}
