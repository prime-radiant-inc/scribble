import { describe, it, expect, beforeEach } from 'vitest';
import { LinearTools } from '../linear.js';

describe('LinearTools', () => {
  let tools: LinearTools;

  beforeEach(() => {
    tools = new LinearTools('fake-api-key');
  });

  describe('configuration', () => {
    it('should report configured when API key provided', () => {
      expect(tools.isConfigured).toBe(true);
    });

    it('should report not configured when no API key', () => {
      const unconfigured = new LinearTools();
      expect(unconfigured.isConfigured).toBe(false);
    });
  });

  describe('ticket suggestions', () => {
    it('should create and retrieve suggestions', () => {
      const suggestionId = tools.suggestTicket(
        'Fix login bug',
        'Users cannot log in with SSO',
        { suggestedBy: 'U123', channelId: 'C123', messageTs: '123.456' }
      );

      const suggestion = tools.getSuggestion(suggestionId);
      expect(suggestion).not.toBeNull();
      expect(suggestion!.title).toBe('Fix login bug');
      expect(suggestion!.description).toBe('Users cannot log in with SSO');
      expect(suggestion!.suggestedBy).toBe('U123');
      expect(suggestion!.channelId).toBe('C123');
      expect(suggestion!.messageTs).toBe('123.456');
    });

    it('should return null for unknown suggestion IDs', () => {
      expect(tools.getSuggestion('nonexistent')).toBeNull();
    });

    it('should list all pending suggestions', () => {
      tools.suggestTicket(
        'First ticket',
        'Description 1',
        { suggestedBy: 'U123', channelId: 'C123', messageTs: '123.456' }
      );
      tools.suggestTicket(
        'Second ticket',
        'Description 2',
        { suggestedBy: 'U456', channelId: 'C456', messageTs: '789.012' }
      );

      const pending = tools.getPendingSuggestions();
      expect(pending).toHaveLength(2);
      expect(pending.map(s => s.title)).toContain('First ticket');
      expect(pending.map(s => s.title)).toContain('Second ticket');
    });

    it('should confirm and create tickets', async () => {
      const suggestionId = tools.suggestTicket(
        'Add dark mode',
        'Users want dark mode support',
        { suggestedBy: 'U123', channelId: 'C123', messageTs: '123.456' }
      );

      const ticket = await tools.confirmTicket(suggestionId);
      expect(ticket).not.toBeNull();
      expect(ticket!.title).toBe('Add dark mode');
      expect(ticket!.description).toBe('Users want dark mode support');
      expect(ticket!.id).toContain('LIN-');
      expect(ticket!.status).toBe('backlog');
      expect(ticket!.url).toContain('linear.app');
    });

    it('should remove suggestion after confirmation', async () => {
      const suggestionId = tools.suggestTicket(
        'Test ticket',
        'Description',
        { suggestedBy: 'U123', channelId: 'C123', messageTs: '123.456' }
      );

      await tools.confirmTicket(suggestionId);
      expect(tools.getSuggestion(suggestionId)).toBeNull();
    });

    it('should return null when confirming unknown suggestion', async () => {
      const ticket = await tools.confirmTicket('nonexistent');
      expect(ticket).toBeNull();
    });

    it('should return null when confirming without API key', async () => {
      const unconfigured = new LinearTools();
      const suggestionId = unconfigured.suggestTicket(
        'Test ticket',
        'Description',
        { suggestedBy: 'U123', channelId: 'C123', messageTs: '123.456' }
      );

      const ticket = await unconfigured.confirmTicket(suggestionId);
      expect(ticket).toBeNull();
    });

    it('should cancel suggestions', () => {
      const suggestionId = tools.suggestTicket(
        'Cancelled ticket',
        'Description',
        { suggestedBy: 'U123', channelId: 'C123', messageTs: '123.456' }
      );

      tools.cancelSuggestion(suggestionId);
      expect(tools.getSuggestion(suggestionId)).toBeNull();
    });

    it('should handle cancelling nonexistent suggestions gracefully', () => {
      // Should not throw
      expect(() => tools.cancelSuggestion('nonexistent')).not.toThrow();
    });
  });

  describe('search', () => {
    it('should return empty results when searching', async () => {
      const results = await tools.searchTickets('bug');
      expect(results.tickets).toEqual([]);
      expect(results.total).toBe(0);
    });

    it('should return empty results when not configured', async () => {
      const unconfigured = new LinearTools();
      const results = await unconfigured.searchTickets('bug');
      expect(results.tickets).toEqual([]);
      expect(results.total).toBe(0);
    });
  });
});
