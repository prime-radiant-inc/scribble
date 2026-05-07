#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const allowMissingCheckouts = process.argv.includes('--allow-missing-checkouts');
const refs = JSON.parse(readFileSync(join(repoRoot, 'docs/bridge-refs.json'), 'utf8'));
const lockfile = JSON.parse(readFileSync(join(repoRoot, 'package-lock.json'), 'utf8'));
const botToolkit = lockfile.packages?.['node_modules/@primeradiant/bot-toolkit'];

if (!botToolkit?.integrity) {
  throw new Error('Missing @primeradiant/bot-toolkit integrity in package-lock.json');
}

if (botToolkit.integrity !== refs.botToolkit.lockfileIntegrity) {
  throw new Error(`docs/bridge-refs.json botToolkit.lockfileIntegrity does not match package-lock.json: ${refs.botToolkit.lockfileIntegrity} !== ${botToolkit.integrity}`);
}

for (const [name, entry] of Object.entries({ botToolkit: refs.botToolkit, streamlinear: refs.streamlinear })) {
  const checkoutPath = resolve(repoRoot, entry.path);
  if (!existsSync(checkoutPath)) {
    const message = `${name} checkout not found at ${entry.path}`;
    if (!allowMissingCheckouts) {
      throw new Error(`${message}. Create the sibling checkout at the documented bridge path, or rerun with --allow-missing-checkouts for a lockfile-only check.`);
    }
    console.warn(`Skipping ${name} SHA check; ${message}. Docker bridge smoke remains required before release.`);
    continue;
  }

  const actual = execFileSync('git', ['-C', checkoutPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (actual !== entry.commit) {
    throw new Error(`${name} checkout at ${entry.path} is ${actual}, expected ${entry.commit}`);
  }
}

console.log(
  allowMissingCheckouts
    ? 'Bridge refs match package-lock.json and available sibling checkouts; missing checkout checks were explicitly allowed'
    : 'Bridge refs match package-lock.json and required sibling checkouts'
);
