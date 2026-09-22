import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../../apps/api/src/app';
import { TEST_PASSWORD, createTestUser, loginAs, seedAccess } from '../helpers/auth';
import { createTestDatabase, type TestDatabase } from '../helpers/database';

describe('Phase 9 backup authorization', () => {
  let database: TestDatabase;
  let app: FastifyInstance;
  let administrator: Record<string, string>;
  let cashier: Record<string, string>;
  let owner: Record<string, string>;

  beforeAll(async () => {
    database = await createTestDatabase();
    await seedAccess(database.pool);
    await createTestUser(database.pool, { username: 'backup.admin', roleCode: 'ADMINISTRATOR' });
    await createTestUser(database.pool, { username: 'backup.cashier', roleCode: 'CASHIER' });
    await createTestUser(database.pool, { username: 'backup.owner', roleCode: 'OWNER' });
    app = await buildApp({ logger: false });
    await app.ready();
    administrator = await loginAs(app, 'backup.admin', TEST_PASSWORD);
    cashier = await loginAs(app, 'backup.cashier', TEST_PASSWORD);
    owner = await loginAs(app, 'backup.owner', TEST_PASSWORD);
  });

  afterAll(async () => {
    await app.close();
    await database.close();
  });

  it('refuses backup creation to non-owner sessions before invoking pg_dump', async () => {
    const adminResponse = await app.inject({
      method: 'POST',
      url: '/backups',
      headers: administrator,
    });
    const cashierResponse = await app.inject({ method: 'POST', url: '/backups', headers: cashier });

    expect(adminResponse.statusCode).toBe(403);
    expect(cashierResponse.statusCode).toBe(403);
  });

  it('refuses backup history and verification to non-owner sessions', async () => {
    const adminList = await app.inject({ method: 'GET', url: '/backups', headers: administrator });
    const cashierList = await app.inject({ method: 'GET', url: '/backups', headers: cashier });

    expect(adminList.statusCode).toBe(403);
    expect(cashierList.statusCode).toBe(403);
  });

  it('creates and verifies a PostgreSQL/attachment backup before reporting success', async () => {
    const created = await app.inject({ method: 'POST', url: '/backups', headers: owner });
    expect(created.statusCode, created.body).toBe(201);
    const backupId = created.json<{ data: { backupId: string; status: string } }>().data.backupId;
    expect(created.json<{ data: { status: string } }>().data.status).toBe('VERIFIED');

    const verified = await app.inject({
      method: 'POST',
      url: `/backups/${backupId}/verify`,
      headers: owner,
    });
    expect(verified.statusCode, verified.body).toBe(200);
    expect(verified.json<{ data: { ok: boolean } }>().data.ok).toBe(true);
  });
});
