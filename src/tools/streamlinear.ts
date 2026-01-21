import { Logger } from '../utils/logger.js';

const logger = new Logger('StreamLinear');

export interface LinearTicket {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  state: string;
  url: string;
}

export interface PendingTicketSuggestion {
  id: string;
  title: string;
  description: string;
  context?: string;
  suggestedAt: Date;
  suggestedBy: string;
}

/**
 * StreamLinear MCP integration for Linear ticket management.
 *
 * This class manages pending ticket suggestions. The actual MCP calls
 * to create tickets are made by the orchestrator when confirm is called.
 */
export class StreamLinearTools {
  private pendingSuggestions: Map<string, PendingTicketSuggestion> = new Map();
  private suggestionCounter = 0;

  /**
   * Create a pending ticket suggestion that needs user confirmation.
   */
  suggestTicket(title: string, description: string, suggestedBy: string, context?: string): PendingTicketSuggestion {
    const id = `suggestion_${Date.now()}_${++this.suggestionCounter}`;

    const suggestion: PendingTicketSuggestion = {
      id,
      title,
      description,
      context,
      suggestedAt: new Date(),
      suggestedBy,
    };

    this.pendingSuggestions.set(id, suggestion);
    logger.info('Created ticket suggestion', { id, title, suggestedBy });

    return suggestion;
  }

  /**
   * Get a pending suggestion by ID.
   */
  getSuggestion(id: string): PendingTicketSuggestion | undefined {
    return this.pendingSuggestions.get(id);
  }

  /**
   * Remove a suggestion (after confirmation or cancellation).
   */
  removeSuggestion(id: string): boolean {
    return this.pendingSuggestions.delete(id);
  }

  /**
   * Get all pending suggestions.
   */
  getPendingSuggestions(): PendingTicketSuggestion[] {
    return Array.from(this.pendingSuggestions.values());
  }

  /**
   * Format a ticket for display.
   */
  formatTicket(ticket: LinearTicket): string {
    return `**${ticket.identifier}**: ${ticket.title}\nStatus: ${ticket.state}\nURL: ${ticket.url}`;
  }
}
