import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../../apps/api/src/app';
import { TEST_PASSWORD, createTestUser, loginAs, seedAccess } from '../helpers/auth';
import {
  createPlan,
  createServiceAccount,
  createSubscriber,
  seedServiceTypes,
  serviceAddress,
} from '../helpers/catalog';
import { createTestDatabase, type TestDatabase } from '../helpers/database';

/**
 * Service accounts.
 *
 * The interesting assertions are the refusals: a plan that has been superseded,
 * a plan that has been retired, an installation address belonging to somebody
 * else, and a status change the lifecycle table does not allow. Each of those is
 * a way for an account to end up describing a service that does not exist.
 */

const ADMIN = 'sa.admin';
const CASHIER = 'sa.cashier';

let testDatabase: TestDatabase;
let app: FastifyInstance;
let admin: Record<string, string>;
let cashier: Record<string, string>;

beforeAll(async () => {
  testDatabase = await createTestDatabase();
  await seedAccess(testDatabase.pool);
  await seedServiceTypes(testDatabase.pool);
  await createTestUser(testDatabase.pool, { username: ADMIN, roleCode: 'OWNER' });
  await createTestUser(testDatabase.pool, { username: CASHIER, roleCode: 'CASHIER' });

  app = await buildApp({ logger: false });
  await app.ready();
  admin = await loginAs(app, ADMIN, TEST_PASSWORD);
  cashier = await loginAs(app, CASHIER, TEST_PASSWORD);
});

afterAll(async () => {
  await app.close();
  await testDatabase.close();
});

describe('opening an account', () => {
  it('snapshots the plan price and records an activation event', async () => {
    const plan = await createPlan(app, admin, {
      code: 'SA-INT',
      serviceTypeCode: 'INTERNET',
      name: 'Service Account Internet',
      monthlyFeeCentavos: 129_900,
      speedMbps: 100,
      effectiveFrom: '2026-01-01',
    });

    const subscriber = await createSubscriber(app, admin, {
      displayName: 'Service Account Customer',
      addresses: [serviceAddress('21 Rizal Street')],
    });

    const account = await createServiceAccount(app, admin, {
      subscriberId: subscriber.id,
      servicePlanId: plan.id,
      installationAddressId: subscriber.addresses[0]?.id ?? null,
      activationDate: '2026-02-10',
    });

    expect(account.accountNumber).toMatch(/^SA-\d{6}$/);
    expect(account.status).toBe('ACTIVE');
    expect(account.currentPlanPriceCentavos).toBe(129_900);
    expect(account.serviceTypeCode).toBe('INTERNET');

    // History starts with the activation, so the timeline is never empty.
    expect(account.events[0]?.eventType).toBe('ACTIVATED');
  });

  it('creates a PENDING account with no activation date', async () => {
    const plan = await createPlan(app, admin, {
      code: 'SA-PENDING',
      serviceTypeCode: 'INTERNET',
      name: 'Pending Plan',
      monthlyFeeCentavos: 99_900,
      effectiveFrom: '2026-01-01',
    });

    const subscriber = await createSubscriber(app, admin, { displayName: 'Pending Customer' });

    const account = await createServiceAccount(app, admin, {
      subscriberId: subscriber.id,
      servicePlanId: plan.id,
      status: 'PENDING',
    });

    expect(account.status).toBe('PENDING');

    const detail = await app.inject({
      method: 'GET',
      url: `/service-accounts/${String(account.id)}`,
      headers: admin,
    });
    expect(
      detail.json<{ data: { activationDate: string | null } }>().data.activationDate,
    ).toBeNull();
  });

  it('rejects a PENDING account that carries an activation date', async () => {
    const plan = await createPlan(app, admin, {
      code: 'SA-PENDING-BAD',
      serviceTypeCode: 'INTERNET',
      name: 'Pending With Date',
      monthlyFeeCentavos: 99_900,
      effectiveFrom: '2026-01-01',
    });

    const subscriber = await createSubscriber(app, admin, { displayName: 'Pending Bad Customer' });

    const response = await app.inject({
      method: 'POST',
      url: '/service-accounts',
      headers: admin,
      payload: {
        subscriberId: subscriber.id,
        servicePlanId: plan.id,
        status: 'PENDING',
        activationDate: '2026-03-01',
      },
    });

    expect(response.statusCode).toBe(422);
  });

  it('gives every account a different number', async () => {
    const plan = await createPlan(app, admin, {
      code: 'SA-NUMBERS',
      serviceTypeCode: 'INTERNET',
      name: 'Numbering Plan',
      monthlyFeeCentavos: 99_900,
      effectiveFrom: '2026-01-01',
    });

    const subscriber = await createSubscriber(app, admin, { displayName: 'Numbering Customer' });

    const first = await createServiceAccount(app, admin, {
      subscriberId: subscriber.id,
      servicePlanId: plan.id,
      activationDate: '2026-02-01',
    });
    const second = await createServiceAccount(app, admin, {
      subscriberId: subscriber.id,
      servicePlanId: plan.id,
      activationDate: '2026-02-01',
    });

    expect(first.accountNumber).not.toBe(second.accountNumber);
  });

  it('is protected by a unique index, not only by the service check', async () => {
    const existing = await testDatabase.pool.query<{ account_number: string }>(
      'SELECT account_number FROM service_accounts LIMIT 1',
    );
    const number = existing.rows[0]?.account_number;
    expect(number).toBeDefined();

    await expect(
      testDatabase.pool.query(
        `INSERT INTO service_accounts
           (account_number, subscriber_id, service_plan_id, billing_start_date, billing_day,
            due_day, current_plan_price_centavos)
         SELECT $1, subscriber_id, service_plan_id, billing_start_date, billing_day, due_day,
                current_plan_price_centavos
           FROM service_accounts LIMIT 1`,
        [number],
      ),
    ).rejects.toThrow();
  });
});

