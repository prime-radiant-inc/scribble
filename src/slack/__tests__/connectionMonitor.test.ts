import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'eventemitter3';
import { ConnectionMonitor } from '../connectionMonitor.js';

describe('ConnectionMonitor', () => {
  let emitter: EventEmitter;
  let onUnrecoverable: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    emitter = new EventEmitter();
    onUnrecoverable = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createMonitor(opts: { disconnectGracePeriodMs?: number } = {}) {
    return new ConnectionMonitor({
      socketModeClient: emitter,
      onUnrecoverable,
      disconnectGracePeriodMs: opts.disconnectGracePeriodMs ?? 5 * 60 * 1000,
    });
  }

  describe('lifecycle', () => {
    it('starts in disconnected state', () => {
      const monitor = createMonitor();
      expect(monitor.isConnected).toBe(false);
    });

    it('tracks connected state on "connected" event', () => {
      const monitor = createMonitor();
      emitter.emit('connected');
      expect(monitor.isConnected).toBe(true);
    });

    it('tracks disconnected state on "disconnected" event', () => {
      const monitor = createMonitor();
      emitter.emit('connected');
      emitter.emit('disconnected');
      expect(monitor.isConnected).toBe(false);
    });

    it('tracks disconnected state on "close" event', () => {
      const monitor = createMonitor();
      emitter.emit('connected');
      emitter.emit('close');
      expect(monitor.isConnected).toBe(false);
    });

    it('tracks reconnecting as disconnected', () => {
      const monitor = createMonitor();
      emitter.emit('connected');
      emitter.emit('reconnecting');
      expect(monitor.isConnected).toBe(false);
    });
  });

  describe('grace period', () => {
    it('does not call onUnrecoverable during grace period', () => {
      const monitor = createMonitor({ disconnectGracePeriodMs: 60_000 });
      emitter.emit('connected');
      emitter.emit('disconnected');

      vi.advanceTimersByTime(59_999);
      expect(onUnrecoverable).not.toHaveBeenCalled();
    });

    it('calls onUnrecoverable after grace period expires', () => {
      const monitor = createMonitor({ disconnectGracePeriodMs: 60_000 });
      emitter.emit('connected');
      emitter.emit('disconnected');

      vi.advanceTimersByTime(60_000);
      expect(onUnrecoverable).toHaveBeenCalledOnce();
    });

    it('cancels timer if reconnected within grace period', () => {
      const monitor = createMonitor({ disconnectGracePeriodMs: 60_000 });
      emitter.emit('connected');
      emitter.emit('disconnected');

      vi.advanceTimersByTime(30_000);
      emitter.emit('connected');

      vi.advanceTimersByTime(60_000);
      expect(onUnrecoverable).not.toHaveBeenCalled();
    });

    it('resets timer on repeated disconnects', () => {
      const monitor = createMonitor({ disconnectGracePeriodMs: 60_000 });
      emitter.emit('connected');
      emitter.emit('disconnected');

      vi.advanceTimersByTime(30_000);
      // Another disconnect event (e.g. reconnect attempt failed)
      emitter.emit('disconnected');

      // 30s from first disconnect, but timer was reset — should not fire yet
      vi.advanceTimersByTime(30_000);
      expect(onUnrecoverable).not.toHaveBeenCalled();

      // Now 60s from the *second* disconnect
      vi.advanceTimersByTime(30_000);
      expect(onUnrecoverable).toHaveBeenCalledOnce();
    });

    it('does not start grace period timer if never connected', () => {
      const monitor = createMonitor({ disconnectGracePeriodMs: 60_000 });
      // disconnected event without ever connecting — initial state, don't trigger
      emitter.emit('disconnected');

      vi.advanceTimersByTime(120_000);
      expect(onUnrecoverable).not.toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    it('removes listeners and clears timers on destroy', () => {
      const monitor = createMonitor({ disconnectGracePeriodMs: 60_000 });
      emitter.emit('connected');
      emitter.emit('disconnected');

      monitor.destroy();

      // Timer should be cleared
      vi.advanceTimersByTime(120_000);
      expect(onUnrecoverable).not.toHaveBeenCalled();

      // Events should be unsubscribed
      expect(emitter.listenerCount('connected')).toBe(0);
      expect(emitter.listenerCount('disconnected')).toBe(0);
    });
  });

  describe('error events', () => {
    it('does not crash on error events', () => {
      const monitor = createMonitor();
      emitter.emit('connected');
      expect(() => emitter.emit('error', new Error('test'))).not.toThrow();
    });
  });
});
