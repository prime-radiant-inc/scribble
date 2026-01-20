import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StandupTracker } from '../tracker.js';
import * as fs from 'fs';

const TEST_DIR = '/tmp/scribble-test-standup';

describe('StandupTracker', () => {
  let tracker: StandupTracker;

  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
    fs.mkdirSync(TEST_DIR, { recursive: true });
    tracker = new StandupTracker(TEST_DIR);
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true });
  });

  it('should record standup commitments', () => {
    tracker.recordStandup({
      person: 'U123',
      personName: 'Jesse',
      date: '2026-01-20',
      commitments: ['Finish auth refactor', 'Review PRs'],
      blockers: [],
      completed: ['Fixed login bug'],
      rawText: 'Yesterday: Fixed login bug\nToday: Finish auth refactor, Review PRs',
    });

    const standup = tracker.getStandup('U123', '2026-01-20');
    expect(standup).not.toBeNull();
    expect(standup!.commitments).toContain('Finish auth refactor');
  });

  it('should get pending followups', () => {
    tracker.recordStandup({
      person: 'U123',
      personName: 'Jesse',
      date: '2026-01-19',
      commitments: ['Finish auth refactor'],
      blockers: [],
      completed: [],
      rawText: 'Today: Finish auth refactor',
    });

    const followups = tracker.getPendingFollowups('U123', '2026-01-20');
    expect(followups).toHaveLength(1);
    expect(followups[0]).toContain('auth refactor');
  });

  it('should not return followups if person had no commitments', () => {
    tracker.recordStandup({
      person: 'U123',
      personName: 'Jesse',
      date: '2026-01-19',
      commitments: [],
      blockers: [],
      completed: ['Fixed bugs'],
      rawText: 'Yesterday: Fixed bugs\nToday: nothing planned',
    });

    const followups = tracker.getPendingFollowups('U123', '2026-01-20');
    expect(followups).toHaveLength(0);
  });

  it('should not return followups if already addressed', () => {
    tracker.recordStandup({
      person: 'U123',
      personName: 'Jesse',
      date: '2026-01-19',
      commitments: ['Finish auth refactor'],
      blockers: [],
      completed: [],
      rawText: 'Today: Finish auth refactor',
    });

    tracker.recordStandup({
      person: 'U123',
      personName: 'Jesse',
      date: '2026-01-20',
      commitments: [],
      blockers: [],
      completed: ['Finished auth refactor'],
      rawText: 'Yesterday: Finished auth refactor\nToday: nothing',
    });

    const followups = tracker.getPendingFollowups('U123', '2026-01-20');
    expect(followups).toHaveLength(0);
  });
});
