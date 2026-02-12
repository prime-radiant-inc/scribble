import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Prevent dotenv from loading a .env file during tests
vi.mock('dotenv', () => ({ config: vi.fn() }));

import { loadConfig } from '../config.js';

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Suppress console.log from loadConfig
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  // Minimum required env vars for loadConfig to succeed in API key mode
  const baseEnv = {
    SLACK_BOT_TOKEN: 'xoxb-test',
    SLACK_APP_TOKEN: 'xapp-test',
    ANTHROPIC_API_KEY: 'sk-ant-test',
  };

  describe('Anthropic API mode (default)', () => {
    it('should require ANTHROPIC_API_KEY when CLAUDE_CODE_USE_BEDROCK is not set', () => {
      process.env = {
        ...process.env,
        SLACK_BOT_TOKEN: 'xoxb-test',
        SLACK_APP_TOKEN: 'xapp-test',
      };
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.CLAUDE_CODE_USE_BEDROCK;

      expect(() => loadConfig()).toThrow('Missing required environment variable: ANTHROPIC_API_KEY');
    });

    it('should load all fields with defaults when required vars are set', () => {
      process.env = { ...process.env, ...baseEnv };
      delete process.env.CLAUDE_CODE_USE_BEDROCK;
      delete process.env.LOG_LEVEL;
      delete process.env.DATA_DIRECTORY;
      delete process.env.OTEL_ENABLED;
      delete process.env.PROMETHEUS_PORT;

      const config = loadConfig();
      expect(config.slack.botToken).toBe('xoxb-test');
      expect(config.slack.appToken).toBe('xapp-test');
      expect(config.anthropic.apiKey).toBe('sk-ant-test');
      expect(config.wiki.repo).toBe('prime-radiant-inc/scribble-wiki');
      expect(config.wiki.localPath).toBe('./data/wiki');
      expect(config.github.token).toBeUndefined();
      expect(config.linear.apiKey).toBeUndefined();
      expect(config.dataDirectory).toBe('./data');
      expect(config.logLevel).toBe('info');
      expect(config.telemetry.enabled).toBe(false);
      expect(config.telemetry.prometheusPort).toBe(9464);
    });

    it('should throw when SLACK_BOT_TOKEN is missing', () => {
      process.env = { ...process.env, ...baseEnv };
      delete process.env.SLACK_BOT_TOKEN;
      expect(() => loadConfig()).toThrow('Missing required environment variable: SLACK_BOT_TOKEN');
    });

    it('should throw when SLACK_APP_TOKEN is missing', () => {
      process.env = { ...process.env, ...baseEnv };
      delete process.env.SLACK_APP_TOKEN;
      expect(() => loadConfig()).toThrow('Missing required environment variable: SLACK_APP_TOKEN');
    });
  });

  describe('Bedrock mode', () => {
    it('should not require ANTHROPIC_API_KEY when CLAUDE_CODE_USE_BEDROCK=1', () => {
      process.env = {
        ...process.env,
        SLACK_BOT_TOKEN: 'xoxb-test',
        SLACK_APP_TOKEN: 'xapp-test',
        CLAUDE_CODE_USE_BEDROCK: '1',
      };
      delete process.env.ANTHROPIC_API_KEY;

      const config = loadConfig();
      expect(config.slack.botToken).toBe('xoxb-test');
      expect(config.anthropic.apiKey).toBeUndefined();
      expect(config.dataDirectory).toBe('./data');
    });

    it('should still load ANTHROPIC_API_KEY when present in Bedrock mode', () => {
      process.env = {
        ...process.env,
        ...baseEnv,
        CLAUDE_CODE_USE_BEDROCK: '1',
      };

      const config = loadConfig();
      expect(config.anthropic.apiKey).toBe('sk-ant-test');
    });

    it('should only activate Bedrock mode for exact value "1"', () => {
      // "0", "true", "false" are all truthy strings in JS — only "1" should activate
      for (const value of ['0', 'true', 'false', 'yes']) {
        process.env = {
          ...process.env,
          SLACK_BOT_TOKEN: 'xoxb-test',
          SLACK_APP_TOKEN: 'xapp-test',
          CLAUDE_CODE_USE_BEDROCK: value,
        };
        delete process.env.ANTHROPIC_API_KEY;

        expect(() => loadConfig()).toThrow('Missing required environment variable: ANTHROPIC_API_KEY');
      }
    });

    it('should require ANTHROPIC_API_KEY when CLAUDE_CODE_USE_BEDROCK is empty string', () => {
      process.env = {
        ...process.env,
        SLACK_BOT_TOKEN: 'xoxb-test',
        SLACK_APP_TOKEN: 'xapp-test',
        CLAUDE_CODE_USE_BEDROCK: '',
      };
      delete process.env.ANTHROPIC_API_KEY;

      expect(() => loadConfig()).toThrow('Missing required environment variable: ANTHROPIC_API_KEY');
    });
  });
});
