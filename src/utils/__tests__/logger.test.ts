import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Logger } from '../logger.js';

describe('Logger', () => {
  let consoleSpy: {
    log: ReturnType<typeof vi.spyOn>;
    warn: ReturnType<typeof vi.spyOn>;
    error: ReturnType<typeof vi.spyOn>;
    debug: ReturnType<typeof vi.spyOn>;
  };
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment
    process.env = { ...originalEnv };
    delete process.env.LOG_LEVEL;
    delete process.env.LOG_FORMAT;

    // Spy on console methods
    consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
      debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('log level filtering', () => {
    it('should respect LOG_LEVEL=silent', () => {
      process.env.LOG_LEVEL = 'silent';
      const logger = new Logger('test');

      logger.info('test');
      logger.warn('test');
      logger.error('test');
      logger.debug('test');

      expect(consoleSpy.log).not.toHaveBeenCalled();
      expect(consoleSpy.warn).not.toHaveBeenCalled();
      expect(consoleSpy.error).not.toHaveBeenCalled();
      expect(consoleSpy.debug).not.toHaveBeenCalled();
    });

    it('should respect LOG_LEVEL=error', () => {
      process.env.LOG_LEVEL = 'error';
      const logger = new Logger('test');

      logger.info('info msg');
      logger.warn('warn msg');
      logger.error('error msg');
      logger.debug('debug msg');

      expect(consoleSpy.log).not.toHaveBeenCalled();
      expect(consoleSpy.warn).not.toHaveBeenCalled();
      expect(consoleSpy.error).toHaveBeenCalledTimes(1);
      expect(consoleSpy.debug).not.toHaveBeenCalled();
    });

    it('should respect LOG_LEVEL=warn', () => {
      process.env.LOG_LEVEL = 'warn';
      const logger = new Logger('test');

      logger.info('info msg');
      logger.warn('warn msg');
      logger.error('error msg');
      logger.debug('debug msg');

      expect(consoleSpy.log).not.toHaveBeenCalled();
      expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
      expect(consoleSpy.error).toHaveBeenCalledTimes(1);
      expect(consoleSpy.debug).not.toHaveBeenCalled();
    });

    it('should respect LOG_LEVEL=info (default)', () => {
      process.env.LOG_LEVEL = 'info';
      const logger = new Logger('test');

      logger.info('info msg');
      logger.warn('warn msg');
      logger.error('error msg');
      logger.debug('debug msg');

      expect(consoleSpy.log).toHaveBeenCalledTimes(1);
      expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
      expect(consoleSpy.error).toHaveBeenCalledTimes(1);
      expect(consoleSpy.debug).not.toHaveBeenCalled();
    });

    it('should respect LOG_LEVEL=debug', () => {
      process.env.LOG_LEVEL = 'debug';
      const logger = new Logger('test');

      logger.info('info msg');
      logger.warn('warn msg');
      logger.error('error msg');
      logger.debug('debug msg');

      expect(consoleSpy.log).toHaveBeenCalledTimes(1);
      expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
      expect(consoleSpy.error).toHaveBeenCalledTimes(1);
      expect(consoleSpy.debug).toHaveBeenCalledTimes(1);
    });

    it('should default to info level for invalid LOG_LEVEL', () => {
      process.env.LOG_LEVEL = 'invalid';
      const logger = new Logger('test');

      logger.info('info msg');
      logger.debug('debug msg');

      expect(consoleSpy.log).toHaveBeenCalledTimes(1);
      expect(consoleSpy.debug).not.toHaveBeenCalled();
    });
  });

  describe('legacy format (default)', () => {
    it('should output human-readable format by default', () => {
      process.env.LOG_LEVEL = 'info';
      const logger = new Logger('TestLogger');

      logger.info('Hello world');

      expect(consoleSpy.log).toHaveBeenCalledTimes(1);
      const output = consoleSpy.log.mock.calls[0][0] as string;

      // Should contain timestamp, logger prefix, level, and message
      expect(output).toMatch(/^\[.+\] \[TestLogger\] INFO: Hello world$/);
    });

    it('should include data in legacy format', () => {
      process.env.LOG_LEVEL = 'info';
      const logger = new Logger('TestLogger');

      logger.info('User action', { userId: '123', action: 'login' });

      const output = consoleSpy.log.mock.calls[0][0] as string;
      expect(output).toContain('INFO: User action');
      expect(output).toContain('{"userId":"123","action":"login"}');
    });

    it('should include error stack in legacy format', () => {
      process.env.LOG_LEVEL = 'error';
      const logger = new Logger('TestLogger');
      const testError = new Error('Test error');

      logger.error('Something failed', testError);

      const output = consoleSpy.error.mock.calls[0][0] as string;
      expect(output).toContain('ERROR: Something failed');
      expect(output).toContain('Error: Test error');
    });
  });

  describe('structured JSON format', () => {
    it('should output JSON when LOG_FORMAT=json', () => {
      process.env.LOG_LEVEL = 'info';
      process.env.LOG_FORMAT = 'json';
      const logger = new Logger('TestLogger');

      logger.info('Hello world');

      const output = consoleSpy.log.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);

      expect(parsed).toMatchObject({
        level: 'info',
        logger: 'TestLogger',
        message: 'Hello world',
      });
      expect(parsed.timestamp).toBeDefined();
      expect(new Date(parsed.timestamp).getTime()).not.toBeNaN();
    });

    it('should include data in JSON format', () => {
      process.env.LOG_LEVEL = 'info';
      process.env.LOG_FORMAT = 'json';
      const logger = new Logger('TestLogger');

      logger.info('User action', { userId: '123', action: 'login' });

      const output = consoleSpy.log.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);

      expect(parsed.data).toEqual({ userId: '123', action: 'login' });
    });

    it('should serialize Error objects in JSON format', () => {
      process.env.LOG_LEVEL = 'error';
      process.env.LOG_FORMAT = 'json';
      const logger = new Logger('TestLogger');
      const testError = new Error('Test error message');

      logger.error('Operation failed', testError);

      const output = consoleSpy.error.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);

      expect(parsed.error).toBeDefined();
      expect(parsed.error.name).toBe('Error');
      expect(parsed.error.message).toBe('Test error message');
      expect(parsed.error.stack).toBeDefined();
    });

    it('should handle non-Error objects passed as errors', () => {
      process.env.LOG_LEVEL = 'error';
      process.env.LOG_FORMAT = 'json';
      const logger = new Logger('TestLogger');

      logger.error('Operation failed', 'string error');

      const output = consoleSpy.error.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);

      expect(parsed.error).toEqual({
        name: 'Unknown',
        message: 'string error',
      });
    });

    it('should output JSON for warn level', () => {
      process.env.LOG_LEVEL = 'warn';
      process.env.LOG_FORMAT = 'json';
      const logger = new Logger('TestLogger');

      logger.warn('Warning message', { code: 'W001' });

      const output = consoleSpy.warn.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);

      expect(parsed).toMatchObject({
        level: 'warn',
        logger: 'TestLogger',
        message: 'Warning message',
        data: { code: 'W001' },
      });
    });

    it('should output JSON for debug level', () => {
      process.env.LOG_LEVEL = 'debug';
      process.env.LOG_FORMAT = 'json';
      const logger = new Logger('TestLogger');

      logger.debug('Debug info', { detail: 'value' });

      const output = consoleSpy.debug.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);

      expect(parsed).toMatchObject({
        level: 'debug',
        logger: 'TestLogger',
        message: 'Debug info',
        data: { detail: 'value' },
      });
    });
  });

  describe('public API compatibility', () => {
    it('should have info method accepting message and optional data', () => {
      process.env.LOG_LEVEL = 'info';
      const logger = new Logger('test');

      // Both signatures should work
      logger.info('message only');
      logger.info('message with data', { key: 'value' });

      expect(consoleSpy.log).toHaveBeenCalledTimes(2);
    });

    it('should have warn method accepting message and optional data', () => {
      process.env.LOG_LEVEL = 'warn';
      const logger = new Logger('test');

      logger.warn('message only');
      logger.warn('message with data', { key: 'value' });

      expect(consoleSpy.warn).toHaveBeenCalledTimes(2);
    });

    it('should have error method accepting message and optional error', () => {
      process.env.LOG_LEVEL = 'error';
      const logger = new Logger('test');

      logger.error('message only');
      logger.error('message with error', new Error('test'));

      expect(consoleSpy.error).toHaveBeenCalledTimes(2);
    });

    it('should extract error from object with error property', () => {
      process.env.LOG_LEVEL = 'error';
      process.env.LOG_FORMAT = 'json';
      const logger = new Logger('test');
      const testError = new Error('nested error');

      // This is the pattern used throughout the codebase
      logger.error('Failed to save', { behavior: 'some-behavior', error: testError });

      const output = consoleSpy.error.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);

      expect(parsed.data).toEqual({ behavior: 'some-behavior' });
      expect(parsed.error.name).toBe('Error');
      expect(parsed.error.message).toBe('nested error');
    });

    it('should handle object with only error property', () => {
      process.env.LOG_LEVEL = 'error';
      process.env.LOG_FORMAT = 'json';
      const logger = new Logger('test');
      const testError = new Error('only error');

      logger.error('Failed', { error: testError });

      const output = consoleSpy.error.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);

      expect(parsed.data).toBeUndefined();
      expect(parsed.error.message).toBe('only error');
    });

    it('should have debug method accepting message and optional data', () => {
      process.env.LOG_LEVEL = 'debug';
      const logger = new Logger('test');

      logger.debug('message only');
      logger.debug('message with data', { key: 'value' });

      expect(consoleSpy.debug).toHaveBeenCalledTimes(2);
    });
  });
});
