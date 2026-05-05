import * as fs from 'node:fs';
import * as path from 'node:path';
import { Logger } from '../utils/logger.js';

const logger = new Logger('InstanceConfig');

/**
 * Create the instance.json config file for bot-toolkit's ConfigStore.
 * This bridges Scribble's config to bot-toolkit's expected format.
 */
export function createInstanceConfig(dataDir: string, mcpPath: string): string {
  const configDir = path.join(dataDir, 'config');

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  const instanceConfig = {
    mcps: {
      'scribble-mcp': {
        enabled: true,
        command: 'node',
        args: [mcpPath],
        env: {
          DATA_DIRECTORY: dataDir,
        },
        envFrom: ['GITHUB_TOKEN', 'WIKI_REPO'],
      },
      linear: {
        enabled: Boolean(process.env.LINEAR_API_KEY),
        command: 'node',
        args: [path.resolve(process.cwd(), 'lib/streamlinear-mcp.js')],
        env: {
          LINEAR_API_TOKEN: process.env.LINEAR_API_KEY || '',
        },
      },
    },
    plugins: {},
    knowledge: [path.join(dataDir, 'wiki')],
  };

  const instancePath = path.join(configDir, 'instance.json');
  fs.writeFileSync(instancePath, JSON.stringify(instanceConfig, null, 2));
  logger.info('Created instance.json', { path: instancePath });

  const secrets: Record<string, string> = {};
  if (process.env.GITHUB_TOKEN) {
    secrets.GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  }
  if (process.env.WIKI_REPO) {
    secrets.WIKI_REPO = process.env.WIKI_REPO;
  }

  const secretsPath = path.join(configDir, 'secrets.json');
  fs.writeFileSync(secretsPath, JSON.stringify(secrets, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(secretsPath, 0o600);
  } catch {
    logger.warn('Could not set owner-only permissions on secrets.json', { path: secretsPath });
  }
  logger.debug('Created secrets.json', {
    path: secretsPath,
    keys: Object.keys(secrets),
  });

  return configDir;
}
