/* eslint-disable no-console -- a command-line tool: its output is the report */
/**
 * Copies ForgeRoutine's database into Offerpath's (docs/plan.md, section 9,
 * step 1). ForgeRoutine's models moved into Offerpath unchanged, so this is a
 * table-by-table copy:
 *
 * - every table both schemas have, in foreign-key order, only the columns
 *   both have (ForgeRoutine's vendor-key and agent tables, and its AI vendor
 *   preference columns, are left behind; Offerpath's new columns get their
 *   defaults);
 * - `users` by id: an account the Job Hunter import already created with its
 *   ForgeRoutine id is the same row. A ForgeRoutine user whose email belongs
 *   to a *different* Offerpath user is skipped, with their rows, and reported;
 * - existing rows are left as they are (`ON CONFLICT DO NOTHING`), so the
 *   copy can be re-run, e.g. once more just before the cutover.
 *
 * ForgeRoutine's database is only read.
 *
 *   FORGEROUTINE_DATABASE_URL=... pnpm db:import:forge-routine [--dry-run]
 *
 * DATABASE_URL (Offerpath) comes from the root .env.
 */
import { PrismaClient } from '@prisma/client';

/** ForgeRoutine tables Offerpath does not have, on purpose. */
const LEFT_BEHIND = new Set([
  'ai_credentials',
  'agent_devices',
  'agent_pairings',
  '_prisma_migrations',
]);
const BATCH = 500;
/** Throwaway accounts from test suites: `someone@anything.test`. */
const TEST_EMAIL = /@[^@]+\.test$/i;

interface Column {
  table: string;
  column: string;
}

async function tables(db: PrismaClient): Promise<string[]> {
  const rows = await db.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;
  return rows.map((r) => r.table_name);
}

async function columns(db: PrismaClient): Promise<Map<string, string[]>> {
  const rows = await db.$queryRaw<Column[]>`
    SELECT table_name AS "table", column_name AS "column" FROM information_schema.columns
    WHERE table_schema = 'public' ORDER BY ordinal_position`;
  const map = new Map<string, string[]>();
  for (const { table, column } of rows) map.set(table, [...(map.get(table) ?? []), column]);
  return map;
}

/** Tables ordered so every table comes after the tables it references. */
async function foreignKeyOrder(db: PrismaClient, names: string[]): Promise<string[]> {
  const edges = await db.$queryRaw<{ child: string; parent: string }[]>`
    SELECT tc.table_name AS child, ccu.table_name AS parent
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`;
  const deps = new Map(names.map((n) => [n, new Set<string>()]));
  for (const { child, parent } of edges) {
    if (child !== parent && deps.has(child) && deps.has(parent)) deps.get(child)!.add(parent);
  }
  const ordered: string[] = [];
  const done = new Set<string>();
  const visit = (name: string, path: Set<string>) => {
    if (done.has(name)) return;
    if (path.has(name)) throw new Error(`foreign-key cycle through ${name}`);
    path.add(name);
    for (const parent of deps.get(name) ?? []) visit(parent, path);
    path.delete(name);
    done.add(name);
    ordered.push(name);
  };
  for (const name of [...names].sort()) visit(name, new Set());
  return ordered;
}

const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const frUrl = process.env.FORGEROUTINE_DATABASE_URL;
  if (!frUrl) {
    console.error('FORGEROUTINE_DATABASE_URL is not set.');
    process.exit(2);
  }
  const fr = new PrismaClient({ datasourceUrl: frUrl });
  const op = new PrismaClient();

  try {
    console.log(`ForgeRoutine -> Offerpath${dryRun ? ' (dry run: nothing is written)' : ''}`);
    const [frTables, opTables, frColumns, opColumns] = await Promise.all([
      tables(fr),
      tables(op),
      columns(fr),
      columns(op),
    ]);
    const shared = frTables.filter((t) => opTables.includes(t) && !LEFT_BEHIND.has(t));
    const skippedTables = frTables.filter((t) => !shared.includes(t));
    const order = await foreignKeyOrder(op, shared);

    // Users whose email is already taken by a different Offerpath user.
    const frUsers = await fr.$queryRaw<
      { id: string; email: string }[]
    >`SELECT id, email FROM users`;
    const opUsers = await op.$queryRaw<
      { id: string; email: string }[]
    >`SELECT id, email FROM users`;
    const opByEmail = new Map(opUsers.map((u) => [u.email.toLowerCase(), u.id]));
    const blocked = new Set(
      frUsers
        .filter((u) => {
          const existing = opByEmail.get(u.email.toLowerCase());
          return existing !== undefined && existing !== u.id;
        })
        .map((u) => u.id),
    );
    for (const id of blocked) {
      console.log(`  ! user ${id}: email already belongs to another Offerpath account; skipped`);
    }
    // ForgeRoutine's e2e suites once ran against its live database and left
    // their throwaway accounts behind; they are not people.
    const testAccounts = frUsers.filter((u) => TEST_EMAIL.test(u.email));
    for (const u of testAccounts) blocked.add(u.id);
    if (testAccounts.length) {
      console.log(
        `  - ${testAccounts.length} test account(s) (@*.test) left behind, with their rows`,
      );
    }

    let total = 0;
    for (const table of order) {
      const cols = (frColumns.get(table) ?? []).filter((c) =>
        (opColumns.get(table) ?? []).includes(c),
      );
      if (cols.length === 0) continue;
      const hasUser = cols.includes('userId');
      const rows = await fr.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT row_to_json(t) AS r FROM (SELECT ${cols.map(quote).join(', ')} FROM ${quote(table)}) t`,
      );
      const records = rows
        .map((row) => row.r as Record<string, unknown>)
        .filter((r) =>
          table === 'users'
            ? !blocked.has(r.id as string)
            : !(hasUser && blocked.has(r.userId as string)),
        );

      let inserted = 0;
      if (!dryRun) {
        for (let i = 0; i < records.length; i += BATCH) {
          const batch = records.slice(i, i + BATCH);
          inserted += await op.$executeRawUnsafe(
            `INSERT INTO ${quote(table)} (${cols.map(quote).join(', ')})
             SELECT ${cols.map(quote).join(', ')} FROM json_populate_recordset(null::${quote(table)}, $1::json)
             ON CONFLICT DO NOTHING`,
            JSON.stringify(batch),
          );
        }
      }
      total += records.length;
      const dropped = (frColumns.get(table) ?? []).filter((c) => !cols.includes(c));
      console.log(
        `  ${table.padEnd(28)} ${String(records.length).padStart(6)} rows` +
          (dryRun ? '' : `, ${inserted} new`) +
          (dropped.length ? `  (left behind: ${dropped.join(', ')})` : ''),
      );
    }
    if (skippedTables.length) console.log(`  tables left behind: ${skippedTables.join(', ')}`);
    console.log(`Done: ${order.length} tables, ${total} rows read.`);
  } finally {
    await fr.$disconnect();
    await op.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
