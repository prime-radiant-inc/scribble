import { SlackMessage } from '../core/types.js';
import { ClassificationResult, EngagementType } from './types.js';

const STANDUP_PATTERNS = [
  /yesterday:?\s/i,
  /today:?\s/i,
  /blockers?:?\s/i,
  /\bdid\b.*\bwill\b/i,
  /\bworking on\b/i,
];

const COMMITMENT_PATTERNS = [
  /i'?ll\s+(finish|complete|do|work on|get|have)/i,
  /going to\s+(finish|complete|do|work on)/i,
  /plan to\s+(finish|complete|do|work on)/i,
  /will\s+(finish|complete|do|work on|have)/i,
];

const TASK_PATTERNS = [
  /we need to/i,
  /someone should/i,
  /todo:?\s/i,
  /action item:?\s/i,
  /can you\s+(please\s+)?(do|make|create|fix|update)/i,
];

const BLOCKER_PATTERNS = [
  /blocked\s+(on|by)/i,
  /waiting\s+(on|for)/i,
  /can'?t\s+proceed/i,
  /dependency\s+on/i,
  /need\s+.*\s+before/i,
];

export class MessageClassifier {
  private botUserId: string;

  constructor(botUserId: string) {
    this.botUserId = botUserId;
  }

  classify(message: SlackMessage): ClassificationResult {
    const engagementType = this.getEngagementType(message);

    return {
      message,
      requiresResponse: engagementType !== 'none',
      engagementType,
      isStandup: this.isStandup(message),
      hasCommitment: this.hasCommitment(message),
      hasTask: this.hasTask(message),
      hasBlocker: this.hasBlocker(message),
    };
  }

  private getEngagementType(message: SlackMessage): EngagementType {
    if (message.isDm) return 'dm';
    if (message.isMention || message.text.includes(`<@${this.botUserId}>`)) {
      return 'mention';
    }
    if (/\bscribble\b/i.test(message.text)) return 'name';
    return 'none';
  }

  isStandup(message: SlackMessage): boolean {
    let matchCount = 0;
    for (const pattern of STANDUP_PATTERNS) {
      if (pattern.test(message.text)) matchCount++;
    }
    return matchCount >= 2;
  }

  hasCommitment(message: SlackMessage): boolean {
    return COMMITMENT_PATTERNS.some(p => p.test(message.text));
  }

  hasTask(message: SlackMessage): boolean {
    return TASK_PATTERNS.some(p => p.test(message.text));
  }

  hasBlocker(message: SlackMessage): boolean {
    return BLOCKER_PATTERNS.some(p => p.test(message.text));
  }
}
