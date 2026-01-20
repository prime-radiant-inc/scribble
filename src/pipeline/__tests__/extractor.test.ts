import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KnowledgeExtractor } from '../extractor.js';
import { SlackMessage } from '../../core/types.js';
import Anthropic from '@anthropic-ai/sdk';

// Mock Anthropic
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn(),
    },
  })),
}));

describe('KnowledgeExtractor', () => {
  let extractor: KnowledgeExtractor;
  let mockAnthropic: any;

  beforeEach(() => {
    mockAnthropic = {
      messages: {
        create: vi.fn(),
      },
    };
    extractor = new KnowledgeExtractor(mockAnthropic);
  });

  const makeMessage = (text: string): SlackMessage => ({
    channelId: 'C123',
    channelName: 'general',
    threadTs: null,
    messageTs: '123.456',
    userId: 'U123',
    userName: 'testuser',
    text,
    isMention: false,
    isDm: false,
  });

  it('should extract commitments from standup', async () => {
    mockAnthropic.messages.create.mockResolvedValue({
      content: [{
        type: 'text',
        text: JSON.stringify({
          commitments: [{ person: 'testuser', commitment: 'finish auth refactor', timeframe: 'today' }],
          tasks: [],
          decisions: [],
          blockers: [],
          people: [],
        }),
      }],
    });

    const msg = makeMessage("Yesterday: Fixed login bug\nToday: I'll finish the auth refactor\nBlockers: none");
    const result = await extractor.extract(msg);

    expect(result.commitments).toHaveLength(1);
    expect(result.commitments[0].commitment).toContain('auth refactor');
  });

  it('should extract blockers', async () => {
    mockAnthropic.messages.create.mockResolvedValue({
      content: [{
        type: 'text',
        text: JSON.stringify({
          commitments: [],
          tasks: [],
          decisions: [],
          blockers: [{ description: 'API changes', affectedPerson: 'testuser', severity: 'high' }],
          people: [],
        }),
      }],
    });

    const msg = makeMessage("I'm blocked on the API changes from the backend team");
    const result = await extractor.extract(msg);

    expect(result.blockers).toHaveLength(1);
    expect(result.blockers[0].description).toContain('API');
  });

  it('should extract tasks', async () => {
    mockAnthropic.messages.create.mockResolvedValue({
      content: [{
        type: 'text',
        text: JSON.stringify({
          commitments: [],
          tasks: [{ description: 'update the README', assignee: 'alice', dueDate: null, confidence: 0.9 }],
          decisions: [],
          blockers: [],
          people: [],
        }),
      }],
    });

    const msg = makeMessage('We need to update the README, alice can you handle that?');
    const result = await extractor.extract(msg);

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].description).toContain('README');
    expect(result.tasks[0].assignee).toBe('alice');
  });

  it('should extract decisions', async () => {
    mockAnthropic.messages.create.mockResolvedValue({
      content: [{
        type: 'text',
        text: JSON.stringify({
          commitments: [],
          tasks: [],
          decisions: [{ decision: 'use PostgreSQL', context: 'better for our scale', confidence: 0.95 }],
          blockers: [],
          people: [],
        }),
      }],
    });

    const msg = makeMessage("We've decided to use PostgreSQL for the new service, it's better for our scale");
    const result = await extractor.extract(msg);

    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0].decision).toContain('PostgreSQL');
  });

  it('should extract people mentions', async () => {
    mockAnthropic.messages.create.mockResolvedValue({
      content: [{
        type: 'text',
        text: JSON.stringify({
          commitments: [],
          tasks: [],
          decisions: [],
          blockers: [],
          people: [{ userId: 'U456', userName: 'bob', context: 'knows about the auth system' }],
        }),
      }],
    });

    const msg = makeMessage('Bob knows everything about the auth system, ask him');
    const result = await extractor.extract(msg);

    expect(result.people).toHaveLength(1);
    expect(result.people[0].userName).toBe('bob');
    expect(result.people[0].context).toContain('auth');
  });

  it('should return empty result on API error', async () => {
    mockAnthropic.messages.create.mockRejectedValue(new Error('API error'));

    const msg = makeMessage('Some message');
    const result = await extractor.extract(msg);

    expect(result.commitments).toHaveLength(0);
    expect(result.tasks).toHaveLength(0);
    expect(result.decisions).toHaveLength(0);
    expect(result.blockers).toHaveLength(0);
    expect(result.people).toHaveLength(0);
  });

  it('should handle markdown-wrapped JSON response', async () => {
    mockAnthropic.messages.create.mockResolvedValue({
      content: [{
        type: 'text',
        text: '```json\n' + JSON.stringify({
          commitments: [{ person: 'testuser', commitment: 'deploy', timeframe: 'tomorrow' }],
          tasks: [],
          decisions: [],
          blockers: [],
          people: [],
        }) + '\n```',
      }],
    });

    const msg = makeMessage("I'll deploy tomorrow");
    const result = await extractor.extract(msg);

    expect(result.commitments).toHaveLength(1);
    expect(result.commitments[0].commitment).toContain('deploy');
  });

  it('should return empty result when no JSON found', async () => {
    mockAnthropic.messages.create.mockResolvedValue({
      content: [{
        type: 'text',
        text: 'This is not JSON at all',
      }],
    });

    const msg = makeMessage('Some message');
    const result = await extractor.extract(msg);

    expect(result.commitments).toHaveLength(0);
    expect(result.tasks).toHaveLength(0);
  });
});
