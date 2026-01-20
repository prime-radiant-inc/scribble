import * as fs from 'fs';
import * as path from 'path';
import { LearnedBehavior, LearnedConstitution, ConstitutionChange, ChannelInstruction, ChannelInstructions } from './types.js';
import { BASE_CONSTITUTION, IMMUTABLE_PATTERNS } from './base.js';
import { Logger } from '../utils/logger.js';

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
    const data: LearnedConstitution = JSON.parse(fs.readFileSync(this.learnedFile, 'utf-8'));
    return data.behaviors;
  }

  addLearnedBehavior(behavior: string, requestedBy: string, reasoning: string): void {
    // Check if this attempts to modify immutable behavior
    for (const pattern of IMMUTABLE_PATTERNS) {
      if (pattern.test(behavior)) {
        throw new Error(`Cannot add behavior that modifies immutable rules: "${behavior}"`);
      }
    }

    const learned: LearnedConstitution = JSON.parse(fs.readFileSync(this.learnedFile, 'utf-8'));

    const newBehavior: LearnedBehavior = {
      id: `lb_${Date.now()}`,
      behavior,
      addedAt: new Date().toISOString(),
      requestedBy,
      reasoning,
    };

    learned.behaviors.push(newBehavior);
    fs.writeFileSync(this.learnedFile, JSON.stringify(learned, null, 2));

    this.logChange(behavior, requestedBy, reasoning);

    logger.info('Added learned behavior', { behavior, requestedBy });
  }

  removeLearnedBehavior(id: string): void {
    const learned: LearnedConstitution = JSON.parse(fs.readFileSync(this.learnedFile, 'utf-8'));
    learned.behaviors = learned.behaviors.filter(b => b.id !== id);
    fs.writeFileSync(this.learnedFile, JSON.stringify(learned, null, 2));
  }

  private logChange(change: string, requestedBy: string, reasoning: string): void {
    const log: ConstitutionChange[] = JSON.parse(fs.readFileSync(this.logFile, 'utf-8'));

    log.push({
      id: `cc_${Date.now()}`,
      timestamp: new Date().toISOString(),
      change,
      requestedBy,
      reasoning,
    });

    fs.writeFileSync(this.logFile, JSON.stringify(log, null, 2));
  }

  getChangeLog(): ConstitutionChange[] {
    return JSON.parse(fs.readFileSync(this.logFile, 'utf-8'));
  }

  // Channel instructions
  getChannelInstructions(channel?: string): ChannelInstruction[] {
    const data: ChannelInstructions = JSON.parse(fs.readFileSync(this.channelInstructionsFile, 'utf-8'));
    if (channel) {
      return data.instructions.filter(i => i.channel.toLowerCase() === channel.toLowerCase());
    }
    return data.instructions;
  }

  addChannelInstruction(channel: string, instruction: string, requestedBy: string): void {
    const data: ChannelInstructions = JSON.parse(fs.readFileSync(this.channelInstructionsFile, 'utf-8'));

    const newInstruction: ChannelInstruction = {
      id: `ci_${Date.now()}`,
      channel: channel.toLowerCase(),
      instruction,
      addedAt: new Date().toISOString(),
      requestedBy,
    };

    data.instructions.push(newInstruction);
    fs.writeFileSync(this.channelInstructionsFile, JSON.stringify(data, null, 2));

    logger.info('Added channel instruction', { channel, instruction, requestedBy });
  }

  removeChannelInstruction(id: string): void {
    const data: ChannelInstructions = JSON.parse(fs.readFileSync(this.channelInstructionsFile, 'utf-8'));
    data.instructions = data.instructions.filter(i => i.id !== id);
    fs.writeFileSync(this.channelInstructionsFile, JSON.stringify(data, null, 2));
  }

  getInstructionsForChannel(channel: string): string {
    const instructions = this.getChannelInstructions(channel);
    if (instructions.length === 0) return '';

    return '\n\n## Channel-Specific Instructions for #' + channel + '\n' +
      instructions.map(i => `- ${i.instruction}`).join('\n');
  }
}
