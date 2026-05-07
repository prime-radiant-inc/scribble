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
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function main(args) {
  const repoRoot = resolve(
    optionValue(args, '--repo-root') ?? resolve(dirname(fileURLToPath(import.meta.url)), '..')
  );
  const allowMissingCheckouts = hasFlag(args, '--allow-missing-checkouts');
  const lockfileOnly = hasFlag(args, '--lockfile-only');
  const refs = JSON.parse(readFileSync(join(repoRoot, 'docs/bridge-refs.json'), 'utf8'));
  const lockfile = JSON.parse(readFileSync(join(repoRoot, 'package-lock.json'), 'utf8'));
  const botToolkit = lockfile.packages?.['node_modules/@primeradiant/bot-toolkit'];

  if (!botToolkit?.integrity) {
    throw new Error('Missing @primeradiant/bot-toolkit integrity in package-lock.json');
  }

  if (botToolkit.integrity !== refs.botToolkit.lockfileIntegrity) {
    throw new Error(`docs/bridge-refs.json botToolkit.lockfileIntegrity does not match package-lock.json: ${refs.botToolkit.lockfileIntegrity} !== ${botToolkit.integrity}`);
  }

  if (lockfileOnly) {
    console.log('Bridge refs match package-lock.json; checkout SHA checks were skipped by --lockfile-only');
    return;
  }

  for (const [name, entry] of Object.entries({ botToolkit: refs.botToolkit, streamlinear: refs.streamlinear })) {
    const checkoutPath = resolve(repoRoot, entry.path);
    if (!existsSync(checkoutPath)) {
      const message = `${name} checkout not found at ${entry.path}`;
      if (!allowMissingCheckouts) {
        throw new Error(`${message}. Create the sibling checkout at the documented bridge path, rerun with --lockfile-only for a lockfile-only check, or rerun with --allow-missing-checkouts to verify only available checkouts.`);
      }
      console.warn(`Skipping ${name} SHA check; ${message}. Docker bridge smoke remains required before release.`);
      continue;
    }

    let actual;
    try {
      actual = execFileSync('git', ['-C', checkoutPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    } catch (error) {
      throw new Error(`${name} checkout at ${entry.path} is not a git repository, or git rev-parse failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (actual !== entry.commit) {
      throw new Error(`${name} checkout at ${entry.path} is ${actual}, expected ${entry.commit}`);
    }
  }

  console.log(
    allowMissingCheckouts
      ? 'Bridge refs match package-lock.json and available sibling checkouts; missing checkout checks were explicitly allowed'
      : 'Bridge refs match package-lock.json and required sibling checkouts'
  );
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
