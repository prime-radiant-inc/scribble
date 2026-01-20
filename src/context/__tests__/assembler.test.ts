import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ContextAssembler } from '../assembler.js';
import { ConversationLogger } from '../../logging/conversationLogger.js';
import * as fs from 'fs';

const TEST_DIR = '/tmp/scribble-test-context';

describe('ContextAssembler', () => {
  let assembler: ContextAssembler;
  let conversationLogger: ConversationLogger;

  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
    fs.mkdirSync(TEST_DIR, { recursive: true });
    conversationLogger = new ConversationLogger(TEST_DIR);
    // WikiManager would need mocking for full tests
    assembler = new ContextAssembler(conversationLogger, null as any);
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true });
  });

  it('should format cross-channel context with attribution', () => {
    const context = assembler.formatCrossChannelContext([
      {
        channelName: 'engineering',
        userName: 'Drew',
        text: 'The auth refactor is blocked on API changes',
        timestamp: new Date('2026-01-19').toISOString(),
      },
    ]);

    expect(context).toContain('[From #engineering');
    expect(context).toContain('Drew');
    expect(context).toContain('auth refactor');
  });

  it('should respect context budget', async () => {
    // This tests that we don't exceed token limits
    const longMessages = Array(100).fill({
      channelName: 'general',
      userName: 'User',
      text: 'This is a test message that is reasonably long to simulate real conversations.',
      timestamp: new Date().toISOString(),
    });

    const context = assembler.formatCrossChannelContext(longMessages, { maxMessages: 10 });
    const messageCount = (context.match(/\[From #/g) || []).length;
    expect(messageCount).toBeLessThanOrEqual(10);
  });

  it('should extract search terms excluding stop words', () => {
    // Testing that extractSearchTerms filters out common stop words
    // and returns meaningful search terms
    const terms = assembler.extractSearchTerms(
      'The quick brown fox jumps over the lazy dog and runs to the forest'
    );

    // Should not include stop words like 'the', 'and', 'to', 'over'
    expect(terms).not.toContain('the');
    expect(terms).not.toContain('and');
    expect(terms).not.toContain('over');

    // Should include meaningful words
    expect(terms).toContain('quick');
    expect(terms).toContain('brown');
    expect(terms).toContain('fox');
  });

  it('should limit extracted search terms to 5', () => {
    const terms = assembler.extractSearchTerms(
      'authentication authorization database migration deployment kubernetes docker container orchestration microservices'
    );

    expect(terms.length).toBeLessThanOrEqual(5);
  });

  it('should handle empty text when extracting search terms', () => {
    const terms = assembler.extractSearchTerms('');
    expect(terms).toEqual([]);
  });

  it('should deduplicate search terms', () => {
    const terms = assembler.extractSearchTerms(
      'test test test different test another test'
    );

    // 'test' should only appear once
    const testCount = terms.filter(t => t === 'test').length;
    expect(testCount).toBeLessThanOrEqual(1);
  });
});
