import { StateStore } from '../state/stateStore.js';
import { ActiveThread } from '../state/types.js';
import {
  EngagementCheck,
  EngagementResult,
  DISMISSAL_PATTERNS,
  NAME_PATTERNS,
} from './types.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('AttentionTracker');

export class AttentionTracker {
  private stateStore: StateStore;
  private botUserId: string;

  constructor(stateStore: StateStore, botUserId: string) {
    this.stateStore = stateStore;
    this.botUserId = botUserId;
  }

  shouldEngage(check: EngagementCheck): EngagementResult {
    // Check for @mention
    if (check.text.includes(`<@${this.botUserId}>`)) {
      return { shouldEngage: true, reason: 'mention' };
    }

    // Check for name usage
    for (const pattern of NAME_PATTERNS) {
      if (pattern.test(check.text)) {
        return { shouldEngage: true, reason: 'name' };
      }
    }

    // Check if already in active thread
    const threadId = check.threadTs || check.channelId;
    if (this.stateStore.isThreadActive(check.channelId, threadId)) {
      return { shouldEngage: true, reason: 'active_thread' };
    }

    return { shouldEngage: false };
  }

  engage(
    channelId: string,
    threadId: string,
    channelName: string,
    topicSummary: string,
    participants: string[] = []
  ): void {
    const thread: ActiveThread = {
      threadId,
      channelId,
      channelName,
      engagedAt: Date.now(),
      lastActivity: Date.now(),
      topicSummary,
      participants,
    };
    this.stateStore.setActiveThread(thread);
    logger.info('Engaged in thread', { channelId, threadId, topicSummary });
  }

  disengage(channelId: string, threadId: string): void {
    this.stateStore.removeActiveThread(channelId, threadId);
    logger.info('Disengaged from thread', { channelId, threadId });
  }

  isEngaged(channelId: string, threadId: string): boolean {
    return this.stateStore.isThreadActive(channelId, threadId);
  }

  checkDisengagement(channelId: string, threadId: string, text: string): boolean {
    for (const pattern of DISMISSAL_PATTERNS) {
      if (pattern.test(text)) {
        this.disengage(channelId, threadId);
        return true;
      }
    }
    return false;
  }

  updateActivity(channelId: string, threadId: string): void {
    this.stateStore.updateThreadActivity(channelId, threadId);
  }

  getActiveThread(channelId: string, threadId: string): ActiveThread | null {
    return this.stateStore.getActiveThread(channelId, threadId);
  }

  getAllActiveThreads(): ActiveThread[] {
    return this.stateStore.getAllActiveThreads();
  }

  cleanupStaleThreads(maxInactiveMs: number = 4 * 60 * 60 * 1000): void {
    const now = Date.now();
    const threads = this.stateStore.getAllActiveThreads();
    let cleaned = 0;

    for (const thread of threads) {
      if (now - thread.lastActivity > maxInactiveMs) {
        this.stateStore.removeActiveThread(thread.channelId, thread.threadId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info('Cleaned up stale threads', { cleaned });
    }
  }
}
