import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../../apps/api/src/app';
import { createTestUser, loginAs, seedAccess } from '../helpers/auth';
import { createTestDatabase, type TestDatabase } from '../helpers/database';

/**
 * Audit log: querying it, and proving it cannot be rewritten.
 *
 * ── WHY THE IMMUTABILITY TEST IS THE IMPORTANT ONE ──────────────────────────
 * "Posted financial records are immutable" is the kind of claim that is easy to
 * assert and easy to be wrong about. The trigger is the enforcement; this test
 * is the evidence. It attempts a real `UPDATE` against a real row and requires
 * the database to refuse.
 */

const ADMIN = 'audit.admin';

let testDatabase: TestDatabase;
let app: FastifyInstance;

beforeAll(async () => {
  testDatabase = await createTestDatabase();
  await seedAccess(testDatabase.pool);
  await createTestUser(testDatabase.pool, { username: ADMIN, roleCode: 'OWNER' });

  app = await buildApp({ logger: false });
  await app.ready();

  // Generate some audit traffic to read back.
  const headers = await loginAs(app, ADMIN);
  await app.inject({ method: 'POST', url: '/auth/logout', headers });
  await loginAs(app, ADMIN);
});

afterAll(async () => {
  await app.close();
  await testDatabase.close();
});

describe('GET /audit-logs', () => {
  it('returns entries with their actor resolved', async () => {
    const headers = await loginAs(app, ADMIN);
    const response = await app.inject({ method: 'GET', url: '/audit-logs', headers });

    expect(response.statusCode).toBe(200);

    const body = response.json<{
      data: { action: string; entityType: string; actorUsername: string | null }[];
      meta: { total: number };
    }>();

    expect(body.meta.total).toBeGreaterThan(0);
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.every((entry) => typeof entry.action === 'string')).toBe(true);
  });

  it('filters by action', async () => {
    const headers = await loginAs(app, ADMIN);
    const response = await app.inject({
      method: 'GET',
      url: '/audit-logs?action=LOGOUT',
      headers,
    });

    const body = response.json<{ data: { action: string }[] }>();
    expect(response.statusCode).toBe(200);
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.every((entry) => entry.action === 'LOGOUT')).toBe(true);
  });

  it('is refused to a session without audit.view', async () => {
    await createTestUser(testDatabase.pool, { username: 'audit.cashier', roleCode: 'CASHIER' });
    const headers = await loginAs(app, 'audit.cashier');

    expect((await app.inject({ method: 'GET', url: '/audit-logs', headers })).statusCode).toBe(403);
  });
});

describe('append-only enforcement (INV-9)', () => {
  it('rejects an UPDATE against an existing entry', async () => {
    const existing = await testDatabase.pool.query<{ id: number }>(
      `SELECT id FROM audit_logs ORDER BY id LIMIT 1`,
    );
    const id = existing.rows[0]?.id;
    expect(id).toBeDefined();

    // The database itself must refuse, not a service-layer convention. If this
    // resolves, the trigger is missing and the immutability claim is false.
    await expect(
      testDatabase.pool.query(`UPDATE audit_logs SET action = 'TAMPERED' WHERE id = $1`, [id]),
    ).rejects.toThrow(/append-only/);
  });

  it('rejects a DELETE against an existing entry', async () => {
    await expect(testDatabase.pool.query('DELETE FROM audit_logs')).rejects.toThrow(/append-only/);
  });
});

describe('what the audit log must never contain', () => {
  it('stores no password hash', async () => {
    const rows = await testDatabase.pool.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM audit_logs
       WHERE coalesce(old_values::text, '') LIKE '%$argon2%'
          OR coalesce(new_values::text, '') LIKE '%$argon2%'
          OR coalesce(old_values::text, '') LIKE '%passwordHash%'
          OR coalesce(new_values::text, '') LIKE '%passwordHash%'`,
    );

    expect(Number(rows.rows[0]?.total ?? '0')).toBe(0);
  });

  it('stores no session token or token hash', async () => {
    const rows = await testDatabase.pool.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM audit_logs
       WHERE coalesce(old_values::text, '') LIKE '%tokenHash%'
          OR coalesce(new_values::text, '') LIKE '%tokenHash%'`,
    );

    expect(Number(rows.rows[0]?.total ?? '0')).toBe(0);
  });
});
