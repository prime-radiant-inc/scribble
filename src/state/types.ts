export interface ProcessedMessageRecord {
  messageTs: string;
  channelId: string;
  processedAt: number;
}

export interface ChannelRecord {
  channelId: string;
  channelName: string;
  joinedAt: number;
  isMember: boolean;
}

export interface ActiveThread {
  threadId: string;        // thread_ts or message_ts
  channelId: string;
  channelName: string;
  engagedAt: number;       // when Scribble was engaged
  lastActivity: number;    // last message timestamp
  topicSummary: string;    // what the conversation is about
  participants: string[];  // user IDs involved
}

export interface StandupCommitment {
  person: string;
  personName: string;
  date: string;            // YYYY-MM-DD
  commitments: string[];
  blockers: string[];
  completed: string[];
  rawText: string;
}
