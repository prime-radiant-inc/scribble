export interface SlackMessage {
  channelId: string;
  channelName: string;
  threadTs: string | null;
  messageTs: string;
  userId: string;
  userName: string;
  text: string;
  files?: SlackFile[];
  isMention: boolean;
  isDm: boolean;
}

export interface SlackFile {
  id: string;
  name: string;
  mimetype: string;
  size: number;
  urlPrivate: string;
  localPath?: string;
}

export interface ConversationContext {
  channelId: string;
  channelName: string;
  threadTs: string | null;
  messages: ConversationMessage[];
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  userId?: string;
  userName?: string;
  text: string;
  timestamp: string;
}

export interface WikiEntry {
  path: string;
  title: string;
  content: string;  // Just the markdown content, no frontmatter
}

export interface ExtractedFact {
  type: 'project' | 'person' | 'decision' | 'process' | 'task' | 'issue';
  title: string;
  content: string;
  source: {
    channelId: string;
    channelName: string;
    messageTs: string;
    userId: string;
  };
  confidence: number;
}

export interface SessionStats {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
}
