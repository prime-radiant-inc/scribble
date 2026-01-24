import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChannelManager } from '../channelManager.js';
import { WebClient } from '@slack/web-api';
import { StateStore } from '../../state/stateStore.js';

// Mock the WebClient
const mockConversationsLeave = vi.fn();
const mockConversationsJoin = vi.fn();
const mockConversationsList = vi.fn();
const mockConversationsInfo = vi.fn();
const mockUsersInfo = vi.fn();
const mockAuthTest = vi.fn();

const mockClient = {
  conversations: {
    leave: mockConversationsLeave,
    join: mockConversationsJoin,
    list: mockConversationsList,
    info: mockConversationsInfo,
  },
  users: {
    info: mockUsersInfo,
  },
  auth: {
    test: mockAuthTest,
  },
} as unknown as WebClient;

// Mock the StateStore
const mockStateStore = {
  markChannelJoined: vi.fn(),
  markChannelLeft: vi.fn(),
} as unknown as StateStore;

describe('ChannelManager', () => {
  let channelManager: ChannelManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthTest.mockResolvedValue({ user_id: 'U_BOT123' });
    channelManager = new ChannelManager(mockClient, mockStateStore);
  });

  describe('leaveChannel', () => {
    it('should call conversations.leave with the channel ID', async () => {
      mockConversationsLeave.mockResolvedValue({ ok: true });

      const result = await channelManager.leaveChannel('C123');

      expect(mockConversationsLeave).toHaveBeenCalledWith({ channel: 'C123' });
      expect(result).toBe(true);
    });

    it('should update state store when leaving successfully', async () => {
      mockConversationsLeave.mockResolvedValue({ ok: true });

      await channelManager.leaveChannel('C123');

      expect(mockStateStore.markChannelLeft).toHaveBeenCalledWith('C123');
    });

    it('should return false when leave fails', async () => {
      mockConversationsLeave.mockRejectedValue(new Error('not_in_channel'));

      const result = await channelManager.leaveChannel('C123');

      expect(result).toBe(false);
    });

    it('should not update state store when leave fails', async () => {
      mockConversationsLeave.mockRejectedValue(new Error('not_in_channel'));

      await channelManager.leaveChannel('C123');

      expect(mockStateStore.markChannelLeft).not.toHaveBeenCalled();
    });
  });

  describe('handleChannelLeft', () => {
    it('should update state store when bot is removed from channel', async () => {
      await channelManager.handleChannelLeft('C456');

      expect(mockStateStore.markChannelLeft).toHaveBeenCalledWith('C456');
    });
  });
});
