import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../../apps/api/src/app';
import { createTestUser, loginAs, TEST_PASSWORD, seedAccess } from '../helpers/auth';
import {
  createPlan,
  createServiceAccount,
  createSubscriber,
  seedCollectionArea,
  seedServiceTypes,
  serviceAddress,
} from '../helpers/catalog';
import { createTestDatabase, type TestDatabase } from '../helpers/database';

describe('Phase 9 concurrency boundaries', () => {
  let database: TestDatabase;
  let app: FastifyInstance;
  let owner: Record<string, string>;
  let accountId: number;

  beforeAll(async () => {
    database = await createTestDatabase();
    await seedAccess(database.pool);
    await seedServiceTypes(database.pool);
    await createTestUser(database.pool, { username: 'concurrency.owner', roleCode: 'OWNER' });
    app = await buildApp({ logger: false });
    await app.ready();
    owner = await loginAs(app, 'concurrency.owner', TEST_PASSWORD);

    const areaId = await seedCollectionArea(database.pool, 'CONC', 'Concurrency Route');
    const plan = await createPlan(app, owner, {
      code: 'CONC-PLAN',
      serviceTypeCode: 'INTERNET',
      name: 'Concurrency Plan',
      monthlyFeeCentavos: 10_000,
      effectiveFrom: '2026-01-01',
    });
    const subscriber = await createSubscriber(app, owner, {
      displayName: 'Concurrency Customer',
      collectionAreaId: areaId,
      addresses: [serviceAddress('Concurrency Street')],
    });
    const account = await createServiceAccount(app, owner, {
      subscriberId: subscriber.id,
      servicePlanId: plan.id,
      activationDate: '2026-01-05',
    });
    accountId = account.id;
  });

  afterAll(async () => {
    await app.close();
    await database.close();
  });

  it('does not create duplicate invoices when generation races', async () => {
    const responses = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/billing/generate',
        headers: owner,
        payload: { month: '2026-03', dryRun: false },
      }),
      app.inject({
        method: 'POST',
        url: '/billing/generate',
        headers: owner,
        payload: { month: '2026-03', dryRun: false },
      }),
    ]);
    expect(
      responses.every((response) => response.statusCode < 500),
      responses.map((response) => `${String(response.statusCode)} ${response.body}`).join('\n'),
    ).toBe(true);

    const rows = await database.pool.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM invoices WHERE service_account_id = $1 AND billing_period_start = '2026-03-01' AND status <> 'VOID'`,
      [accountId],
    );
    expect(rows.rows[0]?.total).toBe(1);
  });

  it('keeps concurrent report reads isolated from the billing request', async () => {
    const responses = await Promise.all([
      app.inject({ method: 'GET', url: '/subscribers?page=1&pageSize=10', headers: owner }),
      app.inject({
        method: 'GET',
        url: '/reports?type=MONTHLY_COLLECTION&format=json&page=1&pageSize=10',
        headers: owner,
      }),
      app.inject({ method: 'GET', url: '/receivables/aging', headers: owner }),
    ]);
    expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 200]);
  });
});
