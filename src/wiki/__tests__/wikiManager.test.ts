import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WikiManager } from '../wikiManager.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('WikiManager', () => {
  let wikiManager: WikiManager;
  let tempDir: string;
  let outsideDir: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-test-'));
    outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-outside-'));
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
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  describe('path safety', () => {
    it('rejects traversal paths for reads and writes', async () => {
      await expect(wikiManager.readEntry('../outside.md')).rejects.toThrow('Unsafe wiki path');
      await expect(wikiManager.writeEntry({
        path: 'knowledge/../../outside.md',
        title: 'Outside',
        content: '# Outside',
      })).rejects.toThrow('Unsafe wiki path');
      expect(fs.existsSync(path.join(tempDir, '..', 'outside.md'))).toBe(false);
    });

    it('rejects absolute paths', async () => {
      const absolutePath = path.join(outsideDir, 'outside.md');

      await expect(wikiManager.deleteEntry(absolutePath)).rejects.toThrow('Unsafe wiki path');
      expect(fs.existsSync(absolutePath)).toBe(false);
    });

    it('rejects internal and dot-prefixed paths', async () => {
      await expect(wikiManager.readEntry('_scribble/constitution-learned.json')).rejects.toThrow('Unsafe wiki path');
      await expect(wikiManager.readEntry('.git/config')).rejects.toThrow('Unsafe wiki path');
      await expect(wikiManager.writeEntry({
        path: 'knowledge/.hidden/page.md',
        title: 'Hidden',
        content: '# Hidden',
      })).rejects.toThrow('Unsafe wiki path');
    });

    it('rejects writes outside markdown pages', async () => {
      await expect(wikiManager.writeEntry({
        path: 'knowledge/raw.json',
        title: 'Raw',
        content: '{}',
      })).rejects.toThrow('Unsafe wiki path');
    });

    it('rejects symlink escapes', async () => {
      const secretPath = path.join(outsideDir, 'secret.md');
      fs.writeFileSync(secretPath, '# Secret');
      fs.mkdirSync(path.join(tempDir, 'knowledge'), { recursive: true });
      fs.symlinkSync(secretPath, path.join(tempDir, 'knowledge', 'linked.md'));

      await expect(wikiManager.readEntry('knowledge/linked.md')).rejects.toThrow('Unsafe wiki path');
    });

    it('does not embed GitHub tokens in the clone URL', () => {
      const manager = new WikiManager(tempDir, 'owner/repo', 'ghp_secret');

      expect((manager as any).repoUrl).toBe('https://github.com/owner/repo.git');
    });

    it('does not trip simple-git unsafe env guards when GitHub token auth is configured', async () => {
      const originalGitPager = process.env.GIT_PAGER;
      process.env.GIT_PAGER = 'cat';

      try {
        const manager = new WikiManager(tempDir, 'owner/repo', 'ghp_secret');
        const git = (manager as any).createGit(tempDir);

        await expect(git.raw(['--version'])).resolves.toMatch(/^git version/);
      } finally {
        if (originalGitPager === undefined) {
          delete process.env.GIT_PAGER;
        } else {
          process.env.GIT_PAGER = originalGitPager;
        }
      }
    });
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
