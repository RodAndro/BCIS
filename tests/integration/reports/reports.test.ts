import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  call,
  bootBilling,
  makeBillingAccount,
  BILLING_MONTH,
  type BillingAccount,
  type BillingHarness,
} from '../helpers/billing';

let harness: BillingHarness;
let app: FastifyInstance;
let account: BillingAccount;

beforeAll(async () => {
  harness = await bootBilling();
  app = harness.app;
  account = await makeBillingAccount(harness, 'Report Customer');
  const generated = await call(app, 'POST', '/billing/generate', harness.admin, {
    month: BILLING_MONTH,
    dryRun: false,
  });
  expect(generated.status).toBe(200);
});

afterAll(async () => {
  await app.close();
  await harness.testDatabase.close();
});

describe('Phase 8 reports', () => {
  it('returns dashboard KPIs from database aggregates', async () => {
    const response = await app.inject({ method: 'GET', url: '/dashboard', headers: harness.admin });
    expect(response.statusCode).toBe(200);
    expect(
      response.json<{ data: { currentReceivableCentavos: number; overdueAlerts: number } }>().data,
    ).toMatchObject({
      currentReceivableCentavos: 99_900,
      overdueAlerts: 1,
    });
  });

  it('returns the subscriber master report and real billing totals', async () => {
    const master = await app.inject({
      method: 'GET',
      url: '/reports?type=SUBSCRIBER_MASTER&format=json',
      headers: harness.admin,
    });
    expect(master.statusCode).toBe(200);
    expect(
      master.json<{ data: { rows: Array<{ subscriber: string }> } }>().data.rows[0]?.subscriber,
    ).toBe('Report Customer');

    const billing = await app.inject({
      method: 'GET',
      url: '/reports?type=BILLING_VS_COLLECTION&format=json',
      headers: harness.admin,
    });
    expect(billing.statusCode).toBe(200);
    expect(
      billing.json<{ data: { totals: { billedCentavos: number } } }>().data.totals.billedCentavos,
    ).toBe(99_900);

    const empty = await app.inject({
      method: 'GET',
      url: '/reports?type=DAILY_COLLECTION&format=json&from=2020-01-01&to=2020-01-01',
      headers: harness.admin,
    });
    expect(empty.statusCode).toBe(200);
    expect(empty.json<{ data: { rows: readonly unknown[] } }>().data.rows).toHaveLength(0);
  });

  it('generates XLSX and PDF exports, including an empty report', async () => {
    const xlsx = await app.inject({
      method: 'GET',
      url: '/reports/export?type=SUBSCRIBER_MASTER&format=xlsx',
      headers: harness.admin,
    });
    expect(xlsx.statusCode).toBe(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    expect(xlsx.rawPayload.subarray(0, 2).toString('hex')).toBe('504b');

    const pdf = await app.inject({
      method: 'GET',
      url: '/reports/export?type=SUBSCRIBER_MASTER&format=pdf',
      headers: harness.admin,
    });
    expect(pdf.statusCode, pdf.body).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');

    const csv = await app.inject({
      method: 'GET',
      url: '/reports/export?type=SUBSCRIBER_MASTER&format=csv',
      headers: harness.admin,
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain('Report Customer');

    const empty = await app.inject({
      method: 'GET',
      url: '/reports/export?type=VOIDED_RECEIPTS&format=xlsx&from=2020-01-01&to=2020-01-02',
      headers: harness.admin,
    });
    expect(empty.statusCode).toBe(200);
  });

  it('summarises posted payments by method and revenue by plan', async () => {
    const payment = await call<{ status: string }>(app, 'POST', '/payments', harness.cashier, {
      subscriberId: account.subscriberId,
      serviceAccountId: account.accountId,
      paymentMethod: 'CASH',
      amountCentavos: 99_900,
    });
    expect(payment.status, payment.body).toBe(201);

    const summary = await call<{
      rows: Array<{ method: string; payments: number; amountCentavos: number }>;
      totals: Record<string, number>;
    }>(app, 'GET', '/reports?type=PAYMENT_METHOD_SUMMARY&format=json', harness.admin);
    expect(summary.status).toBe(200);
    expect(summary.data.rows.find((row) => row.method === 'CASH')?.amountCentavos).toBe(99_900);
    expect(summary.data.totals.amountCentavos).toBe(99_900);

    const revenue = await call<{
      rows: Array<{
        plan: string;
        billedCentavos: number;
        collectedCentavos: number;
        outstandingCentavos: number;
      }>;
    }>(app, 'GET', '/reports?type=REVENUE_BY_PLAN&format=json', harness.admin);
    expect(revenue.status).toBe(200);
    expect(revenue.data.rows.find((row) => row.plan === 'Billing Internet 100')).toMatchObject({
      billedCentavos: 99_900,
      collectedCentavos: 99_900,
      outstandingCentavos: 0,
    });
  });
});
