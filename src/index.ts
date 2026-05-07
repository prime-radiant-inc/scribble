// src/index.ts
// New entry point using bot-toolkit and Agent SDK

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  SessionDatabase,
  MessageSessionStore,
  ClaudeSessionManagerSDK,
  Logger,
  type Config as BotToolkitConfig,
} from '@primeradianthq/bot-toolkit';
import { WebClient } from '@slack/web-api';
import { SlackAdapterSDK } from './slack/adapterSDK.js';
import { buildEngagementConfig } from './config/engagement.js';
import { loadConfig } from './config/config.js';
import { parseOptionalEnv } from './config/tenantConfig.js';
import { createInstanceConfig } from './config/instanceConfig.js';
import { ScribbleOrchestrator } from './orchestrator/scribbleOrchestrator.js';
import { ConversationLogger } from './logging/conversationLogger.js';
import { ConstitutionManager } from './constitution/manager.js';
import { initTelemetry, shutdownTelemetry } from './telemetry/index.js';

const logger = new Logger('Main');

/**
 * Build bot-toolkit Config from Scribble's config
 */
function buildBotToolkitConfig(
  scribbleConfig: ReturnType<typeof loadConfig>,
  configDir: string
): BotToolkitConfig {
  return {
    claude: {
      paDirectory: '',
      configDir, // Points to our generated config directory
    },
    database: {
      path: path.join(scribbleConfig.dataDirectory, 'sessions.db'),
    },
    dataDirectory: scribbleConfig.dataDirectory,
    timezone: scribbleConfig.timezone,
    useAgentSDK: true,
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
  const configDir = createInstanceConfig(config.dataDirectory, mcpPath, config.tenant);

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
  const constitutionManager = new ConstitutionManager(path.join(config.dataDirectory, 'wiki'), {
    tenant: config.tenant,
    integrations: { linear: Boolean(parseOptionalEnv(process.env, 'LINEAR_API_KEY')) },
  });

  // Initialize Slack WebClient for cross-channel context
  const slackClient = new WebClient(config.slack.botToken);

  // Initialize orchestrator with Scribble-specific logic
  const orchestrator = new ScribbleOrchestrator({
    database,
    sessionManager,
    conversationLogger,
    constitutionManager,
    dataDir: config.dataDirectory,
    slackClient,
    decisionLogChannel: config.tenant.decisionLogChannel,
  });

  // Build engagement config
  const engagementConfig = buildEngagementConfig(config.tenant);

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
