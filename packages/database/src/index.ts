import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';

export interface PrismaClientOptions {
  databaseUrl?: string;
  logQueries?: boolean;
}

const globalForPrisma = globalThis as unknown as { __offerpathPrisma?: PrismaClient };

export function createPrismaClient(options: PrismaClientOptions = {}): PrismaClient {
  return new PrismaClient({
    log: options.logQueries ? ['query', 'warn', 'error'] : ['warn', 'error'],
    ...(options.databaseUrl ? { datasources: { db: { url: options.databaseUrl } } } : {}),
  });
}

/**
 * Process-wide client. Outside production it is kept on `globalThis`, so a
 * hot reload doesn't open a new connection pool each time.
 */
export function getPrismaClient(options: PrismaClientOptions = {}): PrismaClient {
  if (process.env.NODE_ENV === 'production') return createPrismaClient(options);
  globalForPrisma.__offerpathPrisma ??= createPrismaClient(options);
  return globalForPrisma.__offerpathPrisma;
}

/**
 * Neon's free tier sleeps when idle and the first connection after a pause
 * takes a few seconds, so retry with backoff instead of failing.
 */
export async function checkDatabaseConnection(
  client: PrismaClient,
  { attempts = 5, delayMs = 1_000 }: { attempts?: number; delayMs?: number } = {},
): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    try {
      await client.$queryRaw`SELECT 1`;
      return true;
    } catch {
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs * 2 ** i));
    }
  }
  return false;
}
