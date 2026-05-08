import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOptionalEnv, tenantConfigToEnv, type TenantConfig } from './tenantConfig.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('InstanceConfig');
const CONFIG_FILE_MODE = 0o600;
const STREAMLINEAR_MCP_BIN_PATH = '/app/node_modules/.bin/streamlinear';

function getDefaultStreamlinearMcpPath(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(moduleDir, '../../node_modules/.bin/streamlinear');
}

function resolveStreamlinearMcpPath(): string {
  return parseOptionalEnv(process.env, 'STREAMLINEAR_MCP_PATH') ?? getDefaultStreamlinearMcpPath();
}

function validateStreamlinearMcpPath(filePath: string): void {
  if (fs.existsSync(filePath)) return;

  throw new Error(
    `LINEAR_API_KEY is set but the Linear MCP executable was not found at ${filePath}. ` +
      `Docker uses the packaged @primeradianthq/streamlinear entrypoint at ${STREAMLINEAR_MCP_BIN_PATH}. ` +
      'For local development or nonstandard installs, run npm install or set STREAMLINEAR_MCP_PATH to a streamlinear MCP entrypoint. ' +
      'Leave LINEAR_API_KEY unset to disable Linear.'
  );
}

/**
 * Create the instance.json config file for bot-toolkit's ConfigStore.
 * This bridges Scribble's config to bot-toolkit's expected format.
 */
export function createInstanceConfig(dataDir: string, mcpPath: string, tenant: TenantConfig): string {
  const configDir = path.join(dataDir, 'config');
  const linearApiKey = parseOptionalEnv(process.env, 'LINEAR_API_KEY');
  const linearEnabled = Boolean(linearApiKey);
  const streamlinearMcpPath = resolveStreamlinearMcpPath();

  if (linearEnabled) {
    validateStreamlinearMcpPath(streamlinearMcpPath);
  }

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
          SCRIBBLE_LINEAR_ENABLED: String(linearEnabled),
          ...tenantConfigToEnv(tenant),
        },
        envFrom: ['GITHUB_TOKEN', 'WIKI_REPO'],
      },
      linear: {
        enabled: linearEnabled,
        command: 'node',
        args: [streamlinearMcpPath],
        envFrom: ['LINEAR_API_TOKEN'],
      },
    },
    plugins: {},
    knowledge: [path.join(dataDir, 'wiki')],
  };

  const instancePath = path.join(configDir, 'instance.json');
  writeOwnerOnlyJson(instancePath, instanceConfig, 'instance.json');
  logger.info('Created instance.json', { path: instancePath });

  const secrets: Record<string, string> = {};
  if (process.env.GITHUB_TOKEN) {
    secrets.GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  }
  if (process.env.WIKI_REPO) {
    secrets.WIKI_REPO = process.env.WIKI_REPO;
  }
  if (linearApiKey) {
    secrets.LINEAR_API_TOKEN = linearApiKey;
  }

  const secretsPath = path.join(configDir, 'secrets.json');
  writeOwnerOnlyJson(secretsPath, secrets, 'secrets.json');
  logger.debug('Created secrets.json', {
    path: secretsPath,
    keys: Object.keys(secrets),
  });

  return configDir;
}

function writeOwnerOnlyJson(filePath: string, data: unknown, label: string): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { mode: CONFIG_FILE_MODE });
  try {
    fs.chmodSync(filePath, CONFIG_FILE_MODE);
  } catch {
    logger.warn(`Could not set owner-only permissions on ${label}`, { path: filePath });
  }
}
