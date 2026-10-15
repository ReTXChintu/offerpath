/* eslint-disable no-console -- a command-line tool: its output is the report */
/**
 * Copies Job Hunter's server data (MongoDB) into Offerpath (docs/plan.md,
 * section 9, steps 2 and 3):
 *
 *   _accounts                  -> users           (matched by email)
 *   every domain collection    -> sync_documents  (re-pointed to the new user id)
 *
 * Devices, pairing codes and refresh tokens are not copied: every device signs
 * in to Offerpath fresh.
 *
 * Safe to run again: users are matched by email and never overwritten,
 * documents are upserted (a newer copy already in Offerpath wins), and a
 * document deleted in Job Hunter since the last run is soft-deleted here.
 * Job Hunter is only read.
 *
 *   JOB_HUNTER_MONGODB_URI=...  JOB_HUNTER_MONGODB_DATABASE=...  \
 *   [FORGEROUTINE_DATABASE_URL=...]  pnpm db:import:job-hunter [--dry-run]
 *
 * DATABASE_URL (Offerpath) comes from the root .env.
 */
import { MongoClient } from 'mongodb';

import { Prisma, PrismaClient } from '@prisma/client';

import {
  type JobHunterAccount,
  normalizeEmail,
  resolveUser,
  type SyncRow,
  toSyncRow,
  type UserSeed,
} from './job-hunter-transform.js';

const BATCH = 500;

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set.`);
    process.exit(2);
  }
  return value;
}

function mask(email: string): string {
  return email.replace(/^(.).*(@.*)$/, '$1***$2');
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const mongo = new MongoClient(required('JOB_HUNTER_MONGODB_URI'), { appName: 'OfferpathImport' });
  const offerpath = new PrismaClient();
  const frUrl = process.env.FORGEROUTINE_DATABASE_URL;
  // ForgeRoutine's `users` table has the same columns, so the same client reads it.
  const forgeRoutine = frUrl ? new PrismaClient({ datasourceUrl: frUrl }) : undefined;
  const now = new Date();

  try {
    await mongo.connect();
    const source = mongo.db(required('JOB_HUNTER_MONGODB_DATABASE'));
    console.log(`Job Hunter -> Offerpath${dryRun ? ' (dry run: nothing is written)' : ''}`);

    // --- Users -------------------------------------------------------------
    const accounts = await source.collection<JobHunterAccount>('_accounts').find({}).toArray();
    const emails = accounts.map((a) => normalizeEmail(a.email));
    const existing = new Map(
      (
        await offerpath.user.findMany({
          where: { email: { in: emails } },
          select: { id: true, email: true },
        })
      ).map((u) => [u.email, u]),
    );
    const frUsers = new Map<string, UserSeed>(
      forgeRoutine
        ? (
            await forgeRoutine.user.findMany({
              where: { email: { in: emails, mode: 'insensitive' } },
              select: {
                id: true,
                email: true,
                passwordHash: true,
                displayName: true,
                createdAt: true,
              },
            })
          ).map((u) => [normalizeEmail(u.email), u])
        : [],
    );

    const userIdMap = new Map<string, string>();
    for (const account of accounts) {
      const email = normalizeEmail(account.email);
      const { seed, source: from } = resolveUser(account, existing.get(email), frUsers.get(email));
      userIdMap.set(account._id, seed.id);
      const action = from === 'offerpath' ? 'already in Offerpath' : `new, identity from ${from}`;
      console.log(`  user ${mask(email)} -> ${seed.id} (${action})`);
      if (!dryRun && from !== 'offerpath') {
        await offerpath.user.create({ data: seed });
      }
    }
    if (!forgeRoutine) {
      console.log('  (FORGEROUTINE_DATABASE_URL not set: accounts keep their Job Hunter ids)');
    }

    // --- Documents -----------------------------------------------------------
    const collections = (await source.listCollections({}, { nameOnly: true }).toArray())
      .map((c) => c.name)
      .filter((name) => !name.startsWith('_') && !name.startsWith('system.'))
      .sort();

    let total = 0;
    for (const collection of collections) {
      const raw = await source.collection(collection).find({}).toArray();
      const rows: SyncRow[] = [];
      let skipped = 0;
      for (const doc of raw) {
        const row = toSyncRow(collection, doc as Record<string, unknown>, userIdMap, now);
        if (row) rows.push(row);
        else skipped += 1;
      }
      if (!dryRun) {
        for (let i = 0; i < rows.length; i += BATCH)
          await upsert(offerpath, rows.slice(i, i + BATCH));
      }
      const removed = dryRun
        ? 0
        : await softDeleteMissing(offerpath, collection, rows, userIdMap, now);
      total += rows.length;
      console.log(
        `  ${collection.padEnd(22)} ${String(rows.length).padStart(6)} copied` +
          (skipped ? `, ${skipped} skipped (no owner or id)` : '') +
          (removed ? `, ${removed} marked deleted` : ''),
      );
    }
    console.log(`Done: ${accounts.length} account(s), ${total} document(s).`);
  } finally {
    await mongo.close();
    await offerpath.$disconnect();
    await forgeRoutine?.$disconnect();
  }
}

/** Insert or update a batch in one statement; an Offerpath copy that's newer is kept. */
async function upsert(db: PrismaClient, rows: SyncRow[]): Promise<void> {
  if (rows.length === 0) return;
  await db.$executeRaw`
    INSERT INTO "sync_documents" ("userId", "collection", "id", "doc", "updatedAt", "deletedAt")
    SELECT u, c, i, d::jsonb, t::timestamp(3), NULL
    FROM unnest(
      ${rows.map((r) => r.userId)}::text[],
      ${rows.map((r) => r.collection)}::text[],
      ${rows.map((r) => r.id)}::text[],
      ${rows.map((r) => JSON.stringify(r.doc))}::text[],
      ${rows.map((r) => r.updatedAt.toISOString())}::text[]
    ) AS src(u, c, i, d, t)
    ON CONFLICT ("userId", "collection", "id") DO UPDATE
      SET "doc" = EXCLUDED."doc", "updatedAt" = EXCLUDED."updatedAt", "deletedAt" = NULL
      WHERE "sync_documents"."updatedAt" <= EXCLUDED."updatedAt"`;
}

/** Soft-delete rows of the imported users that Job Hunter no longer has. */
async function softDeleteMissing(
  db: PrismaClient,
  collection: string,
  rows: SyncRow[],
  userIdMap: ReadonlyMap<string, string>,
  now: Date,
): Promise<number> {
  const userIds = [...new Set(userIdMap.values())];
  if (userIds.length === 0) return 0;
  const keep = rows.map((r) => `${r.userId}\u0001${r.id}`);
  return db.$executeRaw`
    UPDATE "sync_documents" SET "deletedAt" = ${now}
    WHERE "collection" = ${collection}
      AND "deletedAt" IS NULL
      AND "userId" = ANY(${userIds}::text[])
      AND ("userId" || chr(1) || "id") <> ALL(${keep}::text[])`;
}

main().catch((err: unknown) => {
  console.error(err instanceof Prisma.PrismaClientKnownRequestError ? err.message : err);
  process.exit(1);
});
