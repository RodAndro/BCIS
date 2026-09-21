import { resolve } from 'node:path';

import { createPool, runMigrations } from '@bcis/database';

/**
 * Integration test database harness.
 *
 * ── WHY THESE TESTS USE A REAL DATABASE ─────────────────────────────────────
 * The most important guarantees in this system are enforced by PostgreSQL, not
 * by application code:
 *   - AT-11 duplicate billing is a unique partial index
 *   - receipt numbering is a row lock
 *   - audit log immutability is a trigger
 * A mocked database would let all of these pass while being absent from the
 * real schema. The entire value of the test is that it runs against the same
 * engine the office uses.
 *
 * ── WHY THE POOL TYPE IS DERIVED, NOT IMPORTED FROM `pg` ────────────────────
 * `pg` is a dependency of `@bcis/database`, not of the repository root. In a
 * strictly isolated workspace the test files cannot resolve it, and they
 * should not need to: `@bcis/database` owns both migrations and pool creation,
 * so nothing outside it should touch the driver.
 */

type Pool = ReturnType<typeof createPool>;

const migrationsFolder = resolve(import.meta.dirname, '../../../database/migrations');

export interface TestDatabase {
  readonly pool: Pool;
  /** Drop every object and reapply migrations. Call when a test needs a clean schema. */
  readonly reset: () => Promise<void>;
  readonly close: () => Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const connectionString = process.env.DATABASE_URL;

  if (connectionString === undefined || connectionString.length === 0) {
    throw new Error('DATABASE_URL was not set by the integration test setup file.');
  }

  const pool = createPool({ connectionString, maxConnections: 4 });

  const reset = async (): Promise<void> => {
    // Rebuilding from migrations rather than truncating tables means each test
    // starts from exactly the schema a fresh deployment would produce, so a
    // migration that is broken in isolation fails here rather than in Phase 9.
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await pool.query('CREATE SCHEMA public');
    await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
    await runMigrations(pool, migrationsFolder);
  };

  await runMigrations(pool, migrationsFolder);

  return {
    pool,
    reset,
    close: async () => {
      await pool.end();
    },
  };
}
