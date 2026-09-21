import fp from 'fastify-plugin';

import { checkDatabaseHealth, createDatabase, createPool, type Database } from '@bcis/database';

import { env } from '../config/env';

/**
 * Registers the PostgreSQL pool and Drizzle instance on the Fastify server.
 *
 * ── WHY A PLUGIN AND NOT A MODULE SINGLETON ─────────────────────────────────
 * A module-level pool is created at import time, which means tests share one
 * pool across files, cannot point at a test database, and leak handles that
 * keep the process alive after the suite finishes. Attaching the pool to the
 * server instance ties its lifetime to the server's, so building an app and
 * closing it leaves nothing behind.
 *
 * `fastify-plugin` is required here: without it, Fastify would scope the
 * decorators to this plugin's encapsulation context and the routes registered
 * afterwards could not see `app.db`.
 */

/**
 * The pool type is derived from `createPool` rather than imported from `pg`.
 *
 * That keeps `pg` an implementation detail of `@bcis/database`. Importing it
 * here would also mean the API needs its own `@types/pg`, and would invite
 * future API code to build queries against the pool directly, bypassing
 * Drizzle and the repository layer.
 */
type Pool = ReturnType<typeof createPool>;

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
    pool: Pool;
  }
}

export default fp(
  async (app) => {
    const pool = createPool({
      connectionString: env.DATABASE_URL,
      logQueries: env.DB_LOG_QUERIES,
    });

    app.decorate('pool', pool);
    app.decorate('db', createDatabase(pool));

    app.addHook('onClose', async () => {
      await pool.end();
    });

    // Report connectivity at startup so an operator sees the problem in the log
    // rather than discovering it when the first cashier signs in.
    const health = await checkDatabaseHealth(pool);

    if (health.connected) {
      const version = health.serverVersion?.split(' ').slice(0, 2).join(' ') ?? 'unknown';
      app.log.info({ latencyMs: health.latencyMs, server: version }, 'database connected');
    } else {
      // Deliberately a warning, not a fatal error. The API still starts and
      // /health/db reports the failure with a precise status, which is more
      // useful to an operator than a process that exits and restarts in a loop.
      app.log.warn(
        { error: health.error },
        'database is not reachable at startup; the API will report degraded health',
      );
    }
  },
  { name: 'database' },
);
