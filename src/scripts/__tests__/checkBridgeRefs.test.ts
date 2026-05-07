import { spawnSync, execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const scriptPath = path.join(repoRoot, 'scripts/check-bridge-refs.mjs');
const LOCKFILE_INTEGRITY = 'sha512-test-integrity';

interface BridgeRootOptions {
  lockfileIntegrity?: string;
  refsIntegrity?: string;
  botToolkitPath?: string;
  streamlinearPath?: string;
  botToolkitCommit?: string;
  streamlinearCommit?: string;
}

describe('check-bridge-refs', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scribble-bridge-refs-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('passes when missing checkouts are explicitly allowed', () => {
    const root = writeBridgeRoot();

    const result = runBridge(root, '--allow-missing-checkouts');

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('Skipping botToolkit SHA check');
    expect(result.stdout).toContain('missing checkout checks were explicitly allowed');
  });

  it('supports a lockfile-only mode for Docker build validation', () => {
    const root = writeBridgeRoot();
    fs.mkdirSync(path.join(root, 'bot-toolkit'), { recursive: true });

    const result = runBridge(root, '--lockfile-only');

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('checkout SHA checks were skipped by --lockfile-only');
  });

  it('fails lockfile-only mode when bridge refs integrity does not match the package lockfile', () => {
    const root = writeBridgeRoot({ refsIntegrity: 'sha512-stale-integrity' });

    const result = runBridge(root, '--lockfile-only');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('does not match package-lock.json');
  });

  it('fails when bridge refs integrity does not match the package lockfile', () => {
    const root = writeBridgeRoot({ refsIntegrity: 'sha512-stale-integrity' });

    const result = runBridge(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('does not match package-lock.json');
  });

  it('fails when required sibling checkouts are missing', () => {
    const root = writeBridgeRoot();

    const result = runBridge(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('botToolkit checkout not found at ./bot-toolkit');
  });

  it('explains existing non-git checkout paths', () => {
    const root = writeBridgeRoot();
    fs.mkdirSync(path.join(root, 'bot-toolkit'), { recursive: true });

    const result = runBridge(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('botToolkit checkout at ./bot-toolkit is not a git repository');
  });

  it('fails when a sibling checkout SHA does not match bridge refs', () => {
    const botToolkitCommit = createGitRepo(path.join(tempDir, 'scribble', 'bot-toolkit'));
    createGitRepo(path.join(tempDir, 'scribble', 'streamlinear'));
    const root = writeBridgeRoot({
      botToolkitCommit,
      streamlinearCommit: '0000000000000000000000000000000000000000',
    });

    const result = runBridge(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('streamlinear checkout at ./streamlinear is');
    expect(result.stderr).toContain('expected 0000000000000000000000000000000000000000');
  });

  it('explains missing repo-root path arguments', () => {
    const result = spawnSync(process.execPath, [scriptPath, '--repo-root', '--lockfile-only'], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--repo-root requires a path argument');
  });

  it('passes when lockfile integrity and sibling checkout SHAs match', () => {
    const botToolkitCommit = createGitRepo(path.join(tempDir, 'scribble', 'bot-toolkit'));
    const streamlinearCommit = createGitRepo(path.join(tempDir, 'scribble', 'streamlinear'));
    const root = writeBridgeRoot({ botToolkitCommit, streamlinearCommit });

    const result = runBridge(root);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('required sibling checkouts');
  });

  function writeBridgeRoot(options: BridgeRootOptions = {}): string {
    const root = path.join(tempDir, 'scribble');
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });

    writeJson(path.join(root, 'package-lock.json'), {
      packages: {
        'node_modules/@primeradiant/bot-toolkit': {
          integrity: options.lockfileIntegrity ?? LOCKFILE_INTEGRITY,
        },
      },
    });

    writeJson(path.join(root, 'docs/bridge-refs.json'), {
      botToolkit: {
        path: options.botToolkitPath ?? './bot-toolkit',
        commit: options.botToolkitCommit ?? '1111111111111111111111111111111111111111',
        packageName: '@primeradiant/bot-toolkit',
        packageVersion: '0.1.0',
        lockfileIntegrity: options.refsIntegrity ?? LOCKFILE_INTEGRITY,
      },
      streamlinear: {
        path: options.streamlinearPath ?? './streamlinear',
        commit: options.streamlinearCommit ?? '2222222222222222222222222222222222222222',
      },
    });

    return root;
  }

  function runBridge(root: string, ...args: string[]) {
    return spawnSync(process.execPath, [scriptPath, '--repo-root', root, ...args], {
      encoding: 'utf8',
    });
  }

  function createGitRepo(dir: string): string {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'README.md'), '# fixture\n');
    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['add', 'README.md'], { cwd: dir, stdio: 'ignore' });
    execFileSync(
      'git',
      ['-c', 'user.name=Scribble Test', '-c', 'user.email=scribble-test@example.com', 'commit', '-m', 'initial'],
      { cwd: dir, stdio: 'ignore' }
    );
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  }

  function writeJson(filePath: string, value: unknown): void {
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  }
});
