export type GardeningSuggestionType =
  | 'duplicate'      // Two pages cover same topic
  | 'miscategorized' // Page is in wrong category
  | 'outdated'       // Page content seems stale
  | 'merge'          // Pages should be combined
  | 'split';         // Page covers too many topics

export interface GardeningSuggestion {
  id: string;
  type: GardeningSuggestionType;
  description: string;
  affectedPaths: string[];
  suggestedAction: string;
  confidence: number;  // 0-1
  createdAt: number;
}

export interface GardenerConfig {
  minConfidence: number;  // Only surface suggestions above this threshold
}
