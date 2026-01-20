import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WikiManager } from '../wikiManager.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('WikiManager', () => {
  let wikiManager: WikiManager;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-test-'));
    // Initialize as a git repo for WikiManager
    const { execSync } = await import('child_process');
    execSync('git init', { cwd: tempDir });
    execSync('git config user.email "test@test.com"', { cwd: tempDir });
    execSync('git config user.name "Test"', { cwd: tempDir });

    wikiManager = new WikiManager(tempDir, 'test/repo');
    // Mark as initialized to skip clone
    (wikiManager as any).initialized = true;
    (wikiManager as any).git = (await import('simple-git')).simpleGit(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('deleteEntry', () => {
    it('should delete an existing entry and return true', async () => {
      const entryPath = 'knowledge/test.md';
      const fullPath = path.join(tempDir, entryPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, '# Test\n\nContent');

      const result = await wikiManager.deleteEntry(entryPath);

      expect(result).toBe(true);
      expect(fs.existsSync(fullPath)).toBe(false);
    });

    it('should return false for non-existent entry', async () => {
      const result = await wikiManager.deleteEntry('does/not/exist.md');
      expect(result).toBe(false);
    });
  });
});
