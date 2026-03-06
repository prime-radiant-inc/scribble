export interface LearnedBehavior {
  id: string;
  behavior: string;
  addedAt: string;
  requestedBy: string;
  reasoning: string;
}

export interface ConstitutionChange {
  id: string;
  timestamp: string;
  change: string;
  requestedBy: string;
  reasoning: string;
}

export interface LearnedConstitution {
  behaviors: LearnedBehavior[];
}

export interface ChannelInstruction {
  id: string;
  channelId?: string;
  channelName?: string;
  instruction: string;
  addedAt: string;
  requestedBy: string;
}

export interface ChannelInstructions {
  instructions: ChannelInstruction[];
}

/** Legacy format — single `channel` field storing an ID */
export interface LegacyChannelInstruction {
  id: string;
  channel: string;
  instruction: string;
  addedAt: string;
  requestedBy: string;
}

export interface ChannelQuery {
  channelId?: string;
  channelName?: string;
}

export interface AddChannelInstructionInput {
  channelId?: string;
  channelName?: string;
  instruction: string;
  requestedBy: string;
}
