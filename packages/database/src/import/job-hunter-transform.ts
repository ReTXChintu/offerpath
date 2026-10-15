/**
 * Pure mapping from Job Hunter's MongoDB documents to Offerpath rows, kept
 * apart from the I/O so it can be tested. See `job-hunter.ts` for the run.
 */

/** A Job Hunter account (`_accounts` collection). */
export interface JobHunterAccount {
  _id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  createdAt: string;
}

/** The fields of an Offerpath `users` row the import decides. */
export interface UserSeed {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  createdAt: Date;
}

/** One `sync_documents` row. */
export interface SyncRow {
  userId: string;
  collection: string;
  id: string;
  doc: Record<string, unknown>;
  updatedAt: Date;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Which user a Job Hunter account becomes, in order of preference:
 * 1. a user already in Offerpath with that email (a re-run, or a ForgeRoutine
 *    user moved in earlier) is kept as it is;
 * 2. a ForgeRoutine user with that email: Offerpath keeps the ForgeRoutine
 *    identity (id, password, name), so moving ForgeRoutine's data later lands
 *    on the same user;
 * 3. otherwise the Job Hunter account itself, id and password hash unchanged.
 */
export function resolveUser(
  account: JobHunterAccount,
  existing: { id: string } | undefined,
  forgeRoutine: UserSeed | undefined,
): { seed: UserSeed; source: 'offerpath' | 'forgeroutine' | 'job-hunter' } {
  const email = normalizeEmail(account.email);
  if (existing) {
    return { seed: { ...fromAccount(account), id: existing.id, email }, source: 'offerpath' };
  }
  if (forgeRoutine) return { seed: { ...forgeRoutine, email }, source: 'forgeroutine' };
  return { seed: fromAccount(account), source: 'job-hunter' };
}

function fromAccount(account: JobHunterAccount): UserSeed {
  return {
    id: account._id,
    email: normalizeEmail(account.email),
    passwordHash: account.passwordHash,
    displayName: account.displayName,
    createdAt: parseTimestamp(account.createdAt) ?? new Date(),
  };
}

/**
 * Parses the timestamps Job Hunter writes. The Rust core writes nanosecond
 * precision ("2026-09-27T21:59:47.231250700Z"), which `Date` can't always
 * read, so the fraction is cut to milliseconds first.
 */
export function parseTimestamp(value: unknown): Date | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  if (typeof value !== 'string' || !value) return undefined;
  const trimmed = value.replace(/(\.\d{3})\d+/, '$1');
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Postgres `jsonb` rejects the NUL character, so drop it from every string. */
export function stripNul(value: unknown): unknown {
  if (typeof value === 'string')
    return value.includes('\u0000') ? value.replaceAll('\u0000', '') : value;
  if (Array.isArray(value)) return value.map(stripNul);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripNul(v)]));
  }
  return value;
}

/**
 * A Job Hunter domain document as an Offerpath row. Mongo's `_id` is
 * `<userId>:<id>`; the document's own `id` is what the desktop uses. The
 * stored document keeps every field, with `userId` pointing at the new user.
 * Returns undefined for a document that has no owner or id.
 */
export function toSyncRow(
  collection: string,
  raw: Record<string, unknown>,
  userIdMap: ReadonlyMap<string, string>,
  now: Date,
): SyncRow | undefined {
  const { _id, ...rest } = raw;
  const oldUserId = typeof rest.userId === 'string' ? rest.userId : undefined;
  const userId = oldUserId ? userIdMap.get(oldUserId) : undefined;
  if (!userId) return undefined;
  const scoped = typeof _id === 'string' ? _id : undefined;
  const id =
    typeof rest.id === 'string' && rest.id
      ? rest.id
      : scoped?.startsWith(`${oldUserId}:`)
        ? scoped.slice(oldUserId!.length + 1)
        : scoped;
  if (!id) return undefined;
  const updatedAt =
    parseTimestamp(rest.updatedAt) ??
    parseTimestamp(rest.createdAt) ??
    parseTimestamp(rest.at) ??
    parseTimestamp(rest.startedAt) ??
    now;
  const doc = stripNul({ ...rest, id, userId }) as Record<string, unknown>;
  return { userId, collection, id, doc, updatedAt };
}
