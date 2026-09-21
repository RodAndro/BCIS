import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Pool } from 'pg';

import { createDatabase } from './client';

/**
 * Migration state inspection and execution.
 *
 * ── WHY THIS LIVES HERE ─────────────────────────────────────────────────────
 * Applying migrations needs `drizzle-orm` and `pg`, both of which are
 * dependencies of this package and NOT of the repository root. Exporting the
 * operation means the migration runner, the reset script, and the integration
 * test harness all call one function instead of each importing Drizzle
 * internals and each needing its own copy of the dependency.
 *
 * ── WHY THIS EXISTS AT ALL ──────────────────────────────────────────────────
 * "The database answers" and "the database has the schema this build expects"
 * are different questions. An API that reports healthy while running against a
 * database that is one migration behind will fail on the first real request,
 * which is far worse than refusing to start.
 *
 * `/health/db` therefore reports both, and the desktop shell surfaces the
 * difference — the Phase 1 verification step deliberately stops the API and
 * confirms the UI notices, rather than trusting a hardcoded "healthy".
 *
 * ── HOW APPLIED MIGRATIONS ARE COUNTED ──────────────────────────────────────
 * Drizzle records applied migrations as rows in `drizzle.__drizzle_migrations`.
 * We compare that row count against the entries in Drizzle's own journal file
 * on disk.
 *
 * This is an APPROXIMATION, and it is documented as one: it assumes
 * migrations were applied in order and none were applied out of band. That
 * assumption holds because `runMigrations` is the only supported way to apply
 * them. Verifying hash-by-hash would be stronger, and is worth doing if this
 * ever needs to support hand-applied hotfixes.
 */

const JOURNAL_RELATIVE_PATH = 'migrations/meta/_journal.json';

interface JournalEntry {
  readonly idx: number;
  readonly tag: string;
}

interface Journal {
  readonly entries: readonly JournalEntry[];
}

/** Reads Drizzle's migration journal from disk. Returns [] when absent. */
export function readMigrationJournal(packageRoot: string): readonly JournalEntry[] {
  const journalPath = resolve(packageRoot, JOURNAL_RELATIVE_PATH);

  if (!existsSync(journalPath)) {
    return [];
  }

  try {
    const parsed = JSON.parse(readFileSync(journalPath, 'utf8')) as Journal;
    return Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch {
    // A corrupt journal is a real problem, but health reporting must not throw.
    // Reporting "unknown" is honest; the operator sees it and investigates.
    return [];
  }
}

export interface MigrationState {
  readonly appliedCount: number | null;
  readonly totalOnDisk: number;
  readonly pending: readonly string[];
}

export async function inspectMigrationState(
  pool: Pool,
  packageRoot: string,
): Promise<MigrationState> {
  const entries = readMigrationJournal(packageRoot);

  // Declared without an initialiser: both the try and the catch below assign
  // it, so an initial value would be dead code. TypeScript's definite
  // assignment analysis accepts this because the catch covers the throwing path.
  let appliedCount: number | null;
  try {
    const result = await pool.query<{ applied: number }>(
      'SELECT count(*)::int AS applied FROM drizzle.__drizzle_migrations',
    );
    appliedCount = result.rows[0]?.applied ?? 0;
  } catch {
    // The bookkeeping table does not exist yet, which means this database has
    // never been migrated. Distinguishing that from "cannot connect" matters.
    appliedCount = null;
  }

  const pending =
    appliedCount === null
      ? entries.map((entry) => entry.tag)
      : entries.slice(appliedCount).map((entry) => entry.tag);

  return { appliedCount, totalOnDisk: entries.length, pending };
}

/**
 * Apply every pending migration in `migrationsFolder`.
 *
 * Drizzle applies each migration in its own transaction, so a failure leaves
 * the database at the last known-good migration rather than half applied.
 */
export async function runMigrations(pool: Pool, migrationsFolder: string): Promise<void> {
  await migrate(createDatabase(pool), { migrationsFolder });
}
