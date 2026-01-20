import { describe, it, expect, beforeEach } from 'vitest';
import { WikiGardener } from '../gardener.js';

describe('WikiGardener', () => {
  let gardener: WikiGardener;

  beforeEach(() => {
    gardener = new WikiGardener({ minConfidence: 0.7 });
  });

  describe('suggestion management', () => {
    it('should store and retrieve suggestions', () => {
      gardener.addSuggestion({
        type: 'duplicate',
        description: 'Pages cover same topic',
        affectedPaths: ['knowledge/auth.md', 'knowledge/authentication.md'],
        suggestedAction: 'Merge into single page',
        confidence: 0.8,
      });

      const suggestions = gardener.getPendingSuggestions();
      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].type).toBe('duplicate');
    });

    it('should confirm and remove suggestion', () => {
      gardener.addSuggestion({
        type: 'duplicate',
        description: 'Test',
        affectedPaths: ['a.md', 'b.md'],
        suggestedAction: 'Merge',
        confidence: 0.8,
      });

      const suggestions = gardener.getPendingSuggestions();
      const id = suggestions[0].id;

      const confirmed = gardener.confirmSuggestion(id);
      expect(confirmed).not.toBeNull();
      expect(gardener.getPendingSuggestions()).toHaveLength(0);
    });

    it('should dismiss suggestion', () => {
      gardener.addSuggestion({
        type: 'outdated',
        description: 'Test',
        affectedPaths: ['old.md'],
        suggestedAction: 'Update',
        confidence: 0.9,
      });

      const suggestions = gardener.getPendingSuggestions();
      gardener.dismissSuggestion(suggestions[0].id);

      expect(gardener.getPendingSuggestions()).toHaveLength(0);
    });

    it('should filter by minimum confidence', () => {
      gardener.addSuggestion({
        type: 'duplicate',
        description: 'Low confidence',
        affectedPaths: ['a.md'],
        suggestedAction: 'Check',
        confidence: 0.5,  // Below 0.7 threshold
      });

      expect(gardener.getPendingSuggestions()).toHaveLength(0);
    });

    it('should get suggestion by id', () => {
      gardener.addSuggestion({
        type: 'merge',
        description: 'Test',
        affectedPaths: ['a.md', 'b.md'],
        suggestedAction: 'Merge',
        confidence: 0.8,
      });

      const suggestions = gardener.getPendingSuggestions();
      const id = suggestions[0].id;

      const retrieved = gardener.getSuggestion(id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.type).toBe('merge');
    });

    it('should return null for non-existent suggestion', () => {
      const retrieved = gardener.getSuggestion('non-existent-id');
      expect(retrieved).toBeNull();
    });
  });

  describe('formatSuggestionForSlack', () => {
    it('should format suggestion as Slack message', () => {
      gardener.addSuggestion({
        type: 'duplicate',
        description: 'Auth pages overlap',
        affectedPaths: ['knowledge/auth.md', 'knowledge/authentication.md'],
        suggestedAction: 'Merge into knowledge/authentication.md',
        confidence: 0.85,
      });

      const suggestion = gardener.getPendingSuggestions()[0];
      const formatted = gardener.formatSuggestionForSlack(suggestion);

      expect(formatted).toContain('duplicate');
      expect(formatted).toContain('Auth pages overlap');
      expect(formatted).toContain('knowledge/auth.md');
    });
  });
});
