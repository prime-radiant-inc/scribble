import * as dotenv from 'dotenv';
import { parseTenantConfig, type TenantConfig } from './tenantConfig.js';
import { requireWikiRepo } from './wikiRepo.js';

dotenv.config();

export interface Config {
  slack: {
    botToken: string;
    appToken: string;
  };
  anthropic: {
    apiKey: string | undefined;
  };
  wiki: {
    repo: string; // e.g., "prime-radiant-inc/scribble-wiki"
    localPath: string;
  };
  github: {
    token: string | undefined;
  };
  dataDirectory: string;
  logLevel: string;
  tenant: TenantConfig;
  timezone: string;
  telemetry: {
    enabled: boolean;
    prometheusPort: number;
  };
}

function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getDefaultedEnv(key: string, fallback: string): string {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  const value = raw.trim();
  if (!value) {
    throw new Error(`${key} cannot be empty`);
  }
  return value;
}

export function loadConfig(): Config {
  const dataDirectory = process.env.DATA_DIRECTORY || './data';
  const tenant = parseTenantConfig();
  const timezone = getDefaultedEnv('TZ', 'America/Los_Angeles');

  return {
    slack: {
      botToken: getRequiredEnv('SLACK_BOT_TOKEN'),
      appToken: getRequiredEnv('SLACK_APP_TOKEN'),
    },
    anthropic: {
      apiKey: process.env.CLAUDE_CODE_USE_BEDROCK === '1'
        ? process.env.ANTHROPIC_API_KEY
        : getRequiredEnv('ANTHROPIC_API_KEY'),
    },
    wiki: {
      repo: requireWikiRepo(),
      localPath: `${dataDirectory}/wiki`,
    },
    github: {
      token: process.env.GITHUB_TOKEN,
    },
    dataDirectory,
    logLevel: process.env.LOG_LEVEL || 'info',
    tenant,
    timezone,
    telemetry: {
      enabled: process.env.OTEL_ENABLED === 'true',
      prometheusPort: parseInt(process.env.PROMETHEUS_PORT || '9464'),
    },
  };
}
