import { existsSync } from 'node:fs';
import path from 'node:path';

import { config as loadDotenv } from 'dotenv';

import { type Env, parseEnv } from './env.js';

/** The repo root is the nearest folder above `start` holding pnpm-workspace.yaml. */
export function findRepoRoot(start: string = process.cwd()): string | undefined {
  let dir = path.resolve(start);
  for (;;) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

let cached: Env | undefined;

/**
 * Load the root `.env` (if there is one) and validate it. Values already in
 * the process environment win, so CI and PM2 can override the file.
 */
export function loadEnv(start?: string): Env {
  if (cached) return cached;
  const root = findRepoRoot(start);
  if (root) {
    const file = path.join(root, '.env');
    if (existsSync(file)) loadDotenv({ path: file, override: false, quiet: true });
  }
  cached = parseEnv(process.env);
  return cached;
}
