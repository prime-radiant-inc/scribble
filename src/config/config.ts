import * as dotenv from 'dotenv';
import * as path from 'path';

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
  linear: {
    apiKey: string | undefined;
  };
  github: {
    token: string | undefined;
  };
  database: {
    path: string;
  };
  dataDirectory: string;
  logLevel: string;
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
  const databasePath = process.env.DATABASE_PATH || path.join(dataDirectory, 'scribble.db');

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
      localPath: path.join(dataDirectory, 'wiki'),
    },
    linear: {
      apiKey: process.env.LINEAR_API_KEY,
    },
    github: {
      token: process.env.GITHUB_TOKEN,
    },
    database: {
      path: databasePath,
    },
    dataDirectory,
    logLevel: process.env.LOG_LEVEL || 'info',
  };
}
