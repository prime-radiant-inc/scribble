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