describe('refusing invalid relationships', () => {
  it('rejects a subscriber that does not exist', async () => {
    const plan = await createPlan(app, admin, {
      code: 'SA-BADSUB',
      serviceTypeCode: 'INTERNET',
      name: 'Bad Subscriber Plan',
      monthlyFeeCentavos: 99_900,
      effectiveFrom: '2026-01-01',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/service-accounts',
      headers: admin,
      payload: { subscriberId: 999_999, servicePlanId: plan.id },
    });

    expect(response.statusCode).toBe(422);
  });

  it('rejects a plan that does not exist', async () => {
    const subscriber = await createSubscriber(app, admin, { displayName: 'Bad Plan Customer' });

    const response = await app.inject({
      method: 'POST',
      url: '/service-accounts',
      headers: admin,
      payload: { subscriberId: subscriber.id, servicePlanId: 999_999 },
    });

    expect(response.statusCode).toBe(422);
  });

  it('rejects an installation address belonging to another subscriber', async () => {
    const plan = await createPlan(app, admin, {
      code: 'SA-BADADDR',
      serviceTypeCode: 'INTERNET',
      name: 'Bad Address Plan',
      monthlyFeeCentavos: 99_900,
      effectiveFrom: '2026-01-01',
    });

    const owner = await createSubscriber(app, admin, {
      displayName: 'Address Owner',
      addresses: [serviceAddress('5 Owner Street')],
    });
    const other = await createSubscriber(app, admin, { displayName: 'Address Borrower' });

    const response = await app.inject({
      method: 'POST',
      url: '/service-accounts',
      headers: admin,
      payload: {
        subscriberId: other.id,
        servicePlanId: plan.id,
        installationAddressId: owner.addresses[0]?.id,
      },
    });

    expect(response.statusCode).toBe(422);
    // The message names the field, so the form can point at it.
    expect(
      response.json<{ error: { details?: Record<string, unknown> } }>().error.details,
    ).toBeDefined();
  });

  it('rejects a retired plan', async () => {
    const plan = await createPlan(app, admin, {
      code: 'SA-RETIRED',
      serviceTypeCode: 'INTERNET',
      name: 'Retired Plan',
      monthlyFeeCentavos: 99_900,
      effectiveFrom: '2026-01-01',
    });

    const retired = await app.inject({
      method: 'POST',
      url: `/plans/${String(plan.id)}/retire`,
      headers: admin,
      payload: { reason: 'No longer offered to new customers.' },
    });
    expect(retired.statusCode).toBe(200);

    const subscriber = await createSubscriber(app, admin, { displayName: 'Retired Plan Customer' });

    const response = await app.inject({
      method: 'POST',
      url: '/service-accounts',
      headers: admin,
      payload: { subscriberId: subscriber.id, servicePlanId: plan.id },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { message: string } }>().error.message).toMatch(/retired/i);
  });
});

