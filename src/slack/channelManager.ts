import { WebClient } from '@slack/web-api';
import { Logger } from '../utils/logger.js';
import { StateStore } from '../state/stateStore.js';

const logger = new Logger('ChannelManager');

export class ChannelManager {
  private client: WebClient;
  private stateStore: StateStore;
  private botUserId: string | null = null;

  constructor(client: WebClient, stateStore: StateStore) {
    this.client = client;
    this.stateStore = stateStore;
  }

  /**
   * Initialize the channel manager - get bot user ID
   */
  async initialize(): Promise<void> {
    const auth = await this.client.auth.test();
    this.botUserId = auth.user_id as string;
    logger.info('Channel manager initialized', { botUserId: this.botUserId });
  }

  /**
   * Auto-join all public channels the bot isn't already in
   */
  async autoJoinAllChannels(): Promise<void> {
    logger.info('Starting auto-join for all public channels');

    let cursor: string | undefined;
    let joinedCount = 0;
    let alreadyMemberCount = 0;

    do {
      const result = await this.client.conversations.list({
        types: 'public_channel',
        exclude_archived: true,
        limit: 200,
        cursor,
      });

      if (result.channels) {
        for (const channel of result.channels) {
          if (!channel.id || !channel.name) continue;

          // Skip if we're already a member
          if (channel.is_member) {
            this.stateStore.markChannelJoined(channel.id, channel.name);
            alreadyMemberCount++;
            continue;
          }

          try {
            await this.client.conversations.join({ channel: channel.id });
            this.stateStore.markChannelJoined(channel.id, channel.name);
            joinedCount++;
            logger.info('Joined channel', { channel: channel.name });
          } catch (error: any) {
            // Some channels may not be joinable
            if (error.data?.error === 'method_not_supported_for_channel_type') {
              logger.debug('Cannot join channel', { channel: channel.name, reason: 'not supported' });
            } else {
              logger.warn('Failed to join channel', { channel: channel.name, error: error.message });
            }
          }
        }
      }

      cursor = result.response_metadata?.next_cursor;
    } while (cursor);

    logger.info('Auto-join complete', { joined: joinedCount, alreadyMember: alreadyMemberCount });
  }

  /**
   * Check if a user is from Slack Connect (external)
   */
  async isSlackConnectUser(userId: string): Promise<boolean> {
    try {
      const result = await this.client.users.info({ user: userId });
      const user = result.user as any;

      // External users have is_stranger = true or team_id different from workspace
      if (user.is_stranger) return true;
      if (user.is_restricted || user.is_ultra_restricted) return true;

      // Check for external team indicators
      if (user.team_id && user.enterprise_user) {
        // This might be an external user via Slack Connect
        return true;
      }

      return false;
    } catch (error) {
      logger.warn('Failed to check user status', { userId, error });
      return false; // Assume internal if we can't check
    }
  }

  /**
   * Get channel info
   */
  async getChannelInfo(channelId: string): Promise<{ name: string; isPrivate: boolean } | null> {
    try {
      const result = await this.client.conversations.info({ channel: channelId });
      const channel = result.channel as any;
      return {
        name: channel.name || channelId,
        isPrivate: channel.is_private || false,
      };
    } catch (error) {
      logger.warn('Failed to get channel info', { channelId, error });
      return null;
    }
  }

  /**
   * Get user info
   */
  async getUserInfo(userId: string): Promise<{ name: string; realName: string } | null> {
    try {
      const result = await this.client.users.info({ user: userId });
      const user = result.user as any;
      return {
        name: user.name || userId,
        realName: user.real_name || user.profile?.display_name || user.name || userId,
      };
    } catch (error) {
      logger.warn('Failed to get user info', { userId, error });
      return null;
    }
  }

  /**
   * Handle channel_joined event (when invited to private channels)
   */
  async handleChannelJoined(channelId: string, channelName: string): Promise<void> {
    this.stateStore.markChannelJoined(channelId, channelName);
    logger.info('Bot added to channel', { channelId, channelName });
  }

  /**
   * Handle channel_left event
   */
  async handleChannelLeft(channelId: string): Promise<void> {
    this.stateStore.markChannelLeft(channelId);
    logger.info('Bot removed from channel', { channelId });
  }

  /**
   * Leave a channel
   */
  async leaveChannel(channelId: string): Promise<boolean> {
    try {
      await this.client.conversations.leave({ channel: channelId });
      this.stateStore.markChannelLeft(channelId);
      logger.info('Left channel', { channelId });
      return true;
    } catch (error: any) {
      logger.error('Failed to leave channel', { channelId, error: error.message });
      return false;
    }
  }

  get userId(): string | null {
    return this.botUserId;
  }
}
