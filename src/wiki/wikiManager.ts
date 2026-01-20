import * as fs from 'fs';
import * as path from 'path';
import { simpleGit, SimpleGit } from 'simple-git';
import { Logger } from '../utils/logger.js';
import { WikiEntry } from '../core/types.js';

const logger = new Logger('WikiManager');

export class WikiManager {
  private git: SimpleGit;
  private localPath: string;
  private repoUrl: string;
  private initialized: boolean = false;

  constructor(localPath: string, repo: string, githubToken?: string) {
    this.localPath = localPath;

    // Build repo URL with token for auth
    if (githubToken) {
      this.repoUrl = `https://${githubToken}@github.com/${repo}.git`;
    } else {
      this.repoUrl = `https://github.com/${repo}.git`;
    }

    this.git = simpleGit();
  }

  /**
   * Initialize the wiki - clone if needed, pull latest
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Mark directory as safe to avoid "dubious ownership" errors in containers
      const globalGit = simpleGit();
      await globalGit.addConfig('safe.directory', this.localPath, false, 'global');

      if (fs.existsSync(path.join(this.localPath, '.git'))) {
        // Already cloned, just pull
        this.git = simpleGit(this.localPath);
        await this.git.pull();
        logger.info('Wiki repository updated');
      } else {
        // Clone the repo
        if (!fs.existsSync(this.localPath)) {
          fs.mkdirSync(this.localPath, { recursive: true });
        }
        await this.git.clone(this.repoUrl, this.localPath);
        this.git = simpleGit(this.localPath);
        logger.info('Wiki repository cloned');
      }

      // Configure git user for commits
      await this.git.addConfig('user.email', 'scribble@prime-radiant.ai', false, 'local');
      await this.git.addConfig('user.name', 'Scribble Bot', false, 'local');

      this.initialized = true;
    } catch (error) {
      logger.error('Failed to initialize wiki', error);
      throw error;
    }
  }

  /**
   * Read a wiki entry
   */
  async readEntry(entryPath: string): Promise<string | null> {
    await this.initialize();

    const fullPath = path.join(this.localPath, entryPath);
    if (!fs.existsSync(fullPath)) {
      return null;
    }

    return fs.readFileSync(fullPath, 'utf-8');
  }

  /**
   * Write or update a wiki entry
   */
  async writeEntry(entry: WikiEntry): Promise<void> {
    await this.initialize();

    const fullPath = path.join(this.localPath, entry.path);
    const dir = path.dirname(fullPath);

    // Ensure directory exists
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Build content
    const content = this.buildContent(entry);
    fs.writeFileSync(fullPath, content);

    logger.info('Wiki entry written', { path: entry.path });
  }

  /**
   * Delete a wiki entry
   * @returns true if deleted, false if entry didn't exist
   */
  async deleteEntry(entryPath: string): Promise<boolean> {
    await this.initialize();

    const fullPath = path.join(this.localPath, entryPath);
    if (!fs.existsSync(fullPath)) {
      return false;
    }

    fs.unlinkSync(fullPath);
    logger.info('Wiki entry deleted', { path: entryPath });
    return true;
  }

