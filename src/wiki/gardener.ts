import { GardeningSuggestion, GardeningSuggestionType, GardenerConfig } from './types.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('WikiGardener');

export class WikiGardener {
  private suggestions: Map<string, GardeningSuggestion> = new Map();
  private config: GardenerConfig;

  constructor(config: GardenerConfig) {
    this.config = config;
  }

  addSuggestion(suggestion: Omit<GardeningSuggestion, 'id' | 'createdAt'>): void {
    if (suggestion.confidence < this.config.minConfidence) {
      logger.debug('Suggestion below confidence threshold', {
        confidence: suggestion.confidence,
        threshold: this.config.minConfidence
      });
      return;
    }

    const id = `garden-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    const fullSuggestion: GardeningSuggestion = {
      ...suggestion,
      id,
      createdAt: Date.now(),
    };

    this.suggestions.set(id, fullSuggestion);
    logger.info('Added gardening suggestion', { id, type: suggestion.type });
  }

  getPendingSuggestions(): GardeningSuggestion[] {
    return Array.from(this.suggestions.values());
  }

  getSuggestion(id: string): GardeningSuggestion | null {
    return this.suggestions.get(id) || null;
  }

  confirmSuggestion(id: string): GardeningSuggestion | null {
    const suggestion = this.suggestions.get(id);
    if (suggestion) {
      this.suggestions.delete(id);
      logger.info('Suggestion confirmed', { id });
    }
    return suggestion || null;
  }

  dismissSuggestion(id: string): void {
    this.suggestions.delete(id);
    logger.info('Suggestion dismissed', { id });
  }

  formatSuggestionForSlack(suggestion: GardeningSuggestion): string {
    const typeEmoji: Record<GardeningSuggestionType, string> = {
      duplicate: ':card_index_dividers:',
      miscategorized: ':file_folder:',
      outdated: ':calendar:',
      merge: ':link:',
      split: ':scissors:',
    };

    const emoji = typeEmoji[suggestion.type] || ':bulb:';
    const paths = suggestion.affectedPaths.map(p => `\`${p}\``).join(', ');

    return [
      `${emoji} *Wiki gardening suggestion* (${suggestion.type})`,
      ``,
      suggestion.description,
      ``,
      `*Affected:* ${paths}`,
      `*Suggestion:* ${suggestion.suggestedAction}`,
      ``,
      `Reply "yes" to apply, or "no" to dismiss.`,
    ].join('\n');
  }
}

export { GardeningSuggestion, GardeningSuggestionType, GardenerConfig };
