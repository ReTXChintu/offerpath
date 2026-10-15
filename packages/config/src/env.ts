import { z } from 'zod';

/**
 * The single place the server reads `process.env`.
 *
 * Parsed and validated once at boot, so a misconfigured deployment fails at
 * start with a readable message instead of deep inside a request later.
 * Every value comes from the one root `.env` (see `.env.example`).
 */

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((v) =>
    typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()),
  );

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  /** One port serves REST, the hub WebSocket, downloads, updates and the web app. */
  OFFERPATH_PORT: z.coerce.number().int().min(1).max(65_535).default(50010),
  OFFERPATH_HOST: z.string().default('0.0.0.0'),
  /** Open sign-up can be closed later without a release. */
  OFFERPATH_SIGNUP: z.enum(['open', 'closed']).default('open'),

  /** Neon, pooled. Optional until the API has a schema to talk to (phase 1). */
  DATABASE_URL: z.string().url().startsWith('postgres').optional().or(z.literal('')),
  /** Neon, direct: only `prisma migrate` uses it. */
  DIRECT_DATABASE_URL: z.string().url().optional().or(z.literal('')),

  /** The server's existing Redis, shared with other apps: always prefixed. */
  REDIS_URL: z.string().default('redis://localhost:6379'),
  REDIS_KEY_PREFIX: z.string().default('offerpath:'),
  REDIS_ENABLED: booleanish.default(false),
});

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(readonly issues: z.ZodIssue[]) {
    super(
      'Invalid environment configuration:\n' +
        issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n'),
    );
    this.name = 'EnvValidationError';
  }
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) throw new EnvValidationError(result.error.issues);
  return result.data;
}
