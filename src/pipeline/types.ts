import { SlackMessage } from '../core/types.js';

export type EngagementType = 'mention' | 'name' | 'dm' | 'active_thread' | 'none';

export interface ClassificationResult {
  message: SlackMessage;
  requiresResponse: boolean;
  engagementType: EngagementType;
  isStandup: boolean;
  hasCommitment: boolean;
  hasTask: boolean;
  hasBlocker: boolean;
}

export interface ExtractionResult {
  people: PersonMention[];
  tasks: TaskMention[];
  decisions: DecisionMention[];
  commitments: CommitmentMention[];
  blockers: BlockerMention[];
}

export interface PersonMention {
  userId: string;
  userName: string;
  context: string;
}

export interface TaskMention {
  description: string;
  assignee?: string;
  dueDate?: string;
  confidence: number;
}

export interface DecisionMention {
  decision: string;
  context: string;
  confidence: number;
}

export interface CommitmentMention {
  person: string;
  commitment: string;
  timeframe?: string;
}

export interface BlockerMention {
  description: string;
  affectedPerson?: string;
  severity: 'low' | 'medium' | 'high';
}
