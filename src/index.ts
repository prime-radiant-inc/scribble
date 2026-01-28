// src/index.ts
// New entry point using bot-toolkit and Agent SDK

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  SessionDatabase,
  MessageSessionStore,
  ClaudeSessionManagerSDK,
  Logger,
  type EngagementConfig,
  type Config as BotToolkitConfig,
} from 'bot-toolkit';
import { SlackAdapterSDK } from './slack/adapterSDK.js';
import { loadConfig } from './config/config.js';
import { ScribbleOrchestrator } from './orchestrator/scribbleOrchestrator.js';
import { ConversationLogger } from './logging/conversationLogger.js';
import { ConstitutionManager } from './constitution/manager.js';
import { initTelemetry, shutdownTelemetry } from './telemetry/index.js';

const logger = new Logger('Main');

/**
 * Create the instance.json config file for bot-toolkit's ConfigStore.
 * This bridges Scribble's config to bot-toolkit's expected format.
 */
function createInstanceConfig(dataDir: string, mcpPath: string): string {
  const configDir = path.join(dataDir, 'config');

  // Ensure config directory exists
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  // Create instance.json with scribble-mcp server
  const instanceConfig = {
    mcps: {
      'scribble-mcp': {
        enabled: true,
        command: 'node',
        args: [mcpPath],
        env: {
          DATA_DIRECTORY: dataDir,
        },
        envFrom: ['GITHUB_TOKEN', 'LINEAR_API_KEY', 'WIKI_REPO'],
      },
    },
    plugins: {},
    knowledge: [path.join(dataDir, 'wiki')],
  };

  const instancePath = path.join(configDir, 'instance.json');
  fs.writeFileSync(instancePath, JSON.stringify(instanceConfig, null, 2));
  logger.info('Created instance.json', { path: instancePath });

  // Create secrets.json from environment variables
  const secrets: Record<string, string> = {};
  if (process.env.GITHUB_TOKEN) {
    secrets.GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  }
  if (process.env.LINEAR_API_KEY) {
    secrets.LINEAR_API_KEY = process.env.LINEAR_API_KEY;
  }
  if (process.env.WIKI_REPO) {
    secrets.WIKI_REPO = process.env.WIKI_REPO;
  }

  const secretsPath = path.join(configDir, 'secrets.json');
  fs.writeFileSync(secretsPath, JSON.stringify(secrets, null, 2));
  logger.debug('Created secrets.json', {
    path: secretsPath,
    keys: Object.keys(secrets),
  });

  return configDir;
}

/**
 * Build bot-toolkit Config from Scribble's config
 */
function buildBotToolkitConfig(
  scribbleConfig: ReturnType<typeof loadConfig>,
  configDir: string
): BotToolkitConfig {
  return {
    // Matrix is not used for Scribble
    matrix: undefined,
    claude: {
      paDirectory: '',
      configDir, // Points to our generated config directory
    },
    database: {
      path: path.join(scribbleConfig.dataDirectory, 'sessions.db'),
    },
    dataDirectory: scribbleConfig.dataDirectory,
    timezone: process.env.TZ || 'America/Los_Angeles',
    useAgentSDK: true,
  };
}

/**
 * Build engagement configuration for Scribble.
 * Scribble responds to:
 * - @mentions (always)
 * - DMs (always)
 * - Name mentions in text: "scribble", "scrib"
 * - Active threads it's already engaged in
 * - Dismissal patterns to disengage
 */
function buildEngagementConfig(): EngagementConfig {
  return {
    nameMentions: ['scribble', 'scrib'],
    trackActiveThreads: true,
    dismissalPatterns: [
      /thanks,?\s*scrib/i,
      /thank you,?\s*scrib/i,
      /got it,?\s*scrib/i,
      /that's all/i,
      /never\s*mind/i,
      /dismiss/i,
      /go away/i,
    ],
    threadTimeout: 30 * 60 * 1000, // 30 minutes
  };
}

async function main() {
  logger.info('Starting Scribble bot (Agent SDK mode)...');

  // Load Scribble's config
  const config = loadConfig();

  // Initialize telemetry
  initTelemetry({
    enabled: config.telemetry.enabled,
    serviceName: 'scribble',
    prometheusPort: config.telemetry.prometheusPort,
  });

  // Path to compiled MCP server
  const mcpPath = path.resolve(process.cwd(), 'dist/mcp.js');
  if (!fs.existsSync(mcpPath)) {
    logger.warn(
      'MCP server not found at dist/mcp.js. Run npm run build:mcp first.'
    );
  }

  // Create instance config for bot-toolkit
  const configDir = createInstanceConfig(config.dataDirectory, mcpPath);

  // Build bot-toolkit config
  const botConfig = buildBotToolkitConfig(config, configDir);

  // Initialize database
  const databasePath = path.join(config.dataDirectory, 'sessions.db');
  const database = new SessionDatabase(databasePath);
  logger.info('Database initialized', { path: databasePath });

  // Initialize message session store
  const sessionStore = new MessageSessionStore(database.db);

  // Initialize Claude session manager
  const sessionManager = new ClaudeSessionManagerSDK(botConfig, sessionStore);

  // Initialize conversation logger
  const conversationLogger = new ConversationLogger(config.dataDirectory);

  // Initialize constitution manager
  const constitutionManager = new ConstitutionManager(path.join(config.dataDirectory, 'wiki'));

  // Initialize orchestrator with Scribble-specific logic
  const orchestrator = new ScribbleOrchestrator({
    database,
    sessionManager,
    conversationLogger,
    constitutionManager,
    dataDir: config.dataDirectory,
  });

  // Build engagement config
  const engagementConfig = buildEngagementConfig();

  // Initialize Slack adapter with engagement config
  const adapter = new SlackAdapterSDK({
    orchestrator,
    botToken: config.slack.botToken,
    appToken: config.slack.appToken,
    authorizedUsers: [], // Empty = all users allowed
    dataDir: config.dataDirectory,
    database, // Pass database for attention tracking
    engagement: engagementConfig,
  });

  // Start the adapter
  await adapter.start();
  logger.info('Scribble bot started successfully (Agent SDK mode)');

  // Periodic cleanup of processed events and timed-out threads
  setInterval(
    () => {
      database.cleanOldProcessedEvents(7); // Keep 7 days of event deduplication
      adapter.cleanupTimedOutThreads();
    },
    60 * 60 * 1000
  ); // Hourly

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    await adapter.stop();
    database.close();
    await shutdownTelemetry();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  logger.error('Fatal error', error);
  process.exit(1);
});
