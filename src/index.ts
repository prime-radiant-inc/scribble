import { SlackAdapter } from './slack/adapter.js';
import { ScribbleOrchestrator } from './core/orchestrator.js';
import { ScribbleDatabase } from './core/database.js';
import { ConversationLogger } from './logging/conversationLogger.js';
import { WikiManager } from './wiki/wikiManager.js';
import { loadConfig } from './config/config.js';
import { Logger } from './utils/logger.js';

const logger = new Logger('Main');

async function main() {
  logger.info('Starting Scribble bot...');

  const config = loadConfig();

  // Initialize database
  const database = new ScribbleDatabase(config.database.path);

  // Initialize conversation logger
  const conversationLogger = new ConversationLogger(config.dataDirectory);

  // Initialize wiki manager
  const wikiManager = new WikiManager(
    config.wiki.localPath,
    config.wiki.repo,
    config.github.token
  );

  // Initialize wiki repository
  try {
    await wikiManager.initialize();
    logger.info('Wiki repository initialized');
  } catch (error) {
    logger.error('Failed to initialize wiki repository', error);
    // Continue without wiki - it can be initialized later
  }

  // Initialize orchestrator
  const orchestrator = new ScribbleOrchestrator({
    config,
    database,
    conversationLogger,
    wikiManager,
  });

  // Initialize Slack adapter
  const adapter = new SlackAdapter({
    botToken: config.slack.botToken,
    appToken: config.slack.appToken,
    database,
    orchestrator,
    dataDir: config.dataDirectory,
  });

  // Start the adapter
  await adapter.start();
  logger.info('Scribble bot started successfully');

  // Periodic cleanup
  setInterval(() => {
    database.cleanOldMessages(30);
  }, 24 * 60 * 60 * 1000); // Daily

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    await adapter.stop();
    database.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  logger.error('Fatal error', error);
  process.exit(1);
});
