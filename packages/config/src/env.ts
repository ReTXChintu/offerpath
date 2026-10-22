import { z } from 'zod';

/**
 * The single place `process.env` is read.
 *
 * Parsed and validated once at boot, so a misconfigured deployment fails at
 * start with a readable message instead of deep inside a request later.
 * Every value comes from the one root `.env` (see `.env.example`).
 *
 * There is no AI configuration beyond timeouts: Claude runs on each user's
 * own desktop, so the server holds no key and calls no vendor.
 */

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((v) =>
    typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()),
  );

const durationString = z.string().regex(/^\d+[smhd]$/, 'Expected a duration like 15m, 24h, 30d');

/** Asked of the runtime rather than matched against a list that would go stale. */
function isKnownTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

    /** The API: REST, the hub WebSocket, downloads and updates. */
    OFFERPATH_API_PORT: z.coerce.number().int().min(1).max(65_535).default(50005),
    /** The built web app, served as static files by PM2 (offerpath-web). */
    OFFERPATH_WEB_PORT: z.coerce.number().int().min(1).max(65_535).default(50004),
    OFFERPATH_HOST: z.string().default('0.0.0.0'),
    /** Browser origins allowed to call the API, comma-separated (the web app's address). */
    OFFERPATH_CORS_ORIGINS: z.string().default('http://localhost:50004'),
    /** Open sign-up can be closed later without a release. */
    OFFERPATH_SIGNUP: z.enum(['open', 'closed']).default('open'),
    /** REST lives under `/<prefix>/v1`. */
    API_GLOBAL_PREFIX: z.string().default('api'),

    /**
     * The zone every "today" is measured in, an IANA name like Asia/Kolkata.
     * Explicit because the server is usually UTC and the user is not.
     */
    APP_TIMEZONE: z
      .string()
      .default(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')
      .refine(isKnownTimeZone, 'APP_TIMEZONE must be an IANA zone name, e.g. Asia/Kolkata'),

    /** Neon, pooled. */
    DATABASE_URL: z.string().url().startsWith('postgres'),
    /** Neon, direct: only `prisma migrate` uses it. */
    DIRECT_DATABASE_URL: z.string().url().optional().or(z.literal('')),

    /** The server's existing Redis, shared with other apps: always prefixed. */
    REDIS_URL: z.string().default('redis://localhost:6379'),
    REDIS_KEY_PREFIX: z.string().default('offerpath:'),
    REDIS_ENABLED: booleanish.default(false),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
    JWT_ACCESS_TTL: durationString.default('15m'),
    JWT_REFRESH_TTL: durationString.default('30d'),
    BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

    /** How long the desktop gets for one AI job before the request gives up. */
    AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(180_000),
    /**
     * Tokens one user's learning AI may use per day before hints and grading
     * fall back to their non-AI versions. It protects the user's own Claude
     * plan limits, which the job hunt shares. 0 means no limit.
     */
    AI_DAILY_TOKEN_BUDGET: z.coerce.number().int().min(0).default(0),
    /**
     * Encrypts the OpenAI fallback keys users save in Settings (AES-256-GCM).
     * Without it the fallback can't be saved; Claude on the desktop still works.
     * Changing it makes every saved key unreadable. `openssl rand -base64 32`.
     */
    ENCRYPTION_KEY: z.string().default(''),
    /** OpenAI models the fallback uses when a user hasn't picked their own. */
    OPENAI_FALLBACK_MODEL_FAST: z.string().default('gpt-4.1-mini'),
    OPENAI_FALLBACK_MODEL_REASONING: z.string().default('gpt-4.1'),
    /** Live practice: the Realtime model, and its captions' speech to text. */
    OPENAI_REALTIME_MODEL: z.string().default('gpt-realtime-2.1'),
    OPENAI_TRANSCRIBE_MODEL: z.string().default('gpt-transcribe'),

    /** A phone's pairing code, shown on the desktop as a QR code, lives this long. */
    PAIRING_CODE_TTL_SECS: z.coerce.number().int().min(30).max(3_600).default(300),
    /**
     * Firebase service account (JSON, base64 JSON or a file path) for push
     * notifications to phones. Unset: no push, phones poll instead.
     */
    FCM_SERVICE_ACCOUNT: z.string().optional(),
    /** App builds served at /downloads (APK, Windows installer, updater manifest). */
    DOWNLOADS_DIR: z.string().default('apps/api/downloads'),

    EXECUTION_DRIVER: z.enum(['inline', 'queue']).default('inline'),
    EXECUTION_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(5_000),
    EXECUTION_MAX_MEMORY_MB: z.coerce.number().int().min(32).max(2_048).default(128),
    EXECUTION_MAX_OUTPUT_BYTES: z.coerce.number().int().min(1_024).max(1_048_576).default(65_536),
    EXECUTION_WORK_DIR: z.string().default('.sandbox-runs'),
    EXECUTION_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),
  })
  .superRefine((env, ctx) => {
    if (env.EXECUTION_DRIVER === 'queue' && !env.REDIS_ENABLED) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['REDIS_ENABLED'],
        message: 'The queue execution driver requires Redis',
      });
    }
    if (env.NODE_ENV !== 'production') return;

    for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
      if (env[key].includes('change-me')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: 'Default JWT secret must not be used in production',
        });
      }
    }
    if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message: 'Access and refresh secrets must differ',
      });
    }
    // Sandboxes run beside the API with the inline driver; keep the worst case sane.
    if (
      env.EXECUTION_DRIVER === 'inline' &&
      env.EXECUTION_CONCURRENCY * env.EXECUTION_MAX_MEMORY_MB > 1_024
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EXECUTION_CONCURRENCY'],
        message:
          'EXECUTION_CONCURRENCY × EXECUTION_MAX_MEMORY_MB exceeds 1024MB beside the API. ' +
          'Lower one of them, or use the queue driver and run apps/sandbox on its own.',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;
