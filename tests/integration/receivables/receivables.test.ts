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

let database: TestDatabase;
let app: FastifyInstance;
let admin: Record<string, string>;
let cashier: Record<string, string>;
let accountId: number;
let subscriberId: number;

beforeAll(async () => {
  database = await createTestDatabase();
  await seedAccess(database.pool);
  await seedServiceTypes(database.pool);
  await createTestUser(database.pool, { username: 'receivable.admin', roleCode: 'OWNER' });
  await createTestUser(database.pool, { username: 'receivable.cashier', roleCode: 'CASHIER' });

  app = await buildApp({ logger: false });
  await app.ready();
  admin = await loginAs(app, 'receivable.admin', TEST_PASSWORD);
  cashier = await loginAs(app, 'receivable.cashier', TEST_PASSWORD);

  const areaId = await seedCollectionArea(database.pool, 'AR-1', 'AR Route');
  const plan = await createPlan(app, admin, {
    code: 'AR-PLAN',
    serviceTypeCode: 'INTERNET',
    name: 'AR Internet',
    monthlyFeeCentavos: 20_000,
    effectiveFrom: '2026-01-01',
    reconnectionFeeCentavos: 5_000,
  });
  const subscriber = await createSubscriber(app, admin, {
    displayName: 'AR Customer',
    collectionAreaId: areaId,
    addresses: [serviceAddress('AR Customer Street')],
  });
  subscriberId = subscriber.id;
  const account = await createServiceAccount(app, admin, {
    subscriberId,
    servicePlanId: plan.id,
    activationDate: '2026-01-05',
  });
  accountId = account.id;

  const generated = await app.inject({
    method: 'POST',
    url: '/billing/generate',
    headers: admin,
    payload: { month: '2026-03', dryRun: false },
  });
  expect(generated.statusCode).toBe(200);
});

afterAll(async () => {
  await app.close();
  await database.close();
});

