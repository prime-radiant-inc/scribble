import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createInstanceConfig } from '../instanceConfig.js';

describe('createInstanceConfig', () => {
  let dataDir: string;
  const originalEnv = process.env;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scribble-config-'));
    process.env = { ...originalEnv };
    delete process.env.GITHUB_TOKEN;
    delete process.env.WIKI_REPO;
    delete process.env.LINEAR_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(dataDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('enables Linear only when LINEAR_API_KEY is set', () => {
    createInstanceConfig(dataDir, '/app/dist/mcp.js');
    let instance = JSON.parse(fs.readFileSync(path.join(dataDir, 'config', 'instance.json'), 'utf-8'));
    expect(instance.mcps.linear.enabled).toBe(false);

    process.env.LINEAR_API_KEY = 'lin_api_test';
    createInstanceConfig(dataDir, '/app/dist/mcp.js');
    instance = JSON.parse(fs.readFileSync(path.join(dataDir, 'config', 'instance.json'), 'utf-8'));

    expect(instance.mcps.linear.enabled).toBe(true);
    expect(instance.mcps.linear.args).toEqual([path.resolve(process.cwd(), 'lib/streamlinear-mcp.js')]);
    expect(instance.mcps.linear.env.LINEAR_API_TOKEN).toBe('lin_api_test');
  });

  it('writes local secrets with owner-only permissions when supported', () => {
    process.env.GITHUB_TOKEN = 'ghp_test';
    process.env.WIKI_REPO = 'owner/wiki';

    createInstanceConfig(dataDir, '/app/dist/mcp.js');

    const secretsPath = path.join(dataDir, 'config', 'secrets.json');
    const secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf-8'));
    const mode = fs.statSync(secretsPath).mode & 0o777;

    expect(secrets).toEqual({
      GITHUB_TOKEN: 'ghp_test',
      WIKI_REPO: 'owner/wiki',
    });
    expect(mode).toBe(0o600);
  });
});
