import { WebClient } from '@slack/web-api';
import { Logger } from '../utils/logger.js';

const logger = new Logger('SlackResponder');

export class SlackResponder {
  private client: WebClient;
  private channelId: string;
  private threadTs: string;
  private inputMessageTs: string;
  private currentResponseTs: string | null = null;
  private lastUpdateTime = 0;
  private lastText: string | null = null;
  private readonly UPDATE_THROTTLE_MS = 1500;

  constructor(
    client: WebClient,
    channelId: string,
    threadTs: string,
    inputMessageTs: string
  ) {
    this.client = client;
    this.channelId = channelId;
    this.threadTs = threadTs;
    this.inputMessageTs = inputMessageTs;
  }

  /**
   * Mark the message as being processed with eyes emoji
   */
  async markProcessing(): Promise<void> {
    try {
      await this.client.reactions.add({
        channel: this.channelId,
        timestamp: this.inputMessageTs,
        name: 'eyes',
      });
    } catch {
      // Best effort
    }
  }

  /**
   * Clear the processing indicator
   */
  async clearProcessing(): Promise<void> {
    try {
      await this.client.reactions.remove({
        channel: this.channelId,
        timestamp: this.inputMessageTs,
        name: 'eyes',
      });
    } catch {
      // Best effort
    }
  }

  /**
   * Mark the message as errored with X emoji
   */
  async markError(): Promise<void> {
    try {
      await this.client.reactions.add({
        channel: this.channelId,
        timestamp: this.inputMessageTs,
        name: 'x',
      });
    } catch {
      // Best effort
    }
  }

  /**
   * Update or create the response message (throttled)
   */
  async updateResponse(text: string): Promise<void> {
    this.lastText = text;

    const now = Date.now();
    if (now - this.lastUpdateTime < this.UPDATE_THROTTLE_MS && this.currentResponseTs) {
      return;
    }
    this.lastUpdateTime = now;

    if (this.currentResponseTs) {
      await this.client.chat.update({
        channel: this.channelId,
        ts: this.currentResponseTs,
        text,
      });
    } else {
      const result = await this.client.chat.postMessage({
        channel: this.channelId,
        thread_ts: this.threadTs,
        text,
      });
      this.currentResponseTs = result.ts as string;
    }
  }

  /**
   * Finalize the response (force update with final text)
   */
  async finalizeResponse(): Promise<void> {
    if (this.lastText && this.currentResponseTs) {
      await this.client.chat.update({
        channel: this.channelId,
        ts: this.currentResponseTs,
        text: this.lastText,
      });
    }
  }

  /**
   * Send a notice message (system message)
   */
  async sendNotice(text: string): Promise<void> {
    await this.client.chat.postMessage({
      channel: this.channelId,
      thread_ts: this.threadTs,
      text: `_${text}_`,
    });
  }

  /**
   * Send a file
   */
  async sendFile(localPath: string, filename?: string): Promise<void> {
    await this.client.files.uploadV2({
      channel_id: this.channelId,
      thread_ts: this.threadTs,
      file: localPath,
      filename,
    });
  }

  /**
   * React to a message
   */
  async react(emoji: string): Promise<void> {
    try {
      await this.client.reactions.add({
        channel: this.channelId,
        timestamp: this.inputMessageTs,
        name: emoji,
      });
    } catch {
      // Best effort
    }
  }

  /**
   * Reply in thread
   */
  async reply(text: string): Promise<string> {
    const result = await this.client.chat.postMessage({
      channel: this.channelId,
      thread_ts: this.threadTs,
      text,
    });
    return result.ts as string;
  }
}
