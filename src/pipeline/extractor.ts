import Anthropic from '@anthropic-ai/sdk';
import { SlackMessage } from '../core/types.js';
import { ExtractionResult } from './types.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('KnowledgeExtractor');

const EXTRACTION_PROMPT = `You are extracting structured information from a Slack message.

Extract the following if present:
- commitments: What did this person commit to doing? Include timeframe if mentioned.
- tasks: Action items or todos mentioned (not personal commitments, but team tasks)
- decisions: Any decisions announced or made
- blockers: Anything blocking progress
- people: Information about people mentioned (expertise, roles, involvement)

Respond with JSON only, no markdown:
{
  "commitments": [{"person": "name", "commitment": "what", "timeframe": "when or null"}],
  "tasks": [{"description": "what", "assignee": "who or null", "dueDate": "when or null", "confidence": 0.0-1.0}],
  "decisions": [{"decision": "what", "context": "why", "confidence": 0.0-1.0}],
  "blockers": [{"description": "what", "affectedPerson": "who or null", "severity": "low|medium|high"}],
  "people": [{"userId": "if known", "userName": "name", "context": "what was said about them"}]
}

If nothing to extract for a category, use empty array.`;

export class KnowledgeExtractor {
  private anthropic: Anthropic;

  constructor(anthropic: Anthropic) {
    this.anthropic = anthropic;
  }

  async extract(message: SlackMessage): Promise<ExtractionResult> {
    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 1024,
        system: EXTRACTION_PROMPT,
        messages: [{
          role: 'user',
          content: `Channel: #${message.channelName}\nUser: ${message.userName}\nMessage: ${message.text}`,
        }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';

      // Parse JSON, handling potential markdown wrapping
      const cleaned = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);

      if (!jsonMatch) {
        logger.warn('No JSON found in extraction response', { text: text.substring(0, 100) });
        return this.emptyResult();
      }

      return JSON.parse(jsonMatch[0]) as ExtractionResult;
    } catch (error) {
      logger.error('Extraction failed', { error, messageTs: message.messageTs });
      return this.emptyResult();
    }
  }

  private emptyResult(): ExtractionResult {
    return {
      people: [],
      tasks: [],
      decisions: [],
      commitments: [],
      blockers: [],
    };
  }
}
