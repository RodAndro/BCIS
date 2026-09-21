import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, types } from 'pg';

import * as schema from './schema';

/**
 * PostgreSQL connection management.
 *
 * ── THE int8 PROBLEM ────────────────────────────────────────────────────────
 * node-postgres returns `BIGINT` (OID 20) as a STRING by default, because a
 * 64-bit integer can exceed JavaScript's safe range. Every money column in
 * this system is a `BIGINT` of centavos, so leaving the default in place would
 * mean `invoice.total_centavos` arrives as "99900" instead of 99900 — and
 * `"99900" + 100` would silently produce the string "99900100".
 *
 * We therefore parse int8 into a number, and that is only safe because of a
 * property of this application rather than of JavaScript:
 *
 *   MAX_CENTAVOS = 999,999,999,999  (about PHP 10 billion)
 *   Number.MAX_SAFE_INTEGER = 9,007,199,254,740,991
 *
 * There is roughly four orders of magnitude of headroom, and
 * `@bcis/shared` rejects any amount outside that range at construction. If a
 * future column ever needs true 64-bit integers, it must NOT use int8 — use
 * `numeric` or a text domain, and read it as a string.
 *
 * The parser is installed explicitly here rather than globally, so the
 * decision is visible in one place instead of being a side effect discovered
 * later.
 */

const POSTGRES_INT8_OID = 20;

types.setTypeParser(POSTGRES_INT8_OID, (value: string) => Number.parseInt(value, 10));

export type Database = NodePgDatabase<typeof schema>;

export interface CreatePoolOptions {
  readonly connectionString: string;
  readonly maxConnections?: number;
  /** Emits every SQL statement to stdout. Never enable in production. */
  readonly logQueries?: boolean;
}

/**
 * Pool sizing.
 *
 * Three desktop clients share one API process. Each request is short, but a
 * payment posting holds a transaction open across several statements, so the
 * pool must comfortably exceed the number of concurrent cashiers. Ten
 * connections is far more than three clients need and leaves room for
 * integration tests and the report generator running alongside them.
 */
const DEFAULT_MAX_CONNECTIONS = 10;

export function createPool(options: CreatePoolOptions): Pool {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? DEFAULT_MAX_CONNECTIONS,
    // Fail fast rather than hanging a cashier's screen when the database is down.
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    application_name: 'bcis-api',
  });

  // An idle client erroring (for example, the server restarted) must not take
  // the whole process down. The pool discards the client and reconnects.
  pool.on('error', (error) => {
    process.stderr.write(`[db] idle client error: ${error.message}\n`);
  });

  if (options.logQueries === true) {
    pool.on('connect', (client) => {
      const originalQuery = client.query.bind(client);
      client.query = ((...args: Parameters<typeof originalQuery>) => {
        process.stdout.write(`[sql] ${String(args[0])}\n`);
        return originalQuery(...args);
      }) as typeof client.query;
    });
  }

  return pool;
}

export function createDatabase(pool: Pool): Database {
  return drizzle(pool, { schema, logger: false });
}

export interface DatabaseHealth {
  readonly connected: boolean;
  readonly latencyMs: number;
  readonly serverVersion: string | null;
  readonly error: string | null;
}

/**
 * Liveness probe for the database.
 *
 * Deliberately runs the cheapest possible statement. A health endpoint that
 * runs a heavy query becomes a denial-of-service vector when a monitoring tool
 * polls it aggressively.
 */
export async function checkDatabaseHealth(pool: Pool): Promise<DatabaseHealth> {
  const startedAt = process.hrtime.bigint();

  try {
    const result = await pool.query<{ version: string }>('SELECT version() AS version');

    return {
      connected: true,
      latencyMs: elapsedMs(startedAt),
      serverVersion: result.rows[0]?.version ?? null,
      error: null,
    };
  } catch (error) {
    return {
      connected: false,
      latencyMs: elapsedMs(startedAt),
      serverVersion: null,
      error: error instanceof Error ? error.message : 'Unknown database error',
    };
  }
}

function elapsedMs(startedAt: bigint): number {
  const nanoseconds = process.hrtime.bigint() - startedAt;
  // Sub-millisecond precision, rounded to one decimal place for reporting.
  return Math.round(Number(nanoseconds / 1_000n) / 10) / 100;
}