  /**
   * Rename/move a wiki entry
   * @returns true if renamed, false if source didn't exist
   */
  async renameEntry(oldPath: string, newPath: string): Promise<boolean> {
    await this.initialize();

    const fullOldPath = path.join(this.localPath, oldPath);
    const fullNewPath = path.join(this.localPath, newPath);

    if (!fs.existsSync(fullOldPath)) {
      return false;
    }

    // Ensure destination directory exists
    const destDir = path.dirname(fullNewPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    fs.renameSync(fullOldPath, fullNewPath);
    logger.info('Wiki entry renamed', { from: oldPath, to: newPath });
    return true;
  }

  /**
   * Commit and push changes
   */
  async commit(message: string): Promise<void> {
    await this.initialize();

    try {
      // Check if there are changes
      const status = await this.git.status();
      if (status.files.length === 0) {
        logger.debug('No changes to commit');
        return;
      }

      // Stage all changes
      await this.git.add('.');

      // Commit
      await this.git.commit(message);

      // Push
      await this.git.push();

      logger.info('Wiki changes committed and pushed', { message });
    } catch (error) {
      logger.error('Failed to commit wiki changes', error);
      throw error;
    }
  }

  /**
   * List entries in a category
   */
  async listEntries(category: string): Promise<string[]> {
    await this.initialize();

    const categoryPath = path.join(this.localPath, category);
    if (!fs.existsSync(categoryPath)) {
      return [];
    }

    return this.walkDirectory(categoryPath)
      .filter(f => f.endsWith('.md'))
      .map(f => path.relative(this.localPath, f));
  }

  /**
   * Search wiki content
   */
  async search(query: string): Promise<WikiSearchResult[]> {
    await this.initialize();

    const results: WikiSearchResult[] = [];
    const queryLower = query.toLowerCase();
    const files = this.walkDirectory(this.localPath).filter(f => f.endsWith('.md'));

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      if (content.toLowerCase().includes(queryLower)) {
        const relativePath = path.relative(this.localPath, file);
        const title = this.extractTitle(content);
        const snippet = this.extractSnippet(content, queryLower);

        results.push({
          path: relativePath,
          title,
          snippet,
        });
      }
    }

    return results;
  }

  /**
   * Pull latest changes from remote
   */
  async pull(): Promise<void> {
    await this.initialize();
    await this.git.pull();
    logger.info('Wiki pulled latest changes');
  }

  /**
   * Get commit history for a wiki entry
   */
  async getHistory(entryPath: string, limit: number = 10): Promise<WikiCommit[]> {
    await this.initialize();

    try {
      const log = await this.git.log({
        file: entryPath,
        maxCount: limit,
      });

      return log.all.map(commit => ({
        hash: commit.hash,
        shortHash: commit.hash.substring(0, 7),
        date: commit.date,
        message: commit.message,
        author: commit.author_name,
      }));
    } catch (error) {
      logger.error('Failed to get wiki history', { entryPath, error });
      return [];
    }
  }

  /**
   * Read a specific version of a wiki entry from git history
   */
  async readVersion(entryPath: string, commitHash: string): Promise<string | null> {
    await this.initialize();

    try {
      const content = await this.git.show([`${commitHash}:${entryPath}`]);
      return content;
    } catch (error) {
      logger.error('Failed to read wiki version', { entryPath, commitHash, error });
      return null;
    }
  }

  private buildContent(entry: WikiEntry): string {
    // No frontmatter - title is H1, category/subcategory from path, dates from git
    return entry.content;
  }

  private walkDirectory(dir: string): string[] {
    const files: string[] = [];

    if (!fs.existsSync(dir)) return files;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== '.git') {
        files.push(...this.walkDirectory(fullPath));
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }

    return files;
  }

  private extractTitle(content: string): string {
    // Title is the first H1 heading
    const h1Match = content.match(/^#\s+(.+)$/m);
    if (h1Match) return h1Match[1];

    // Legacy: check for frontmatter title in old wiki files
    const titleMatch = content.match(/^title:\s*"?([^"\n]+)"?/m);
    if (titleMatch) return titleMatch[1];

    return 'Untitled';
  }

  private extractSnippet(content: string, query: string): string {
    const lines = content.split('\n');
    const queryLower = query.toLowerCase();

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(queryLower)) {
        const start = Math.max(0, i - 1);
        const end = Math.min(lines.length, i + 2);
        return lines.slice(start, end).join('\n');
      }
    }

    // No query match found - return beginning of content
    return content.substring(0, 200) + '...';
  }
}

export interface WikiSearchResult {
  path: string;
  title: string;
  snippet: string;
}

export interface WikiCommit {
  hash: string;
  shortHash: string;
  date: string;
  message: string;
  author: string;
}
