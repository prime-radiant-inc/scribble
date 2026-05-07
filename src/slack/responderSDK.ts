// src/slack/responderSDK.ts
// SlackResponder using bot-toolkit's BaseResponder

import type { SessionStats } from '@primeradianthq/bot-toolkit';
import { BaseResponder } from '@primeradianthq/bot-toolkit';
import type { WebClient } from '@slack/web-api';

export class SlackResponderSDK extends BaseResponder {
  constructor(
    private client: WebClient,
    private channelId: string,
    private threadTs: string,
    private inputMessageTs: string,
  ) {
    super();
  }

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
   * Add a reaction to the input message.
   * Used to indicate actions taken without a verbal response.
   */
  async addReaction(name: string): Promise<void> {
    try {
      await this.client.reactions.add({
        channel: this.channelId,
        timestamp: this.inputMessageTs,
        name,
      });
    } catch {
      // Best effort - reaction may already exist
    }
  }

  protected async sendNewMessage(text: string): Promise<string> {
    const result = await this.client.chat.postMessage({
      channel: this.channelId,
      thread_ts: this.threadTs,
      text,
    });
    return result.ts as string;
  }

  protected async editMessage(text: string): Promise<void> {
    if (!this.currentResponseId) return;

    await this.client.chat.update({
      channel: this.channelId,
      ts: this.currentResponseId,
      text,
    });
  }

  async sendNotice(text: string): Promise<void> {
    await this.client.chat.postMessage({
      channel: this.channelId,
      thread_ts: this.threadTs,
      text,
    });
  }

  async sendFile(localPath: string, filename?: string): Promise<void> {
    await this.client.files.uploadV2({
      channel_id: this.channelId,
      thread_ts: this.threadTs,
      file: localPath,
      filename: filename,
    });
  }

  async setTyping(_typing: boolean): Promise<void> {
    // Slack doesn't have a typing indicator API for bots
  }

  async updateChannelStats(stats: SessionStats): Promise<void> {
    const topic = this.formatStatsTopic(stats);
    try {
      await this.client.conversations.setTopic({
        channel: this.channelId,
        topic,
      });
    } catch {
      // May not have permission to set topic
    }
  }

  async createThreadStarter(topic: string): Promise<string> {
    const text = `*${topic}*\n\nStarting new conversation thread...`;
    const result = await this.client.chat.postMessage({
      channel: this.channelId,
      text,
    });
    return result.ts as string;
  }
}
