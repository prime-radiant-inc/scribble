import { LinearClient, Issue } from '@linear/sdk';
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
 * Linear integration for ticket management.
 *
 * This class manages pending ticket suggestions and provides actual
 * Linear API calls for searching and creating issues.
 */
export class StreamLinearTools {
  private client: LinearClient | null = null;
  private pendingSuggestions: Map<string, PendingTicketSuggestion> = new Map();
  private suggestionCounter = 0;
  private defaultTeamId: string | null = null;

  constructor(apiKey?: string) {
    if (apiKey) {
      this.client = new LinearClient({ apiKey });
      logger.info('Linear client initialized');
      // Fetch default team on init
      this.initDefaultTeam();
    } else {
      logger.warn('Linear API key not provided - ticket operations will be unavailable');
    }
  }

  private async initDefaultTeam(): Promise<void> {
    if (!this.client) return;
    try {
      const teams = await this.client.teams();
      if (teams.nodes.length > 0) {
        this.defaultTeamId = teams.nodes[0].id;
        logger.info('Default team set', { teamId: this.defaultTeamId, teamName: teams.nodes[0].name });
      }
    } catch (error) {
      logger.error('Failed to fetch default team', error);
    }
  }

  /**
   * Check if Linear is configured and available.
   */
  isConfigured(): boolean {
    return this.client !== null;
  }

  /**
   * Search for issues in Linear.
   */
  async searchIssues(query: string): Promise<LinearTicket[]> {
    if (!this.client) {
      throw new Error('Linear is not configured');
    }

    try {
      const results = await this.client.searchIssues(query);
      const tickets: LinearTicket[] = [];

      for (const node of results.nodes) {
        const state = await node.state;
        tickets.push({
          id: node.id,
          identifier: node.identifier,
          title: node.title,
          description: node.description ?? undefined,
          state: state?.name ?? 'Unknown',
          url: node.url,
        });
      }

      logger.info('Search completed', { query, resultCount: tickets.length });
      return tickets;
    } catch (error) {
      logger.error('Search failed', error);
      throw error;
    }
  }

  /**
   * Create an issue in Linear.
   */
  async createIssue(title: string, description: string): Promise<LinearTicket> {
    if (!this.client) {
      throw new Error('Linear is not configured');
    }

    if (!this.defaultTeamId) {
      // Try to fetch it again
      await this.initDefaultTeam();
      if (!this.defaultTeamId) {
        throw new Error('No Linear team available');
      }
    }

    try {
      const issuePayload = await this.client.createIssue({
        teamId: this.defaultTeamId,
        title,
        description,
      });

      const issue = await issuePayload.issue;
      if (!issue) {
        throw new Error('Failed to create issue - no issue returned');
      }

      const state = await issue.state;
      const ticket: LinearTicket = {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description ?? undefined,
        state: state?.name ?? 'Unknown',
        url: issue.url,
      };

      logger.info('Issue created', { identifier: ticket.identifier, title: ticket.title });
      return ticket;
    } catch (error) {
      logger.error('Failed to create issue', error);
      throw error;
    }
  }

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
