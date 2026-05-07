import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createInstanceConfig } from '../instanceConfig.js';
import { parseTenantConfig } from '../tenantConfig.js';

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

  function tenant() {
    return parseTenantConfig({
      SCRIBBLE_ORG_NAME: 'Acme',
      SCRIBBLE_BOT_NAME: 'Scout',
      SCRIBBLE_BOT_ALIASES: 'scout,helper',
      SCRIBBLE_DECISION_LOG_CHANNEL: 'decisions',
      SCRIBBLE_WIKI_GIT_AUTHOR_NAME: 'Scout Bot',
      SCRIBBLE_WIKI_GIT_AUTHOR_EMAIL: 'scout@example.com',
    });
  }

  it('enables Linear only when LINEAR_API_KEY is set', () => {
    createInstanceConfig(dataDir, '/app/dist/mcp.js', tenant());
    let instance = JSON.parse(fs.readFileSync(path.join(dataDir, 'config', 'instance.json'), 'utf-8'));
    expect(instance.mcps.linear.enabled).toBe(false);
    expect(instance.mcps['scribble-mcp'].env.SCRIBBLE_LINEAR_ENABLED).toBe('false');

    process.env.LINEAR_API_KEY = 'lin_api_test';
    createInstanceConfig(dataDir, '/app/dist/mcp.js', tenant());
    instance = JSON.parse(fs.readFileSync(path.join(dataDir, 'config', 'instance.json'), 'utf-8'));

    expect(instance.mcps.linear.enabled).toBe(true);
    expect(instance.mcps['scribble-mcp'].env.SCRIBBLE_LINEAR_ENABLED).toBe('true');
    expect(instance.mcps.linear.args[0]).toMatch(/\/lib\/streamlinear-mcp\.js$/);
    expect(instance.mcps.linear.env).toBeUndefined();
    expect(instance.mcps.linear.envFrom).toEqual(['LINEAR_API_TOKEN']);
  });

  it('allows overriding the streamlinear MCP path', () => {
    process.env.LINEAR_API_KEY = 'lin_api_test';
    process.env.STREAMLINEAR_MCP_PATH = '/custom/streamlinear-mcp.js';

    createInstanceConfig(dataDir, '/app/dist/mcp.js', tenant());
    const instance = JSON.parse(fs.readFileSync(path.join(dataDir, 'config', 'instance.json'), 'utf-8'));

    expect(instance.mcps.linear.args).toEqual(['/custom/streamlinear-mcp.js']);
  });

  it('writes config and local secrets with owner-only permissions when supported', () => {
    process.env.GITHUB_TOKEN = 'ghp_test';
    process.env.WIKI_REPO = 'owner/wiki';
    process.env.LINEAR_API_KEY = 'lin_api_test';

    createInstanceConfig(dataDir, '/app/dist/mcp.js', tenant());

    const instancePath = path.join(dataDir, 'config', 'instance.json');
    const secretsPath = path.join(dataDir, 'config', 'secrets.json');
    const secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf-8'));
    const instanceMode = fs.statSync(instancePath).mode & 0o777;
    const secretsMode = fs.statSync(secretsPath).mode & 0o777;

    expect(secrets).toEqual({
      GITHUB_TOKEN: 'ghp_test',
      WIKI_REPO: 'owner/wiki',
      LINEAR_API_TOKEN: 'lin_api_test',
    });
    expect(instanceMode).toBe(0o600);
    expect(secretsMode).toBe(0o600);
  });

  it('passes normalized tenant env to scribble-mcp', () => {
    createInstanceConfig(dataDir, '/app/dist/mcp.js', tenant());

    const instance = JSON.parse(fs.readFileSync(path.join(dataDir, 'config', 'instance.json'), 'utf-8'));

    expect(instance.mcps['scribble-mcp'].env).toMatchObject({
      DATA_DIRECTORY: dataDir,
      SCRIBBLE_LINEAR_ENABLED: 'false',
      SCRIBBLE_ORG_NAME: 'Acme',
      SCRIBBLE_BOT_NAME: 'Scout',
      SCRIBBLE_BOT_ALIASES: 'scout,helper',
      SCRIBBLE_DECISION_LOG_CHANNEL: 'decisions',
      SCRIBBLE_WIKI_GIT_AUTHOR_NAME: 'Scout Bot',
      SCRIBBLE_WIKI_GIT_AUTHOR_EMAIL: 'scout@example.com',
    });
  });

  it('treats blank LINEAR_API_KEY as disabled and omits the secret', () => {
    process.env.LINEAR_API_KEY = '   ';

    createInstanceConfig(dataDir, '/app/dist/mcp.js', tenant());

    const instance = JSON.parse(fs.readFileSync(path.join(dataDir, 'config', 'instance.json'), 'utf-8'));
    const secrets = JSON.parse(fs.readFileSync(path.join(dataDir, 'config', 'secrets.json'), 'utf-8'));

    expect(instance.mcps.linear.enabled).toBe(false);
    expect(instance.mcps['scribble-mcp'].env.SCRIBBLE_LINEAR_ENABLED).toBe('false');
    expect(secrets.LINEAR_API_TOKEN).toBeUndefined();
  });
});
