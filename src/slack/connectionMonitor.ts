import type { EventEmitter } from 'eventemitter3';
import { Logger } from 'bot-toolkit';

const logger = new Logger('ConnectionMonitor');

const DEFAULT_GRACE_PERIOD_MS = 5 * 60 * 1000; // 5 minutes

export interface ConnectionMonitorConfig {
  /** The SocketModeClient (EventEmitter) to monitor */
  socketModeClient: EventEmitter;
  /** Called when the connection has been down longer than the grace period */
  onUnrecoverable: () => void;
  /** How long to wait after disconnect before declaring unrecoverable (ms) */
  disconnectGracePeriodMs?: number;
}

/**
 * Monitors a Slack Socket Mode connection and calls onUnrecoverable
 * if the connection stays down longer than the grace period.
 *
 * Bolt's built-in auto-reconnect handles transient failures, but can
 * silently give up. This monitor is the safety net — if Bolt can't
 * reconnect within the grace period, we exit so ECS restarts the task.
 */
export class ConnectionMonitor {
  private connected = false;
  private hasEverConnected = false;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly gracePeriodMs: number;
  private readonly onUnrecoverable: () => void;
  private readonly emitter: EventEmitter;

  // Bound handlers for cleanup
  private readonly handleConnected: () => void;
  private readonly handleDisconnected: () => void;
  private readonly handleError: (err: Error) => void;

  get isConnected(): boolean {
    return this.connected;
  }

  constructor(config: ConnectionMonitorConfig) {
    this.emitter = config.socketModeClient;
    this.onUnrecoverable = config.onUnrecoverable;
    this.gracePeriodMs = config.disconnectGracePeriodMs ?? DEFAULT_GRACE_PERIOD_MS;

    this.handleConnected = () => this.onConnected();
    this.handleDisconnected = () => this.onDisconnected();
    this.handleError = (err: Error) => this.onError(err);

    this.emitter.on('connected', this.handleConnected);
    this.emitter.on('disconnected', this.handleDisconnected);
    this.emitter.on('reconnecting', this.handleDisconnected);
    this.emitter.on('close', this.handleDisconnected);
    this.emitter.on('error', this.handleError);
  }

  private onConnected(): void {
    this.connected = true;
    this.hasEverConnected = true;
    this.clearGraceTimer();
    logger.info('Socket Mode connected');
  }

  private onDisconnected(): void {
    this.connected = false;

    if (!this.hasEverConnected) {
      // Don't start the grace timer if we've never connected —
      // initial connection failures are handled by Bolt's startup.
      return;
    }

    logger.warn('Socket Mode disconnected, starting grace period', {
      gracePeriodMs: this.gracePeriodMs,
    });

    this.startGraceTimer();
  }

  private onError(err: Error): void {
    logger.error('Socket Mode error', { error: String(err) });
  }

  private startGraceTimer(): void {
    this.clearGraceTimer();
    this.graceTimer = setTimeout(() => {
      logger.error('Socket Mode connection unrecoverable — disconnected for longer than grace period', {
        gracePeriodMs: this.gracePeriodMs,
      });
      this.onUnrecoverable();
    }, this.gracePeriodMs);
  }

  private clearGraceTimer(): void {
    if (this.graceTimer !== null) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
  }

  destroy(): void {
    this.clearGraceTimer();
    this.emitter.off('connected', this.handleConnected);
    this.emitter.off('disconnected', this.handleDisconnected);
    this.emitter.off('reconnecting', this.handleDisconnected);
    this.emitter.off('close', this.handleDisconnected);
    this.emitter.off('error', this.handleError);
  }
}
