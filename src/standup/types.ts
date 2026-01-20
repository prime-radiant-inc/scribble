export interface StandupRecord {
  person: string;
  personName: string;
  date: string;
  commitments: string[];
  blockers: string[];
  completed: string[];
  rawText: string;
  recordedAt: string;
}

export interface StandupFile {
  standups: StandupRecord[];
}
