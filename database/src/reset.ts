import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { createPool, runMigrations } from '@bcis/database';

/**
 * Rebuild the development database from migrations alone.
 *
 * This is the proof that migrations — not a hand-edited database — are the
 * source of schema truth. If `db:reset` produces a working schema, then a
 * fresh deployment on another machine will too.
 *
 * ── SAFETY ──────────────────────────────────────────────────────────────────
 * This DESTROYS all data in the target database. It refuses to run against
 * NODE_ENV=production, and it refuses to run when the connection string looks
 * like a remote host. A student demoing the system must not be able to
 * accidentally wipe the office database with a mistyped command.
 *
 * It drops and recreates the `public` and `drizzle` schemas rather than
 * dropping the database, because dropping a database requires connecting to a
 * different one and a privilege level the application role deliberately does
 * not have.
 */

const packageRoot = resolve(import.meta.dirname, '..');
const rootEnvPath = resolve(packageRoot, '..', '.env');

if (existsSync(rootEnvPath)) {
  process.loadEnvFile(rootEnvPath);
}

if (process.env.NODE_ENV === 'production') {
  process.stderr.write('Refusing to reset the database with NODE_ENV=production.\n');
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;

if (connectionString === undefined || connectionString.length === 0) {
  process.stderr.write('DATABASE_URL is not set.\n');
  process.exit(1);
}

if (!isLocalConnection(connectionString)) {
  process.stderr.write(
    'Refusing to reset a non-local database.\n' +
      `DATABASE_URL points at ${describeHost(connectionString)}.\n` +
      'This command destroys all data. Run it only against 127.0.0.1 or localhost.\n',
  );
  process.exit(1);
}

function isLocalConnection(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '::1';
  } catch {
    return false;
  }
}

function describeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'an unparseable host';
  }
}

const pool = createPool({ connectionString });

try {
  process.stdout.write('Dropping schemas public and drizzle...\n');
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
  await pool.query('CREATE SCHEMA public');
  await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE');

  process.stdout.write('Reapplying migrations...\n');
  await runMigrations(pool, resolve(packageRoot, 'migrations'));

  process.stdout.write('Database reset complete.\n');
} catch (error) {
  process.stderr.write(`Reset failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
