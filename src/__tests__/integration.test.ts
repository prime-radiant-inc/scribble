// scribble/src/__tests__/integration.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ScribbleOrchestrator } from '../orchestrator/scribbleOrchestrator.js';
import { ConversationLogger } from '../logging/conversationLogger.js';
import { ConstitutionManager } from '../constitution/manager.js';
import { SessionDatabase } from 'bot-toolkit';
import * as fs from 'fs';

const TEST_DIR = '/tmp/scribble-integration-test';
const TEST_DB = `${TEST_DIR}/sessions.db`;

describe('Scribble Integration', () => {
  let database: SessionDatabase;
  let conversationLogger: ConversationLogger;
  let constitutionManager: ConstitutionManager;

  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
    fs.mkdirSync(`${TEST_DIR}/wiki/_scribble`, { recursive: true });

    database = new SessionDatabase(TEST_DB);
    conversationLogger = new ConversationLogger(TEST_DIR);
    constitutionManager = new ConstitutionManager(`${TEST_DIR}/wiki`);
  });

  afterEach(() => {
    database.close();
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
  });

  it('should save main session after channel message', async () => {
    // This test verifies the database integration
    database.saveMainSession('C123', {
      sessionId: 'sess_test',
      contextTokens: 1000,
      compactionCount: 0,
    });

    const session = database.getMainSession('C123');
    expect(session).not.toBeNull();
    expect(session!.session_id).toBe('sess_test');
  });

  it('should log channel messages to main.json', async () => {
    await conversationLogger.logChannelMessage({
      channelId: 'C123',
      channelName: 'general',
      threadTs: null,
      messageTs: '1234567890.000001',
      userId: 'U456',
      userName: 'Test User',
      text: 'Test message',
      isMention: false,
      isDm: false,
    });

    const context = await conversationLogger.getChannelContext('C123', 10);
    expect(context).toHaveLength(1);
    expect(context[0].text).toBe('Test message');
  });

  it('should build constitution with learned behaviors', () => {
    constitutionManager.addLearnedBehavior('Test behavior', 'U123', 'Testing');

    const constitution = constitutionManager.getFullConstitution();
    expect(constitution).toContain('Test behavior');
    expect(constitution).toContain('diligent colleague'); // Base constitution
  });
});
