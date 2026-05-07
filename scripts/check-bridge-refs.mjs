#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function hasFlag(args, flag) {
  return args.includes(flag);
}

function optionValue(args, name) {
  const inline = args.find(arg => arg.startsWith(`${name}=`));
  if (inline) {
    const value = inline.slice(name.length + 1);
    if (!value || value.startsWith('--')) {
      throw new Error(`${name} requires a path argument`);
    }
    return value;
  }
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a path argument`);
  }
  return value;
}

function main(args) {
  const repoRoot = resolve(
    optionValue(args, '--repo-root') ?? resolve(dirname(fileURLToPath(import.meta.url)), '..')
  );
  const allowMissingCheckouts = hasFlag(args, '--allow-missing-checkouts');
  const refs = JSON.parse(readFileSync(join(repoRoot, 'docs/bridge-refs.json'), 'utf8'));

  const entry = refs.streamlinear;
  if (!entry?.path || !entry?.commit) {
    throw new Error('docs/bridge-refs.json must include streamlinear.path and streamlinear.commit');
  }

  const checkoutPath = resolve(repoRoot, entry.path);
  if (!existsSync(checkoutPath)) {
    const message = `streamlinear checkout not found at ${entry.path}`;
    if (!allowMissingCheckouts) {
      throw new Error(`${message}. Create the required sibling checkout at the documented bridge path, or rerun with --allow-missing-checkouts to verify only available checkouts.`);
    }
    console.warn(`Skipping streamlinear SHA check; ${message}. Docker bridge smoke remains required before release.`);
  } else {
    let actual;
    try {
      actual = execFileSync('git', ['-C', checkoutPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    } catch (error) {
      throw new Error(`streamlinear checkout at ${entry.path} is not a git repository, or git rev-parse failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (actual !== entry.commit) {
      throw new Error(`streamlinear checkout at ${entry.path} is ${actual}, expected ${entry.commit}`);
    }
  }

  console.log(
    allowMissingCheckouts
      ? 'Bridge refs match available sibling checkouts; missing checkout checks were explicitly allowed'
      : 'Bridge refs match required sibling checkouts'
  );
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
