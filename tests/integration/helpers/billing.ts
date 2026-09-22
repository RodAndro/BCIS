import type { FastifyInstance } from 'fastify';

import { buildApp } from '../../../apps/api/src/app';
import { TEST_PASSWORD, createTestUser, loginAs, seedAccess } from './auth';
import {
  createPlan,
  createServiceAccount,
  createSubscriber,
  seedCollectionArea,
  seedServiceTypes,
  serviceAddress,
  type PlanFixture,
  type ServiceAccountFixture,
  type SubscriberFixture,
} from './catalog';
import { createTestDatabase, type TestDatabase } from './database';

/**
 * Billing harness.
 *
 * ── THE ONE TRICK THAT MAKES THIS WORK ──────────────────────────────────────
 * A service account is only billable for a period its service had already
 * started in. An account created "today" therefore cannot be billed for a past
 * month — which is correct, and inconvenient for a test that wants a past due
 * date to check OVERDUE.
 *
 * Every account here is therefore activated on a fixed past date, so the
 * January-onwards periods are all billable and `BILLING_MONTH` has a due date
 * comfortably in the past.
 */

/** A month whose invoices are already overdue relative to any realistic "today". */
export const BILLING_MONTH = '2026-03';

/** The activation date every fixture account uses, so past months are billable. */
export const ACTIVATION_DATE = '2026-01-05';

export const ADMIN = 'billing.admin';
export const CASHIER = 'billing.cashier';
export const AUDITOR = 'billing.auditor';

export interface BillingHarness {
  readonly testDatabase: TestDatabase;
  readonly app: FastifyInstance;
  readonly admin: Record<string, string>;
  readonly cashier: Record<string, string>;
  readonly auditor: Record<string, string>;
  readonly areaId: number;
  readonly plan: PlanFixture;
  /** A second plan, for tests that need two service types. */
  readonly cablePlan: PlanFixture;
}

export async function bootBilling(): Promise<BillingHarness> {
  const testDatabase = await createTestDatabase();
  await seedAccess(testDatabase.pool);
  await seedServiceTypes(testDatabase.pool);
  const areaId = await seedCollectionArea(testDatabase.pool, 'BL-AREA', 'Billing Test Area');

  await createTestUser(testDatabase.pool, { username: ADMIN, roleCode: 'OWNER' });
  await createTestUser(testDatabase.pool, { username: CASHIER, roleCode: 'CASHIER' });
  await createTestUser(testDatabase.pool, { username: AUDITOR, roleCode: 'ACCOUNTING_AUDITOR' });

  const app = await buildApp({ logger: false });
  await app.ready();

  const admin = await loginAs(app, ADMIN, TEST_PASSWORD);
  const cashier = await loginAs(app, CASHIER, TEST_PASSWORD);
  const auditor = await loginAs(app, AUDITOR, TEST_PASSWORD);

  const plan = await createPlan(app, admin, {
    code: 'BL-INT',
    serviceTypeCode: 'INTERNET',
    name: 'Billing Internet 100',
    monthlyFeeCentavos: 99_900,
    speedMbps: 100,
    effectiveFrom: '2026-01-01',
  });

  const cablePlan = await createPlan(app, admin, {
    code: 'BL-CAB',
    serviceTypeCode: 'CABLE',
    name: 'Billing Cable 100',
    monthlyFeeCentavos: 55_000,
    channelCount: 100,
    effectiveFrom: '2026-01-01',
  });

  return { testDatabase, app, admin, cashier, auditor, areaId, plan, cablePlan };
}

export interface BillingAccount {
  readonly subscriber: SubscriberFixture;
  readonly serviceAccount: ServiceAccountFixture;
  readonly accountId: number;
  readonly subscriberId: number;
}

/** One subscriber with one active service account, ready to be billed. */
export async function makeBillingAccount(
  harness: BillingHarness,
  name: string,
  options: {
    readonly planId?: number;
    readonly billingDay?: number;
    readonly dueDay?: number;
  } = {},
): Promise<BillingAccount> {
  const subscriber = await createSubscriber(harness.app, harness.admin, {
    displayName: name,
    collectionAreaId: harness.areaId,
    billingDay: options.billingDay ?? 5,
    dueDay: options.dueDay ?? 10,
    addresses: [serviceAddress(`${name} Street`)],
  });

  const serviceAccount = await createServiceAccount(harness.app, harness.admin, {
    subscriberId: subscriber.id,
    servicePlanId: options.planId ?? harness.plan.id,
    activationDate: ACTIVATION_DATE,
  });

  return {
    subscriber,
    serviceAccount,
    accountId: serviceAccount.id,
    subscriberId: subscriber.id,
  };
}

export interface InjectionResult<T> {
  readonly status: number;
  readonly data: T;
  readonly body: string;
}

export async function call<T>(
  app: FastifyInstance,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT',
  url: string,
  headers: Record<string, string>,
  payload?: unknown,
): Promise<InjectionResult<T>> {
  const response = await app.inject({
    method,
    url,
    headers,
    ...(payload === undefined ? {} : { payload }),
  });

  let data: unknown = null;
  try {
    const parsed = response.json<{ data?: unknown }>();
    data = parsed.data ?? parsed;
  } catch {
    data = null;
  }

  return { status: response.statusCode, data: data as T, body: response.body };
}
