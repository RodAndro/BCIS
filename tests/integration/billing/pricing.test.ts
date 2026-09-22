import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createPlan,
  createServiceAccount,
  createSubscriber,
  serviceAddress,
} from '../helpers/catalog';
import {
  BILLING_MONTH,
  bootBilling,
  call,
  makeBillingAccount,
  type BillingHarness,
} from '../helpers/billing';

/**
 * What a customer is charged.
 *
 * ── THE RULE THIS FILE EXISTS FOR ───────────────────────────────────────────
 * An account is charged the rate it was activated at. A plan price change —
 * which Phase 3 deliberately implements as a NEW version rather than an edit —
 * must not reach into an invoice that already exists, and must not silently
 * reprice an account that is already running.
 *
 * The ledger is the authoritative record, so the assertions are made against
 * the invoice's own lines and against the ledger rather than against a screen.
 */

interface InvoiceLine {
  readonly itemType: string;
  readonly direction: string;
  readonly unitPriceCentavos: number;
  readonly amountCentavos: number;
}

interface InvoiceDetail {
  readonly id: number;
  readonly invoiceNumber: string;
  readonly subtotalCentavos: number;
  readonly totalCentavos: number;
  readonly items: readonly InvoiceLine[];
}

let harness: BillingHarness;

beforeAll(async () => {
  harness = await bootBilling();
});

afterAll(async () => {
  await harness.app.close();
  await harness.testDatabase.close();
});

async function generate(month: string): Promise<void> {
  const response = await call(harness.app, 'POST', '/billing/generate', harness.admin, {
    month,
    dryRun: false,
  });
  expect(response.status, response.body).toBe(200);
}

async function invoiceForAccount(accountId: number): Promise<InvoiceDetail | undefined> {
  const list = await call<readonly { id: number }[]>(
    harness.app,
    'GET',
    `/invoices?serviceAccountId=${String(accountId)}&pageSize=50`,
    harness.admin,
  );

  const first = list.data[0];
  if (first === undefined) return undefined;

  const detail = await call<InvoiceDetail>(
    harness.app,
    'GET',
    `/invoices/${String(first.id)}`,
    harness.admin,
  );
  return detail.data;
}

describe('plan price changes do not reach backwards', () => {
  it('bills a later month at the account rate, not the plan price today', async () => {
    const account = await makeBillingAccount(harness, 'Price Preservation Customer');

    // March at the activation rate.
    await generate(BILLING_MONTH);
    const march = await invoiceForAccount(account.accountId);
    expect(march?.totalCentavos).toBe(99_900);

    // The plan goes up, effective April.
    const repriced = await call(
      harness.app,
      'POST',
      `/plans/${String(harness.plan.id)}/price`,
      harness.admin,
      {
        monthlyFeeCentavos: 129_900,
        effectiveFrom: '2026-04-01',
        reason: 'Annual rate adjustment for the preservation test.',
      },
    );
    expect(repriced.status).toBe(201);

    // April is still billed at the account's own rate.
    await generate('2026-04');

    const aprilInvoices = await call<
      readonly { billingPeriodStart: string; totalCentavos: number }[]
    >(
      harness.app,
      'GET',
      `/invoices?serviceAccountId=${String(account.accountId)}&month=2026-04`,
      harness.admin,
    );

    expect(aprilInvoices.data[0]?.totalCentavos).toBe(99_900);

    // The March invoice's line still carries the rate it was billed at.
    const marchAgain = await invoiceForAccount(account.accountId);
    const marchLine = marchAgain?.items.find((line) => line.itemType === 'SUBSCRIPTION');
    expect(marchLine?.unitPriceCentavos).toBe(99_900);
    expect(marchAgain?.totalCentavos).toBe(99_900);

    // ...while the plan itself now costs more, so the drift is visible rather
    // than silent.
    const plans = await call<readonly { monthlyFeeCentavos: number }[]>(
      harness.app,
      'GET',
      '/plans?search=BL-INT&currentOnly=true',
      harness.admin,
    );

    expect(plans.data[0]?.monthlyFeeCentavos).toBe(129_900);

    void march;
  });
});

