/**
 * Per-thread locking to ensure messages in the same thread are processed serially.
 * This prevents race conditions where a follow-up message is processed before
 * the previous response is logged.
 */

import { Logger } from '../utils/logger.js';

const logger = new Logger('ThreadLock');

interface QueuedMessage {
  resolve: () => void;
}

export class ThreadLockManager {
  private locks: Map<string, Promise<void>> = new Map();
  private queues: Map<string, QueuedMessage[]> = new Map();

  /**
   * Acquire a lock for a thread. Returns when the lock is acquired.
   * The caller must call release() when done processing.
   */
  async acquire(channelId: string, threadId: string): Promise<() => void> {
    const key = `${channelId}:${threadId}`;

    // Wait for existing lock to be released
    const existingLock = this.locks.get(key);
    if (existingLock) {
      logger.debug('Waiting for thread lock', { key });
      await existingLock;
    }

    // Create new lock
    let releaseFn: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      releaseFn = () => {
        logger.debug('Thread lock released', { key });
        this.locks.delete(key);
        resolve();
      };
    });

    this.locks.set(key, lockPromise);
    logger.debug('Thread lock acquired', { key });

    return releaseFn!;
  }

  /**
   * Check if a thread is currently locked
   */
  isLocked(channelId: string, threadId: string): boolean {
    return this.locks.has(`${channelId}:${threadId}`);
  }
}

// Singleton instance
export const threadLockManager = new ThreadLockManager();
