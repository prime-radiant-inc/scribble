import { describe, it, expect, beforeEach } from 'vitest';
import { StreamLinearTools } from '../streamlinear.js';

describe('StreamLinearTools', () => {
  let tools: StreamLinearTools;

  beforeEach(() => {
    tools = new StreamLinearTools();
  });

  describe('suggestTicket', () => {
    it('should create a suggestion with unique ID', () => {
      const suggestion = tools.suggestTicket('Test Title', 'Test Description', 'testuser');

      expect(suggestion.id).toMatch(/^suggestion_\d+_\d+$/);
      expect(suggestion.title).toBe('Test Title');
      expect(suggestion.description).toBe('Test Description');
      expect(suggestion.suggestedBy).toBe('testuser');
    });

    it('should store suggestion for later retrieval', () => {
      const suggestion = tools.suggestTicket('Title', 'Desc', 'user');
      const retrieved = tools.getSuggestion(suggestion.id);

      expect(retrieved).toEqual(suggestion);
    });
  });

  describe('removeSuggestion', () => {
    it('should remove existing suggestion', () => {
      const suggestion = tools.suggestTicket('Title', 'Desc', 'user');
      const removed = tools.removeSuggestion(suggestion.id);

      expect(removed).toBe(true);
      expect(tools.getSuggestion(suggestion.id)).toBeUndefined();
    });

    it('should return false for non-existent suggestion', () => {
      const removed = tools.removeSuggestion('fake_id');
      expect(removed).toBe(false);
    });
  });

  describe('getPendingSuggestions', () => {
    it('should return all pending suggestions', () => {
      tools.suggestTicket('Title 1', 'Desc 1', 'user1');
      tools.suggestTicket('Title 2', 'Desc 2', 'user2');

      const pending = tools.getPendingSuggestions();
      expect(pending).toHaveLength(2);
    });
  });

  describe('formatTicket', () => {
    it('should format a ticket for display', () => {
      const ticket = {
        id: 'abc123',
        identifier: 'ENG-42',
        title: 'Fix login bug',
        description: 'Users cannot log in',
        state: 'In Progress',
        url: 'https://linear.app/team/issue/ENG-42',
      };

      const formatted = tools.formatTicket(ticket);

      expect(formatted).toBe(
        '**ENG-42**: Fix login bug\nStatus: In Progress\nURL: https://linear.app/team/issue/ENG-42'
      );
    });
  });
});
