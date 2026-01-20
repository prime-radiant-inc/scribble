import { Logger } from '../utils/logger.js';
import { LinearTicket, LinearSearchResult, TicketSuggestion } from './types.js';

const logger = new Logger('LinearTools');

/**
 * Linear integration wrapper
 *
 * In production, this would integrate with StreamLinear MCP
 * For now, it provides a stub implementation that can be connected later
 */
export class LinearTools {
  private apiKey: string | undefined;
  private pendingSuggestions: Map<string, TicketSuggestion> = new Map();
  private suggestionCounter = 0;

  constructor(apiKey?: string) {
    this.apiKey = apiKey;
    if (!apiKey) {
      logger.warn('Linear API key not configured - ticket features will be disabled');
    }
  }

  get isConfigured(): boolean {
    return !!this.apiKey;
  }

  /**
   * Search for existing Linear tickets
   */
  async searchTickets(query: string): Promise<LinearSearchResult> {
    if (!this.isConfigured) {
      return { tickets: [], total: 0 };
    }

    // TODO: Integrate with StreamLinear MCP or Linear API
    logger.info('Searching Linear tickets', { query });

    // Stub implementation - would call Linear API
    return { tickets: [], total: 0 };
  }

  /**
   * Suggest creating a ticket (requires confirmation)
   * Returns a suggestion ID that must be confirmed before creating
   */
  suggestTicket(
    title: string,
    description: string,
    context: { suggestedBy: string; channelId: string; messageTs: string }
  ): string {
    this.suggestionCounter++;
    const suggestionId = `suggestion_${Date.now()}_${this.suggestionCounter}`;

    this.pendingSuggestions.set(suggestionId, {
      title,
      description,
      ...context,
    });

    logger.info('Created ticket suggestion', { suggestionId, title });
    return suggestionId;
  }

  /**
   * Get a pending suggestion
   */
  getSuggestion(suggestionId: string): TicketSuggestion | null {
    return this.pendingSuggestions.get(suggestionId) || null;
  }

  /**
   * Confirm and create a suggested ticket
   */
  async confirmTicket(suggestionId: string): Promise<LinearTicket | null> {
    const suggestion = this.pendingSuggestions.get(suggestionId);
    if (!suggestion) {
      logger.warn('Suggestion not found', { suggestionId });
      return null;
    }

    if (!this.isConfigured) {
      logger.warn('Cannot create ticket - Linear not configured');
      return null;
    }

    // TODO: Integrate with StreamLinear MCP or Linear API
    logger.info('Creating Linear ticket', { title: suggestion.title });

    // Stub implementation - would call Linear API
    const ticket: LinearTicket = {
      id: `LIN-${Date.now()}`,
      title: suggestion.title,
      description: suggestion.description,
      status: 'backlog',
      priority: 2,
      url: `https://linear.app/team/issue/LIN-${Date.now()}`,
    };

    this.pendingSuggestions.delete(suggestionId);
    return ticket;
  }

  /**
   * Cancel a pending suggestion
   */
  cancelSuggestion(suggestionId: string): void {
    this.pendingSuggestions.delete(suggestionId);
    logger.info('Cancelled ticket suggestion', { suggestionId });
  }

  /**
   * Get all pending suggestions
   */
  getPendingSuggestions(): TicketSuggestion[] {
    return Array.from(this.pendingSuggestions.values());
  }
}