describe('status lifecycle', () => {
  it('walks suspension and reconnection, naming each event', async () => {
    const plan = await createPlan(app, admin, {
      code: 'SA-LIFECYCLE',
      serviceTypeCode: 'INTERNET',
      name: 'Lifecycle Plan',
      monthlyFeeCentavos: 99_900,
      effectiveFrom: '2026-01-01',
    });

    const subscriber = await createSubscriber(app, admin, { displayName: 'Lifecycle Customer' });
    const account = await createServiceAccount(app, admin, {
      subscriberId: subscriber.id,
      servicePlanId: plan.id,
      activationDate: '2026-02-01',
    });

    const suspend = await app.inject({
      method: 'PATCH',
      url: `/service-accounts/${String(account.id)}/status`,
      headers: admin,
      payload: {
        status: 'SUSPENDED',
        effectiveDate: '2026-04-01',
        reason: 'Account is more than sixty days overdue.',
      },
    });
    expect(suspend.statusCode).toBe(200);
    expect(suspend.json<{ data: { status: string } }>().data.status).toBe('SUSPENDED');

    const reconnect = await app.inject({
      method: 'PATCH',
      url: `/service-accounts/${String(account.id)}/status`,
      headers: admin,
      payload: {
        status: 'ACTIVE',
        effectiveDate: '2026-04-15',
        reason: 'Balance settled; service restored.',
      },
    });
    expect(reconnect.statusCode).toBe(200);

    const events = reconnect.json<{ data: { events: { eventType: string }[] } }>().data.events;
    const types = events.map((event) => event.eventType);

    // The history names the operations rather than collapsing them into a
    // generic "status changed".
    expect(types).toContain('SUSPENDED');
    expect(types).toContain('RECONNECTED');
  });

  it('refuses a transition to the same status', async () => {
    const plan = await createPlan(app, admin, {
      code: 'SA-SAME',
      serviceTypeCode: 'INTERNET',
      name: 'Same Status Plan',
      monthlyFeeCentavos: 99_900,
      effectiveFrom: '2026-01-01',
    });

    const subscriber = await createSubscriber(app, admin, { displayName: 'Same Status Customer' });
    const account = await createServiceAccount(app, admin, {
      subscriberId: subscriber.id,
      servicePlanId: plan.id,
      activationDate: '2026-02-01',
    });

    const response = await app.inject({
      method: 'PATCH',
      url: `/service-accounts/${String(account.id)}/status`,
      headers: admin,
      payload: {
        status: 'ACTIVE',
        effectiveDate: '2026-04-01',
        reason: 'Setting an active account active.',
      },
    });

    expect(response.statusCode).toBe(409);
  });

  it('refuses to skip installation', async () => {
    const plan = await createPlan(app, admin, {
      code: 'SA-SKIP',
      serviceTypeCode: 'INTERNET',
      name: 'Skip Plan',
      monthlyFeeCentavos: 99_900,
      effectiveFrom: '2026-01-01',
    });

    const subscriber = await createSubscriber(app, admin, { displayName: 'Skip Customer' });
    const account = await createServiceAccount(app, admin, {
      subscriberId: subscriber.id,
      servicePlanId: plan.id,
      status: 'PENDING',
    });

    const response = await app.inject({
      method: 'PATCH',
      url: `/service-accounts/${String(account.id)}/status`,
      headers: admin,
      payload: {
        status: 'SUSPENDED',
        effectiveDate: '2026-04-01',
        reason: 'Attempting to suspend an account that was never activated.',
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { message: string } }>().error.message).toMatch(/pending/i);
  });

  it('treats CLOSED as terminal', async () => {
    const plan = await createPlan(app, admin, {
      code: 'SA-CLOSED',
      serviceTypeCode: 'INTERNET',
      name: 'Closed Plan',
      monthlyFeeCentavos: 99_900,
      effectiveFrom: '2026-01-01',
    });

    const subscriber = await createSubscriber(app, admin, { displayName: 'Closed Customer' });
    const account = await createServiceAccount(app, admin, {
      subscriberId: subscriber.id,
      servicePlanId: plan.id,
      activationDate: '2026-02-01',
    });

    await app.inject({
      method: 'PATCH',
      url: `/service-accounts/${String(account.id)}/status`,
      headers: admin,
      payload: {
        status: 'CLOSED',
        effectiveDate: '2026-05-01',
        reason: 'Customer terminated the service.',
      },
    });

    const reopen = await app.inject({
      method: 'PATCH',
      url: `/service-accounts/${String(account.id)}/status`,
      headers: admin,
      payload: {
        status: 'ACTIVE',
        effectiveDate: '2026-05-10',
        reason: 'Attempting to reopen a closed account.',
      },
    });

    expect(reopen.statusCode).toBe(409);
  });
});

describe('service history', () => {
  it('cannot be rewritten', async () => {
    const rows = await testDatabase.pool.query<{ id: number }>(
      'SELECT id FROM service_events ORDER BY id LIMIT 1',
    );
    const id = rows.rows[0]?.id;
    expect(id).toBeDefined();

    // Not a convention: the trigger refuses the write.
    await expect(
      testDatabase.pool.query(`UPDATE service_events SET event_type = 'CLOSED' WHERE id = $1`, [
        id,
      ]),
    ).rejects.toThrow(/append-only/);

    await expect(testDatabase.pool.query('DELETE FROM service_events')).rejects.toThrow(
      /append-only/,
    );
  });
});

describe('authorization', () => {
  it('lets a Cashier read service accounts', async () => {
    expect(
      (await app.inject({ method: 'GET', url: '/service-accounts', headers: cashier })).statusCode,
    ).toBe(200);
  });

  it('refuses a Cashier opening a service account', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/service-accounts',
      headers: cashier,
      payload: { subscriberId: 1, servicePlanId: 1 },
    });

    expect(response.statusCode).toBe(403);
  });

  it('refuses a Cashier changing a status', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/service-accounts/1/status',
      headers: cashier,
      payload: { status: 'SUSPENDED', effectiveDate: '2026-04-01', reason: 'Not allowed.' },
    });

    expect(response.statusCode).toBe(403);
  });

  it('refuses an unauthenticated request', async () => {
    expect((await app.inject({ method: 'GET', url: '/service-accounts' })).statusCode).toBe(401);
  });
});
