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

  describe('renameEntry', () => {
    it('should rename an existing entry and return true', async () => {
      const oldPath = 'knowledge/old-name.md';
      const newPath = 'knowledge/new-name.md';
      const fullOldPath = path.join(tempDir, oldPath);
      const fullNewPath = path.join(tempDir, newPath);

      fs.mkdirSync(path.dirname(fullOldPath), { recursive: true });
      fs.writeFileSync(fullOldPath, '# Old Name\n\nContent');

      const result = await wikiManager.renameEntry(oldPath, newPath);

      expect(result).toBe(true);
      expect(fs.existsSync(fullOldPath)).toBe(false);
      expect(fs.existsSync(fullNewPath)).toBe(true);
      expect(fs.readFileSync(fullNewPath, 'utf-8')).toContain('Content');
    });

    it('should move entry to different category', async () => {
      const oldPath = 'knowledge/projects/item.md';
      const newPath = 'knowledge/decisions/item.md';
      const fullOldPath = path.join(tempDir, oldPath);
      const fullNewPath = path.join(tempDir, newPath);

      fs.mkdirSync(path.dirname(fullOldPath), { recursive: true });
      fs.writeFileSync(fullOldPath, '# Item');

      const result = await wikiManager.renameEntry(oldPath, newPath);

      expect(result).toBe(true);
      expect(fs.existsSync(fullOldPath)).toBe(false);
      expect(fs.existsSync(fullNewPath)).toBe(true);
    });

    it('should return false for non-existent source', async () => {
      const result = await wikiManager.renameEntry('does/not/exist.md', 'new/path.md');
      expect(result).toBe(false);
    });

    it('should overwrite existing destination', async () => {
      const oldPath = 'knowledge/source.md';
      const newPath = 'knowledge/destination.md';
      const fullOldPath = path.join(tempDir, oldPath);
      const fullNewPath = path.join(tempDir, newPath);

      fs.mkdirSync(path.dirname(fullOldPath), { recursive: true });
      fs.writeFileSync(fullOldPath, '# New Content');
      fs.writeFileSync(fullNewPath, '# Old Content');

      const result = await wikiManager.renameEntry(oldPath, newPath);

      expect(result).toBe(true);
      expect(fs.readFileSync(fullNewPath, 'utf-8')).toBe('# New Content');
    });
  });
});
