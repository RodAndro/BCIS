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
 * Plan price history.
 *
 * ── THE CLAIM BEING TESTED ──────────────────────────────────────────────────
 * "Changing a plan's price must not modify old invoices, and historical rates
 * must survive." Phase 3 cannot test the invoice half — billing arrives in
 * Phase 4 — but it can test the two facts that make it possible:
 *
 *   1. A price change creates a NEW version and leaves the old row, with its old
 *      amount, readable.
 *   2. An existing service account keeps the rate it was activated at. Moving it
 *      onto the new price is a separate, explicit, audited action.
 *
 * If either of those were false, no later phase could preserve a historical
 * billed rate, because the number it would read from would already have moved.
 */

const ADMIN = 'plan.admin';

let testDatabase: TestDatabase;
let app: FastifyInstance;
let admin: Record<string, string>;

beforeAll(async () => {
  testDatabase = await createTestDatabase();
  await seedAccess(testDatabase.pool);
  await seedServiceTypes(testDatabase.pool);
  await createTestUser(testDatabase.pool, { username: ADMIN, roleCode: 'OWNER' });

  app = await buildApp({ logger: false });
  await app.ready();
  admin = await loginAs(app, ADMIN, TEST_PASSWORD);
});

afterAll(async () => {
  await app.close();
  await testDatabase.close();
});

describe('creating a plan', () => {
  it('stores the price in integer centavos and marks the version current', async () => {
    const plan = await createPlan(app, admin, {
      code: 'PH-INT',
      serviceTypeCode: 'INTERNET',
      name: 'Price History Internet',
      monthlyFeeCentavos: 99_900,
      speedMbps: 50,
      effectiveFrom: '2026-01-01',
    });

    expect(plan.monthlyFeeCentavos).toBe(99_900);
    expect(plan.effectiveFrom).toBe('2026-01-01');
    expect(plan.effectiveTo).toBeNull();
    expect(plan.isCurrent).toBe(true);
  });

  it('refuses a second plan with the same code', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/plans',
      headers: admin,
      payload: {
        code: 'PH-INT',
        serviceTypeCode: 'INTERNET',
        name: 'Duplicate',
        monthlyFeeCentavos: 50_000,
        effectiveFrom: '2026-02-01',
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { message: string } }>().error.message).toMatch(
      /already exists/i,
    );
  });

  it('refuses a download speed on a Cable plan', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/plans',
      headers: admin,
      payload: {
        code: 'PH-CABLE-BAD',
        serviceTypeCode: 'CABLE',
        name: 'Cable with speed',
        monthlyFeeCentavos: 50_000,
        speedMbps: 100,
        effectiveFrom: '2026-01-01',
      },
    });

    expect(response.statusCode).toBe(422);
  });
});

