import * as path from 'node:path';
import type { Config as BotToolkitConfig } from '@primeradianthq/bot-toolkit';
import { loadConfig } from './config.js';

/**
 * Build bot-toolkit Config from Scribble's config.
 */
export function buildBotToolkitConfig(
  scribbleConfig: ReturnType<typeof loadConfig>,
  configDir: string
): BotToolkitConfig {
  return {
    claude: {
      paDirectory: '',
      configDir,
    },
    database: {
      path: path.join(scribbleConfig.dataDirectory, 'sessions.db'),
    },
    dataDirectory: scribbleConfig.dataDirectory,
    timezone: scribbleConfig.timezone,
    useAgentSDK: true,
    autoMemory: 'disabled',
  };
}
