import { existsSync } from 'node:fs';
import path from 'node:path';

import { config as loadDotenv } from 'dotenv';

import { type Env, envSchema } from './env.js';

export class ConfigurationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'ConfigurationError';
  }
}

export interface AppConfig {
  env: Env;
  isDevelopment: boolean;
  isProduction: boolean;
  isTest: boolean;
  corsOrigins: string[];
  /** The repo root: relative paths in the .env (DOWNLOADS_DIR) are relative to it. */
  repoRoot: string;
  databaseUrlForMigrations: string;
}

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

/** Validates an environment without touching `process.env` or the disk. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigurationError(
      parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  return parsed.data;
}

let cached: AppConfig | null = null;

/**
 * Loads the root `.env` (values already in the process environment win, so
 * CI and PM2 can override it) and validates it, once per process.
 */
export function loadConfig(options: { reload?: boolean; cwd?: string } = {}): AppConfig {
  if (cached && !options.reload) return cached;

  const repoRoot = findRepoRoot(options.cwd ?? process.cwd()) ?? process.cwd();
  const envFile = path.join(repoRoot, '.env');
  if (existsSync(envFile)) loadDotenv({ path: envFile, override: false, quiet: true });

  const env = parseEnv(process.env);
  cached = {
    env,
    isDevelopment: env.NODE_ENV === 'development',
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    corsOrigins: env.OFFERPATH_CORS_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    repoRoot,
    databaseUrlForMigrations: env.DIRECT_DATABASE_URL || env.DATABASE_URL,
  };
  return cached;
}

/** Test helper. Never call this from application code. */
export function resetConfigCache(): void {
  cached = null;
}