describe('changing a price', () => {
  it('preserves the old rate on the account and on the superseded version', async () => {
    const plan = await createPlan(app, admin, {
      code: 'PH-CHANGE',
      serviceTypeCode: 'INTERNET',
      name: 'Repricing Internet',
      monthlyFeeCentavos: 99_900,
      effectiveFrom: '2026-01-01',
    });

    const subscriber = await createSubscriber(app, admin, {
      displayName: 'Repricing Customer',
      addresses: [serviceAddress('12 Rizal Street')],
    });

    const account = await createServiceAccount(app, admin, {
      subscriberId: subscriber.id,
      servicePlanId: plan.id,
      status: 'ACTIVE',
      activationDate: '2026-01-15',
    });

    // The snapshot at activation.
    expect(account.currentPlanPriceCentavos).toBe(99_900);

    const change = await app.inject({
      method: 'POST',
      url: `/plans/${String(plan.id)}/price`,
      headers: admin,
      payload: {
        monthlyFeeCentavos: 129_900,
        effectiveFrom: '2026-06-01',
        reason: 'Annual rate adjustment approved by management.',
      },
    });

    expect(change.statusCode).toBe(201);

    // 1. The account's rate is UNCHANGED. This is the whole point: a price rise
    //    is not allowed to reach back and reprice a live account.
    const after = await app.inject({
      method: 'GET',
      url: `/service-accounts/${String(account.id)}`,
      headers: admin,
    });
    const detail = after.json<{
      data: { currentPlanPriceCentavos: number; planCurrentPriceCentavos: number };
    }>().data;

    expect(detail.currentPlanPriceCentavos).toBe(99_900);
    // ...and the drift is visible rather than hidden.
    expect(detail.planCurrentPriceCentavos).toBe(129_900);

    // 2. The superseded version still exists, with its own amount, closed the
    //    day before the new one starts.
    const versions = await app.inject({
      method: 'GET',
      url: '/plans?search=PH-CHANGE&currentOnly=false&pageSize=50',
      headers: admin,
    });
    const rows = versions.json<{
      data: { monthlyFeeCentavos: number; effectiveFrom: string; effectiveTo: string | null }[];
    }>().data;

    expect(rows).toHaveLength(2);

    const old = rows.find((row) => row.monthlyFeeCentavos === 99_900);
    const current = rows.find((row) => row.monthlyFeeCentavos === 129_900);

    expect(old?.effectiveTo).toBe('2026-05-31');
    expect(current?.effectiveFrom).toBe('2026-06-01');
    expect(current?.effectiveTo).toBeNull();
  });

  it('refuses a new version that does not start after the current one', async () => {
    const plan = await createPlan(app, admin, {
      code: 'PH-BACKDATE',
      serviceTypeCode: 'INTERNET',
      name: 'Backdated Internet',
      monthlyFeeCentavos: 80_000,
      effectiveFrom: '2026-03-01',
    });

    const response = await app.inject({
      method: 'POST',
      url: `/plans/${String(plan.id)}/price`,
      headers: admin,
      payload: {
        monthlyFeeCentavos: 90_000,
        effectiveFrom: '2026-03-01',
        reason: 'Attempting to backdate a price change.',
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json<{ error: { message: string } }>().error.message).toMatch(/after/i);
  });

  it('requires a reason, because a price change is a decision', async () => {
    const plan = await createPlan(app, admin, {
      code: 'PH-NOREASON',
      serviceTypeCode: 'INTERNET',
      name: 'No Reason Internet',
      monthlyFeeCentavos: 80_000,
      effectiveFrom: '2026-03-01',
    });

    const response = await app.inject({
      method: 'POST',
      url: `/plans/${String(plan.id)}/price`,
      headers: admin,
      payload: { monthlyFeeCentavos: 90_000, effectiveFrom: '2026-04-01' },
    });

    expect(response.statusCode).toBe(422);
  });

  it('refuses to open a new account on a superseded version', async () => {
    const plan = await createPlan(app, admin, {
      code: 'PH-SUPERSEDED',
      serviceTypeCode: 'INTERNET',
      name: 'Superseded Internet',
      monthlyFeeCentavos: 70_000,
      effectiveFrom: '2026-01-01',
    });

    await app.inject({
      method: 'POST',
      url: `/plans/${String(plan.id)}/price`,
      headers: admin,
      payload: {
        monthlyFeeCentavos: 75_000,
        effectiveFrom: '2026-05-01',
        reason: 'Superseding the original version for this test.',
      },
    });

    const subscriber = await createSubscriber(app, admin, {
      displayName: 'Superseded Customer',
      addresses: [serviceAddress('9 Bonifacio Street')],
    });

    const response = await app.inject({
      method: 'POST',
      url: '/service-accounts',
      headers: admin,
      payload: { subscriberId: subscriber.id, servicePlanId: plan.id },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { message: string } }>().error.message).toMatch(/superseded/i);
  });
});

describe('applying the current rate to an account', () => {
  it('moves the account and records a service event', async () => {
    const plan = await createPlan(app, admin, {
      code: 'PH-APPLY',
      serviceTypeCode: 'INTERNET',
      name: 'Apply Rate Internet',
      monthlyFeeCentavos: 60_000,
      effectiveFrom: '2026-01-01',
    });

    const subscriber = await createSubscriber(app, admin, {
      displayName: 'Apply Rate Customer',
      addresses: [serviceAddress('4 Mabini Street')],
    });

    const account = await createServiceAccount(app, admin, {
      subscriberId: subscriber.id,
      servicePlanId: plan.id,
      activationDate: '2026-01-10',
    });

    await app.inject({
      method: 'POST',
      url: `/plans/${String(plan.id)}/price`,
      headers: admin,
      payload: {
        monthlyFeeCentavos: 66_000,
        effectiveFrom: '2026-07-01',
        reason: 'Rate adjustment for the apply-rate test.',
      },
    });

    // Before applying, the account is still on the old rate.
    const before = await app.inject({
      method: 'GET',
      url: `/service-accounts/${String(account.id)}`,
      headers: admin,
    });
    expect(
      before.json<{ data: { currentPlanPriceCentavos: number } }>().data.currentPlanPriceCentavos,
    ).toBe(60_000);

    const applied = await app.inject({
      method: 'POST',
      url: `/service-accounts/${String(account.id)}/apply-rate`,
      headers: admin,
      payload: {
        effectiveDate: '2026-07-01',
        reason: 'Customer notified of the new rate by letter.',
      },
    });

    expect(applied.statusCode).toBe(200);

    const body = applied.json<{
      data: {
        currentPlanPriceCentavos: number;
        events: { eventType: string; fromValue: string | null; toValue: string | null }[];
      };
    }>().data;

    expect(body.currentPlanPriceCentavos).toBe(66_000);

    const rateEvent = body.events.find((event) => event.eventType === 'RATE_APPLIED');
    expect(rateEvent?.fromValue).toBe('60000');
    expect(rateEvent?.toValue).toBe('66000');
  });

  it('refuses to apply a rate the account is already on', async () => {
    const plan = await createPlan(app, admin, {
      code: 'PH-NOOP',
      serviceTypeCode: 'INTERNET',
      name: 'No-op Internet',
      monthlyFeeCentavos: 45_000,
      effectiveFrom: '2026-01-01',
    });

    const subscriber = await createSubscriber(app, admin, {
      displayName: 'No-op Customer',
      addresses: [serviceAddress('7 Purok 3')],
    });

    const account = await createServiceAccount(app, admin, {
      subscriberId: subscriber.id,
      servicePlanId: plan.id,
      activationDate: '2026-01-10',
    });

    const response = await app.inject({
      method: 'POST',
      url: `/service-accounts/${String(account.id)}/apply-rate`,
      headers: admin,
      payload: {
        effectiveDate: '2026-08-01',
        reason: 'Attempting to apply an unchanged rate.',
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { message: string } }>().error.message).toMatch(/already/i);
  });
});
