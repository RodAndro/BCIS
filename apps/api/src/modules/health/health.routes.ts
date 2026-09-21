import { checkDatabaseHealth, inspectMigrationState } from '@bcis/database';
import type { FastifyPluginAsync } from 'fastify';

import { databasePackagePath } from '../../config/root';

/**
 * Health endpoints.
 *
 * ── TWO ENDPOINTS, TWO DIFFERENT QUESTIONS ──────────────────────────────────
 *   GET /health      — is the process alive? Never touches the database, so a
 *                      database outage cannot make the process look dead.
 *   GET /health/db   — can it actually serve requests? Reports connectivity
 *                      AND migration state, because an API running against a
 *                      database one migration behind will pass a naive ping
 *                      and then fail on the first real query.
 *
 * The Phase 1 verification deliberately stops the API and confirms the desktop
 * shell changes what it displays. That is what distinguishes a real health
 * report from a hardcoded "healthy" string.
 */

const SERVICE_NAME = 'bcis-api';
const SERVICE_VERSION = '0.1.0';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async () => ({
    status: 'ok' as const,
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  }));

  app.get('/health/db', async (request, reply) => {
    const health = await checkDatabaseHealth(app.pool);

    if (!health.connected) {
      request.log.warn({ error: health.error }, 'database health check failed');

      // 503 so that a load balancer or the desktop shell treats this as "not
      // ready", which is the truth: no request can be served.
      void reply.code(503);
      return {
        status: 'unavailable' as const,
        database: {
          connected: false,
          latencyMs: health.latencyMs,
          serverVersion: null,
          appliedMigrations: null,
          pendingMigrations: [],
        },
        timestamp: new Date().toISOString(),
      };
    }

    const migrations = await inspectMigrationState(app.pool, databasePackagePath());
    const hasPending = migrations.pending.length > 0;

    if (hasPending) {
      request.log.warn(
        { pendingMigrations: migrations.pending },
        'database is reachable but not fully migrated',
      );
    }

    // Reachable but behind on migrations is "degraded", not "ok": the process
    // will answer some requests and fail others, which is the most dangerous
    // state to report as healthy.
    if (hasPending) {
      void reply.code(200);
    }

    return {
      status: hasPending ? ('degraded' as const) : ('ok' as const),
      database: {
        connected: true,
        latencyMs: health.latencyMs,
        serverVersion: health.serverVersion,
        appliedMigrations: migrations.appliedCount,
        pendingMigrations: [...migrations.pending],
      },
      timestamp: new Date().toISOString(),
    };
  });
};