describe('Phase 7 receivables', () => {
  it('reconciles aging totals with live outstanding invoice balances', async () => {
    const aging = await app.inject({ method: 'GET', url: '/receivables/aging', headers: admin });
    expect(aging.statusCode).toBe(200);
    expect(
      aging.json<{ data: { bucket90PlusCentavos: number; totalOutstandingCentavos: number } }>()
        .data,
    ).toMatchObject({
      bucket90PlusCentavos: 20_000,
      totalOutstandingCentavos: 20_000,
    });

    const overdue = await app.inject({
      method: 'GET',
      url: '/receivables?overdueOnly=true&agingBucket=90_PLUS&page=1&pageSize=10',
      headers: admin,
    });
    expect(overdue.statusCode).toBe(200);
    const data = overdue.json<{
      data: Array<{ serviceAccountId: number; totalArrearsCentavos: number; subscriber: string }>;
    }>().data;
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      serviceAccountId: accountId,
      totalArrearsCentavos: 20_000,
      subscriber: 'AR Customer',
    });

    const candidates = await app.inject({
      method: 'GET',
      url: '/receivables/suspension-candidates?page=1&pageSize=10',
      headers: admin,
    });
    expect(candidates.statusCode).toBe(200);
    expect(
      candidates.json<{ data: Array<{ serviceAccountId: number; eligible: boolean }> }>().data,
    ).toContainEqual({
      serviceAccountId: accountId,
      eligible: true,
      thresholdDaysOverdue: 60,
      thresholdMonthsUnpaid: 3,
      accountNumber: expect.any(String),
      subscriberId,
      subscriber: 'AR Customer',
      servicePlanId: expect.any(Number),
      plan: 'AR Internet',
      serviceTypeCode: 'INTERNET',
      area: 'AR Route',
      collector: null,
      monthsUnpaid: 1,
      oldestUnpaidInvoice: '2026-03-15',
      lastPayment: null,
      totalArrearsCentavos: 20_000,
      agingBucket: '90_PLUS',
    });
  });

  /**
   * Regression: an account WITH a payment used to 500 the whole list.
   *
   * `lastPayment` is a raw `sql` aggregate over `payments.payment_date` (a
   * timestamptz). A raw expression arrives as Postgres text, not a Date, so the
   * mapper's `.toISOString()` threw — but only once a payment existed, and the
   * only `/receivables` call here ran before any payment did. That ordering is
   * exactly why the suite stayed green while the screen was broken.
   */
  it('returns the last payment as an ISO-8601 timestamp when a payment exists', async () => {
    await database.pool.query(
      `INSERT INTO payments (subscriber_id, service_account_id, payment_method, amount_centavos,
         applied_centavos, unapplied_centavos, status, payment_date, posted_at, received_by)
       VALUES ($1, $2, 'CASH', 5000, 0, 5000, 'POSTED', '2026-03-20T02:30:00Z', now(), 1)`,
      [subscriberId, accountId],
    );

    const expected = await database.pool.query<{ last: Date }>(
      `SELECT max(payment_date) AS last FROM payments
       WHERE service_account_id = $1 AND status IN ('POSTED', 'REVERSED')`,
      [accountId],
    );

    const response = await app.inject({
      method: 'GET',
      url: '/receivables?page=1&pageSize=10',
      headers: admin,
    });

    expect(response.statusCode).toBe(200);
    const rows = response.json<{
      data: Array<{ serviceAccountId: number; lastPayment: string | null }>;
    }>().data;
    const row = rows.find((item) => item.serviceAccountId === accountId);

    expect(row).toBeDefined();
    // The exact instant, formatted the same way every other timestamp is.
    expect(row?.lastPayment).toBe(expected.rows[0]?.last.toISOString());
  });

  it('does not authorize a cashier to suspend service', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/service-accounts/${String(accountId)}/suspend`,
      headers: cashier,
      payload: { effectiveDate: '2026-09-21', reason: 'Delinquent account requires suspension.' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('reduces overdue balances from posted payment allocations', async () => {
    const invoice = await database.pool.query<{ id: number }>(
      `SELECT id FROM invoices WHERE service_account_id = $1 AND status <> 'VOID' LIMIT 1`,
      [accountId],
    );
    const payment = await database.pool.query<{ id: number }>(
      `INSERT INTO payments (subscriber_id, service_account_id, payment_method, amount_centavos,
         applied_centavos, unapplied_centavos, status, posted_at, received_by)
       VALUES ($1, $2, 'CASH', 20000, 20000, 0, 'POSTED', now(), 1)
       RETURNING id`,
      [subscriberId, accountId],
    );
    await database.pool.query(
      `INSERT INTO payment_allocations (payment_id, invoice_id, amount_centavos, allocated_by)
       VALUES ($1, $2, 20000, 1)`,
      [payment.rows[0]?.id, invoice.rows[0]?.id],
    );

    const aging = await app.inject({ method: 'GET', url: '/receivables/aging', headers: admin });
    expect(aging.statusCode).toBe(200);
    expect(
      aging.json<{ data: { totalOutstandingCentavos: number } }>().data.totalOutstandingCentavos,
    ).toBe(0);
  });

  it('records suspension and reconnection in service history', async () => {
    const suspended = await app.inject({
      method: 'POST',
      url: `/service-accounts/${String(accountId)}/suspend`,
      headers: admin,
      payload: { effectiveDate: '2026-09-21', reason: 'Delinquent account requires suspension.' },
    });
    expect(suspended.statusCode).toBe(200);

    const payment = await database.pool.query<{ id: number }>(
      `INSERT INTO payments (subscriber_id, service_account_id, payment_method, amount_centavos,
         applied_centavos, unapplied_centavos, status, posted_at, received_by)
       VALUES ($1, $2, 'CASH', 20000, 20000, 0, 'POSTED', now(), $3)
       RETURNING id`,
      [subscriberId, accountId, 1],
    );
    const paymentId = payment.rows[0]?.id;
    expect(paymentId).toBeDefined();

    const requested = await app.inject({
      method: 'POST',
      url: `/service-accounts/${String(accountId)}/reconnection-requests`,
      headers: admin,
      payload: { requestDate: '2026-09-21', qualifyingPaymentId: paymentId },
    });
    expect(requested.statusCode).toBe(201);
    const reconnectionId = requested.json<{
      data: { id: number; reconnectionFeeCentavos: number };
    }>().data.id;
    expect(
      requested.json<{ data: { reconnectionFeeCentavos: number } }>().data.reconnectionFeeCentavos,
    ).toBe(5_000);

    const scheduled = await app.inject({
      method: 'PATCH',
      url: `/reconnection-requests/${String(reconnectionId)}/schedule`,
      headers: admin,
      payload: { technicianUserId: 1 },
    });
    expect(scheduled.statusCode).toBe(200);

    const completed = await app.inject({
      method: 'PATCH',
      url: `/reconnection-requests/${String(reconnectionId)}/complete`,
      headers: admin,
      payload: { completionDate: '2026-09-21', notes: 'Technician restored service.' },
    });
    expect(completed.statusCode).toBe(200);

    const detail = await app.inject({
      method: 'GET',
      url: `/service-accounts/${String(accountId)}`,
      headers: admin,
    });
    expect(detail.statusCode).toBe(200);
    const events = detail
      .json<{ data: { status: string; events: Array<{ eventType: string }> } }>()
      .data.events.map((event) => event.eventType);
    expect(detail.json<{ data: { status: string } }>().data.status).toBe('ACTIVE');
    expect(events).toContain('SUSPENDED');
    expect(events).toContain('RECONNECTED');
  });
});
