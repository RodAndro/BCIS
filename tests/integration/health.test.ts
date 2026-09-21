import { checkDatabaseHealth, createPool } from '@bcis/database';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../apps/api/src/app';
import { createTestDatabase, type TestDatabase } from './helpers/database';

/**
 * Health endpoint integration tests.
 *
 * These run against a real PostgreSQL instance with the real migration set
 * applied, because the thing being verified is not "does the handler return
 * 200" but "does the full chain renderer → main → HTTP → Fastify → PostgreSQL
 * actually report the truth".
 */

let testDatabase: TestDatabase;
let app: FastifyInstance;

beforeAll(async () => {
  testDatabase = await createTestDatabase();
  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await testDatabase.close();
});

describe('GET /health', () => {
  it('reports liveness without touching the database', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);

    const body = response.json<{
      status: string;
      service: string;
      version: string;
      uptimeSeconds: number;
      timestamp: string;
    }>();

    expect(body.status).toBe('ok');
    expect(body.service).toBe('bcis-api');
    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
  });
});

describe('GET /health/db', () => {
  it('reports a connected and fully migrated database as ok', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/db' });

    expect(response.statusCode).toBe(200);

    const body = response.json<{
      status: string;
      database: {
        connected: boolean;
        latencyMs: number;
        serverVersion: string | null;
        appliedMigrations: number | null;
        pendingMigrations: string[];
      };
    }>();

    expect(body.status).toBe('ok');
    expect(body.database.connected).toBe(true);
    expect(body.database.latencyMs).toBeGreaterThanOrEqual(0);
    expect(body.database.serverVersion).toContain('PostgreSQL 17');
    expect(body.database.appliedMigrations).toBeGreaterThanOrEqual(1);
    expect(body.database.pendingMigrations).toEqual([]);
  });

  it('detects that a migration is pending rather than reporting healthy', async () => {
    // Dropping the bookkeeping schema is exactly what an unmigrated database
    // looks like. A naive ping would still answer 200 and look fine.
    await testDatabase.pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE');

    const response = await app.inject({ method: 'GET', url: '/health/db' });
    const body = response.json<{
      status: string;
      database: {
        connected: boolean;
        appliedMigrations: number | null;
        pendingMigrations: string[];
      };
    }>();

    expect(body.status).toBe('degraded');
    expect(body.database.connected).toBe(true);
    expect(body.database.appliedMigrations).toBeNull();
    expect(body.database.pendingMigrations.length).toBeGreaterThan(0);

    await testDatabase.reset();
  });
});

describe('database availability', () => {
  it('reports a failure instead of throwing when the database is unreachable', async () => {
    // Port 1 is reserved and nothing will be listening on it, so this exercises
    // the real connection-failure path rather than a mocked rejection.
    const unreachable = createPool({
      connectionString: 'postgresql://nobody:nobody@127.0.0.1:1/nothing',
      maxConnections: 1,
    });

    try {
      const health = await checkDatabaseHealth(unreachable);

      expect(health.connected).toBe(false);
      expect(health.serverVersion).toBeNull();
      expect(health.error).not.toBeNull();
    } finally {
      await unreachable.end();
    }
  });
});

describe('unknown routes', () => {
  it('answers with the standard error envelope, not an HTML error page', async () => {
    const response = await app.inject({ method: 'GET', url: '/does-not-exist' });

    expect(response.statusCode).toBe(404);

    const body = response.json<{
      error: { code: string; message: string; requestId: string };
    }>();

    expect(body.error.code).toBe('ROUTE_NOT_FOUND');
    expect(body.error.message).toContain('GET');
    // Every error carries a correlation id so a user can quote it and an
    // administrator can find the matching log line.
    expect(body.error.requestId).toBeTruthy();
  });
});