describe('one-time fees', () => {
  it('bills the installation fee exactly once', async () => {
    const plan = await createPlan(harness.app, harness.admin, {
      code: 'BL-INSTALL',
      serviceTypeCode: 'INTERNET',
      name: 'Plan With Installation',
      monthlyFeeCentavos: 50_000,
      installationFeeCentavos: 150_000,
      effectiveFrom: '2026-01-01',
    });

    const subscriber = await createSubscriber(harness.app, harness.admin, {
      displayName: 'Installation Customer',
      addresses: [serviceAddress('1 Install Street')],
    });

    const serviceAccount = await createServiceAccount(harness.app, harness.admin, {
      subscriberId: subscriber.id,
      servicePlanId: plan.id,
      activationDate: '2026-01-05',
    });

    await generate('2026-08');

    const first = await invoiceForAccount(serviceAccount.id);
    expect(first?.items.some((line) => line.itemType === 'INSTALLATION')).toBe(true);
    expect(first?.totalCentavos).toBe(200_000);

    // A later period must not charge it again.
    await generate('2026-09');

    const later = await call<readonly { totalCentavos: number }[]>(
      harness.app,
      'GET',
      `/invoices?serviceAccountId=${String(serviceAccount.id)}&month=2026-09`,
      harness.admin,
    );

    expect(later.data[0]?.totalCentavos).toBe(50_000);
  });

  it('bills a reconnection fee when the reconnection falls in the period', async () => {
    const plan = await createPlan(harness.app, harness.admin, {
      code: 'BL-RECONNECT',
      serviceTypeCode: 'INTERNET',
      name: 'Plan With Reconnection',
      monthlyFeeCentavos: 60_000,
      reconnectionFeeCentavos: 30_000,
      effectiveFrom: '2026-01-01',
    });

    const subscriber = await createSubscriber(harness.app, harness.admin, {
      displayName: 'Reconnection Customer',
      addresses: [serviceAddress('2 Reconnect Street')],
    });

    const serviceAccount = await createServiceAccount(harness.app, harness.admin, {
      subscriberId: subscriber.id,
      servicePlanId: plan.id,
      activationDate: '2026-01-05',
    });

    // Suspend and reconnect inside October.
    await call(
      harness.app,
      'PATCH',
      `/service-accounts/${String(serviceAccount.id)}/status`,
      harness.admin,
      {
        status: 'SUSPENDED',
        effectiveDate: '2026-10-02',
        reason: 'Suspended for the reconnection test.',
      },
    );
    await call(
      harness.app,
      'PATCH',
      `/service-accounts/${String(serviceAccount.id)}/status`,
      harness.admin,
      {
        status: 'ACTIVE',
        effectiveDate: '2026-10-20',
        reason: 'Reconnected for the reconnection test.',
      },
    );

    await generate('2026-10');

    const invoice = await invoiceForAccount(serviceAccount.id);
    expect(invoice?.items.some((line) => line.itemType === 'RECONNECTION')).toBe(true);
    expect(invoice?.totalCentavos).toBe(90_000);
  });

  it('does not bill a reconnection that happened in another period', async () => {
    const plan = await createPlan(harness.app, harness.admin, {
      code: 'BL-RECONNECT-OTHER',
      serviceTypeCode: 'INTERNET',
      name: 'Reconnection Elsewhere',
      monthlyFeeCentavos: 40_000,
      reconnectionFeeCentavos: 30_000,
      effectiveFrom: '2026-01-01',
    });

    const subscriber = await createSubscriber(harness.app, harness.admin, {
      displayName: 'Quiet Customer',
      addresses: [serviceAddress('3 Quiet Street')],
    });

    const serviceAccount = await createServiceAccount(harness.app, harness.admin, {
      subscriberId: subscriber.id,
      servicePlanId: plan.id,
      activationDate: '2026-01-05',
    });

    await generate('2026-11');

    const invoice = await invoiceForAccount(serviceAccount.id);
    expect(invoice?.items.some((line) => line.itemType === 'RECONNECTION')).toBe(false);
    expect(invoice?.totalCentavos).toBe(40_000);
  });
});
