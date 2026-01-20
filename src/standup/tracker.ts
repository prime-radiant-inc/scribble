import * as fs from 'fs';
import * as path from 'path';
import { StandupRecord, StandupFile } from './types.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('StandupTracker');

export class StandupTracker {
  private standupDir: string;

  constructor(dataDir: string) {
    this.standupDir = path.join(dataDir, 'standups');
    if (!fs.existsSync(this.standupDir)) {
      fs.mkdirSync(this.standupDir, { recursive: true });
    }
  }

  private getFilePath(person: string): string {
    return path.join(this.standupDir, `${person}.json`);
  }

  private loadPersonStandups(person: string): StandupFile {
    const filePath = this.getFilePath(person);
    if (!fs.existsSync(filePath)) {
      return { standups: [] };
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }

  private savePersonStandups(person: string, data: StandupFile): void {
    fs.writeFileSync(this.getFilePath(person), JSON.stringify(data, null, 2));
  }

  recordStandup(record: Omit<StandupRecord, 'recordedAt'>): void {
    const data = this.loadPersonStandups(record.person);

    // Remove existing standup for same date if present
    data.standups = data.standups.filter(s => s.date !== record.date);

    data.standups.push({
      ...record,
      recordedAt: new Date().toISOString(),
    });

    // Keep only last 30 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    data.standups = data.standups.filter(s => s.date >= cutoffStr);

    this.savePersonStandups(record.person, data);
    logger.info('Recorded standup', { person: record.personName, date: record.date });
  }

  getStandup(person: string, date: string): StandupRecord | null {
    const data = this.loadPersonStandups(person);
    return data.standups.find(s => s.date === date) || null;
  }

  getPreviousStandup(person: string, beforeDate: string): StandupRecord | null {
    const data = this.loadPersonStandups(person);
    const sorted = data.standups
      .filter(s => s.date < beforeDate)
      .sort((a, b) => b.date.localeCompare(a.date));
    return sorted[0] || null;
  }

  private extractSignificantWords(text: string): Set<string> {
    // Extract words, normalize, and filter out common stop words
    const stopWords = new Set(['the', 'a', 'an', 'to', 'on', 'in', 'for', 'of', 'and', 'or']);
    return new Set(
      text.toLowerCase()
        .split(/\s+/)
        .map(w => w.replace(/[^a-z0-9]/g, ''))
        .filter(w => w.length > 2 && !stopWords.has(w))
    );
  }

  private textsMatch(text1: string, text2: string): boolean {
    // Check if one contains the other (simple case)
    const t1 = text1.toLowerCase();
    const t2 = text2.toLowerCase();
    if (t1.includes(t2) || t2.includes(t1)) {
      return true;
    }

    // Extract significant words and check overlap
    const words1 = this.extractSignificantWords(text1);
    const words2 = this.extractSignificantWords(text2);

    // Count matching words (allowing for partial matches like "finish" vs "finished")
    let matches = 0;
    for (const w1 of words1) {
      for (const w2 of words2) {
        if (w1.includes(w2) || w2.includes(w1)) {
          matches++;
          break;
        }
      }
    }

    // Consider it a match if most significant words match
    const threshold = Math.min(words1.size, words2.size) * 0.6;
    return matches >= threshold && matches > 0;
  }

  getPendingFollowups(person: string, currentDate: string): string[] {
    const previous = this.getPreviousStandup(person, currentDate);
    if (!previous || previous.commitments.length === 0) {
      return [];
    }

    const current = this.getStandup(person, currentDate);
    const completedItems = current?.completed || [];

    // Return commitments that weren't mentioned as completed
    return previous.commitments.filter(commitment => {
      return !completedItems.some(completed => this.textsMatch(commitment, completed));
    });
  }

  getAllPeopleWithStandups(): string[] {
    if (!fs.existsSync(this.standupDir)) return [];
    return fs.readdirSync(this.standupDir)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
  }
}
