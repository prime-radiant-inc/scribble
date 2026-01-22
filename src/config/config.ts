import * as dotenv from 'dotenv';

dotenv.config();

export interface Config {
  slack: {
    botToken: string;
    appToken: string;
  };
  anthropic: {
    apiKey: string;
  };
  wiki: {
    repo: string; // e.g., "prime-radiant-inc/scribble-wiki"
    localPath: string;
  };
  github: {
    token: string | undefined;
  };
  linear: {
    apiKey: string | undefined;
  };
  dataDirectory: string;
  logLevel: string;
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

export function loadConfig(): Config {
  const dataDirectory = process.env.DATA_DIRECTORY || './data';
  const linearApiKey = process.env.LINEAR_API_KEY;

  // Log Linear API key status at startup (don't log the actual key)
  console.log(`[Config] LINEAR_API_KEY: ${linearApiKey ? 'set (' + linearApiKey.length + ' chars)' : 'NOT SET'}`);

  return {
    slack: {
      botToken: getRequiredEnv('SLACK_BOT_TOKEN'),
      appToken: getRequiredEnv('SLACK_APP_TOKEN'),
    },
    anthropic: {
      apiKey: getRequiredEnv('ANTHROPIC_API_KEY'),
    },
    wiki: {
      repo: process.env.WIKI_REPO || 'prime-radiant-inc/scribble-wiki',
      localPath: `${dataDirectory}/wiki`,
    },
    github: {
      token: process.env.GITHUB_TOKEN,
    },
    linear: {
      apiKey: linearApiKey,
    },
    dataDirectory,
    logLevel: process.env.LOG_LEVEL || 'info',
    telemetry: {
      enabled: process.env.OTEL_ENABLED === 'true',
      prometheusPort: parseInt(process.env.PROMETHEUS_PORT || '9464'),
    },
  };
}
