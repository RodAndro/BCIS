import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { createPool, runMigrations } from '@bcis/database';

/**
 * Migration runner.
 *
 * Invoked by `pnpm db:migrate`. Migrations are plain SQL files committed to
 * the repository, applied in order inside a transaction each, so a failure
 * leaves the database at the last known-good migration rather than half
 * applied.
 *
 * This is the ONLY supported way to change the schema. Nobody edits a table by
 * hand in psql, because then the migration history and the real database
 * disagree and a fresh deploy no longer reproduces what the developer has.
 */

const packageRoot = resolve(import.meta.dirname, '..');
const rootEnvPath = resolve(packageRoot, '..', '.env');

if (existsSync(rootEnvPath)) {
  process.loadEnvFile(rootEnvPath);
}

const connectionString = process.env.DATABASE_URL;

if (connectionString === undefined || connectionString.length === 0) {
  process.stderr.write(
    'DATABASE_URL is not set.\n' +
      'Start the local cluster with `pnpm pg:start`, then copy .env.example to .env.\n',
  );
  process.exit(1);
}

const pool = createPool({ connectionString });

try {
  process.stdout.write('Applying migrations...\n');
  await runMigrations(pool, resolve(packageRoot, 'migrations'));
  process.stdout.write('Migrations applied.\n');
} catch (error) {
  process.stderr.write(
    `Migration failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
} finally {
  // Always release the pool, otherwise the process hangs on an open handle and
  // the failure looks like a hang rather than an error.
  await pool.end();
}
