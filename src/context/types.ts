export interface ContextMessage {
  channelId?: string;
  channelName: string;
  userName: string;
  text: string;
  timestamp: string;
  threadTs?: string;
}

export interface AssembledContext {
  currentThread: string;
  channelRecent: string;
  crossChannel: string;
  wikiReferences: string;
  linearReferences: string;
}

export interface ContextOptions {
  maxMessages?: number;
  maxTokens?: number;
  includeWiki?: boolean;
  includeLinear?: boolean;
}
