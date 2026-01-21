export interface ContextMessage {
  channelId?: string;
  channelName: string;
  userName: string;
  text: string;
  timestamp: string;
  threadTs?: string;
}

export interface ThreadMessage {
  role: 'user' | 'assistant';
  userName: string;
  text: string;
}

export interface AssembledContext {
  threadMessages: ThreadMessage[];  // Structured thread for messages array
  backgroundContext: string;        // Channel activity, wiki, etc. for system prompt
}

export interface ContextOptions {
  maxMessages?: number;
  maxTokens?: number;
  includeWiki?: boolean;
  includeLinear?: boolean;
}
