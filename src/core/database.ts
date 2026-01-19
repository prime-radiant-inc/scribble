import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../utils/logger.js';

const logger = new Logger('Database');

export interface ProcessedMessage {
  messageTs: string;
  channelId: string;
  processedAt: number;
  mined: boolean;
}

export class ScribbleDatabase {
  private db: Database.Database;

  constructor(dbPath: string) {
    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initialize();
    logger.info('Database initialized', { dbPath });
  }

  private initialize() {
    const schema = `
      -- Track processed messages for deduplication
      CREATE TABLE IF NOT EXISTS processed_messages (
        message_ts TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        processed_at INTEGER NOT NULL,
        mined INTEGER NOT NULL DEFAULT 0
      );

      -- Track channel membership
      CREATE TABLE IF NOT EXISTS channels (
        channel_id TEXT PRIMARY KEY,
        channel_name TEXT NOT NULL,
        joined_at INTEGER NOT NULL,
        is_member INTEGER NOT NULL DEFAULT 1
      );

      -- Track wiki entries we've created
      CREATE TABLE IF NOT EXISTS wiki_entries (
        path TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        category TEXT NOT NULL,
        source_channel TEXT,
        source_message TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Track conversations with users (for interactive mode)
      CREATE TABLE IF NOT EXISTS conversations (
        channel_id TEXT NOT NULL,
        thread_ts TEXT,
        user_id TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        last_message_at INTEGER NOT NULL,
        PRIMARY KEY (channel_id, thread_ts)
      );

      CREATE INDEX IF NOT EXISTS idx_processed_time ON processed_messages(processed_at);
      CREATE INDEX IF NOT EXISTS idx_channels_member ON channels(is_member);
    `;
    this.db.exec(schema);
  }

  isMessageProcessed(messageTs: string): boolean {
    const stmt = this.db.prepare('SELECT 1 FROM processed_messages WHERE message_ts = ?');
    return !!stmt.get(messageTs);
  }

  markMessageProcessed(messageTs: string, channelId: string, mined: boolean = false): void {
    const now = Date.now();
    const stmt = this.db.prepare(
      'INSERT OR REPLACE INTO processed_messages (message_ts, channel_id, processed_at, mined) VALUES (?, ?, ?, ?)'
    );
    stmt.run(messageTs, channelId, now, mined ? 1 : 0);
  }

  markMessageMined(messageTs: string): void {
    const stmt = this.db.prepare('UPDATE processed_messages SET mined = 1 WHERE message_ts = ?');
    stmt.run(messageTs);
  }

  // Channel tracking
  getJoinedChannels(): string[] {
    const stmt = this.db.prepare('SELECT channel_id FROM channels WHERE is_member = 1');
    return (stmt.all() as { channel_id: string }[]).map(r => r.channel_id);
  }

  markChannelJoined(channelId: string, channelName: string): void {
    const now = Date.now();
    const stmt = this.db.prepare(
      'INSERT OR REPLACE INTO channels (channel_id, channel_name, joined_at, is_member) VALUES (?, ?, ?, 1)'
    );
    stmt.run(channelId, channelName, now);
  }

  markChannelLeft(channelId: string): void {
    const stmt = this.db.prepare('UPDATE channels SET is_member = 0 WHERE channel_id = ?');
    stmt.run(channelId);
  }

  // Wiki entry tracking
  recordWikiEntry(path: string, title: string, category: string, sourceChannel?: string, sourceMessage?: string): void {
    const now = Date.now();
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO wiki_entries (path, title, category, source_channel, source_message, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM wiki_entries WHERE path = ?), ?), ?)`
    );
    stmt.run(path, title, category, sourceChannel, sourceMessage, path, now, now);
  }

  // Conversation tracking
  updateConversation(channelId: string, threadTs: string | null, userId: string): void {
    const now = Date.now();
    const stmt = this.db.prepare(
      `INSERT INTO conversations (channel_id, thread_ts, user_id, started_at, last_message_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(channel_id, thread_ts) DO UPDATE SET last_message_at = ?`
    );
    stmt.run(channelId, threadTs ?? '', userId, now, now, now);
  }

  // Cleanup old processed messages
  cleanOldMessages(daysToKeep: number = 30): void {
    const cutoff = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
    const stmt = this.db.prepare('DELETE FROM processed_messages WHERE processed_at < ?');
    const result = stmt.run(cutoff);
    logger.info('Cleaned old processed messages', { deleted: result.changes });
  }

  close(): void {
    this.db.close();
    logger.info('Database closed');
  }
}
