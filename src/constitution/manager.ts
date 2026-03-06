import * as fs from 'fs';
import * as path from 'path';
import type {
  LearnedBehavior,
  LearnedConstitution,
  ConstitutionChange,
  ChannelInstruction,
  ChannelInstructions,
  LegacyChannelInstruction,
  ChannelQuery,
  AddChannelInstructionInput,
} from './types.js';
import { BASE_CONSTITUTION, IMMUTABLE_PATTERNS } from './base.js';
import { Logger } from '../utils/logger.js';
import { metrics } from '../telemetry/metrics.js';

const logger = new Logger('ConstitutionManager');

export class ConstitutionManager {
  private wikiDir: string;
  private learnedFile: string;
  private logFile: string;
  private channelInstructionsFile: string;

  constructor(wikiDir: string) {
    this.wikiDir = wikiDir;
    this.learnedFile = path.join(wikiDir, '_scribble', 'constitution-learned.json');
    this.logFile = path.join(wikiDir, '_scribble', 'constitution-log.json');
    this.channelInstructionsFile = path.join(wikiDir, '_scribble', 'channel-instructions.json');
    this.ensureFiles();
  }

  private ensureFiles(): void {
    const dir = path.dirname(this.learnedFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.learnedFile)) {
      fs.writeFileSync(this.learnedFile, JSON.stringify({ behaviors: [] }, null, 2));
    }
    if (!fs.existsSync(this.logFile)) {
      fs.writeFileSync(this.logFile, JSON.stringify([], null, 2));
    }
    if (!fs.existsSync(this.channelInstructionsFile)) {
      fs.writeFileSync(this.channelInstructionsFile, JSON.stringify({ instructions: [] }, null, 2));
    }
  }

  getFullConstitution(): string {
    const learned = this.getLearnedBehaviors();
    const learnedSection = learned.length > 0
      ? learned.map(b => `- ${b.behavior}`).join('\n')
      : '(None yet)';

    return BASE_CONSTITUTION + learnedSection;
  }

  getLearnedBehaviors(): LearnedBehavior[] {
    try {
      const data: LearnedConstitution = JSON.parse(fs.readFileSync(this.learnedFile, 'utf-8'));
      return data.behaviors;
    } catch (error) {
      logger.warn('Failed to read learned behaviors, returning empty', { error });
      return [];
    }
  }

  addLearnedBehavior(behavior: string, requestedBy: string, reasoning: string): void {
    // Check if this attempts to modify immutable behavior
    for (const pattern of IMMUTABLE_PATTERNS) {
      if (pattern.test(behavior)) {
        throw new Error(`Cannot add behavior that modifies immutable rules: "${behavior}"`);
      }
    }

    let learned: LearnedConstitution;
    try {
      learned = JSON.parse(fs.readFileSync(this.learnedFile, 'utf-8'));
    } catch {
      learned = { behaviors: [] };
    }

    const newBehavior: LearnedBehavior = {
      id: `lb_${Date.now()}`,
      behavior,
      addedAt: new Date().toISOString(),
      requestedBy,
      reasoning,
    };

    learned.behaviors.push(newBehavior);

    try {
      fs.writeFileSync(this.learnedFile, JSON.stringify(learned, null, 2));
    } catch (error) {
      logger.error('Failed to save learned behavior', { behavior, error });
      throw new Error('Failed to save learned behavior - check file permissions');
    }

    metrics.behaviorsLearned.add(1);
    this.logChange(behavior, requestedBy, reasoning);

    logger.info('Added learned behavior', { behavior, requestedBy });
  }

  removeLearnedBehavior(id: string): void {
    let learned: LearnedConstitution;
    try {
      learned = JSON.parse(fs.readFileSync(this.learnedFile, 'utf-8'));
    } catch (error) {
      logger.warn('Failed to read learned behaviors for removal', { id, error });
      return; // Nothing to remove if we can't read
    }

    learned.behaviors = learned.behaviors.filter(b => b.id !== id);

    try {
      fs.writeFileSync(this.learnedFile, JSON.stringify(learned, null, 2));
    } catch (error) {
      logger.error('Failed to save after removing learned behavior', { id, error });
      throw new Error('Failed to remove learned behavior - check file permissions');
    }
  }

  private logChange(change: string, requestedBy: string, reasoning: string): void {
    let log: ConstitutionChange[];
    try {
      log = JSON.parse(fs.readFileSync(this.logFile, 'utf-8'));
    } catch {
      log = [];
    }

    log.push({
      id: `cc_${Date.now()}`,
      timestamp: new Date().toISOString(),
      change,
      requestedBy,
      reasoning,
    });

    try {
      fs.writeFileSync(this.logFile, JSON.stringify(log, null, 2));
    } catch (error) {
      logger.warn('Failed to write change log', { change, error });
      // Non-critical - don't throw
    }
  }

  getChangeLog(): ConstitutionChange[] {
    try {
      return JSON.parse(fs.readFileSync(this.logFile, 'utf-8'));
    } catch (error) {
      logger.warn('Failed to read change log, returning empty', { error });
      return [];
    }
  }

  // Channel instructions

  /**
   * Read and migrate instructions from disk.
   * Handles legacy format where `channel` was a single string (always an ID).
   */
  private readInstructions(): ChannelInstruction[] {
    try {
      const raw = JSON.parse(fs.readFileSync(this.channelInstructionsFile, 'utf-8'));
      const instructions: ChannelInstruction[] = (raw.instructions ?? []).map(
        (i: ChannelInstruction | LegacyChannelInstruction) => {
          // Legacy format: has `channel` but no `channelId`/`channelName`
          if ('channel' in i && !('channelId' in i)) {
            const legacy = i as LegacyChannelInstruction;
            return {
              id: legacy.id,
              channelId: legacy.channel,
              instruction: legacy.instruction,
              addedAt: legacy.addedAt,
              requestedBy: legacy.requestedBy,
            } as ChannelInstruction;
          }
          return i as ChannelInstruction;
        },
      );
      return instructions;
    } catch (error) {
      logger.warn('Failed to read channel instructions, returning empty', { error });
      return [];
    }
  }

  private writeInstructions(instructions: ChannelInstruction[]): void {
    try {
      fs.writeFileSync(
        this.channelInstructionsFile,
        JSON.stringify({ instructions }, null, 2),
      );
    } catch (error) {
      logger.error('Failed to save channel instructions', { error });
      throw new Error('Failed to save channel instruction - check file permissions');
    }
  }

  /**
   * Check if an instruction matches a channel query.
   * Matches if ANY provided query field matches ANY stored field (case-insensitive).
   */
  private matchesChannel(instruction: ChannelInstruction, query: ChannelQuery): boolean {
    const qId = query.channelId?.toLowerCase();
    const qName = query.channelName?.toLowerCase();
    const iId = instruction.channelId?.toLowerCase();
    const iName = instruction.channelName?.toLowerCase();

    if (qId && iId && qId === iId) return true;
    if (qName && iName && qName === iName) return true;
    return false;
  }

  getChannelInstructions(query?: ChannelQuery): ChannelInstruction[] {
    const instructions = this.readInstructions();
    if (!query) return instructions;
    return instructions.filter(i => this.matchesChannel(i, query));
  }

  addChannelInstruction(input: AddChannelInstructionInput): void {
    if (!input.channelId && !input.channelName) {
      throw new Error('At least one of channelId or channelName is required');
    }

    const instructions = this.readInstructions();

    const newInstruction: ChannelInstruction = {
      id: `ci_${Date.now()}`,
      ...(input.channelId ? { channelId: input.channelId } : {}),
      ...(input.channelName ? { channelName: input.channelName } : {}),
      instruction: input.instruction,
      addedAt: new Date().toISOString(),
      requestedBy: input.requestedBy,
    };

    instructions.push(newInstruction);
    this.writeInstructions(instructions);

    const channel = input.channelName || input.channelId || 'unknown';
    metrics.channelInstructionsSet.add(1, { channel });
    logger.info('Added channel instruction', {
      channelId: input.channelId,
      channelName: input.channelName,
      instruction: input.instruction,
      requestedBy: input.requestedBy,
    });
  }

  removeChannelInstruction(id: string): void {
    const instructions = this.readInstructions();
    const filtered = instructions.filter(i => i.id !== id);

    if (filtered.length === instructions.length) {
      logger.warn('Channel instruction not found for removal', { id });
      return;
    }

    this.writeInstructions(filtered);
  }

  getInstructionsForChannel(query: ChannelQuery): string {
    const instructions = this.getChannelInstructions(query);
    if (instructions.length === 0) return '';

    const channelLabel = query.channelName || query.channelId || 'unknown';
    return '\n\n## Channel-Specific Instructions for #' + channelLabel + '\n' +
      instructions.map(i => `- ${i.instruction}`).join('\n');
  }
}
