import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  BILLING_MONTH,
  bootBilling,
  call,
  makeBillingAccount,
  type BillingHarness,
} from '../helpers/billing';

/**
 * Payments.
 *
 * ── WHAT THIS FILE IS CHECKING ──────────────────────────────────────────────
 * Not "does POST /payments return 201". It checks the money: a cash payment
 * posts immediately and settles the oldest invoice, a GCash payment parks in
 * PENDING_VERIFICATION until approved, a reversal undoes a posted payment, and
 * a role without `payment.reverse` is refused.
 */

interface PaymentData {
  readonly id: number;
  readonly receiptNumber: string | null;
  readonly status: string;
  readonly amountCentavos: number;
  readonly appliedCentavos: number;
  readonly unappliedCentavos: number;
}

interface InvoiceData {
  readonly id: number;
  readonly status: string;
  readonly paidCentavos: number;
  readonly balanceCentavos: number;
  readonly serviceAccountId: number;
}

interface StatementData {
  readonly entries: readonly {
    readonly entryType: string;
    readonly debitCentavos: number;
    readonly creditCentavos: number;
  }[];
  readonly closingBalanceCentavos: number;
}

let harness: BillingHarness;

beforeAll(async () => {
  harness = await bootBilling();
});

afterAll(async () => {
  await harness.app.close();
  await harness.testDatabase.close();
});

async function generateInvoice(subscriberId: number, serviceAccountId: number): Promise<InvoiceData> {
  await call(harness.app, 'POST', '/billing/generate', harness.admin, {
    month: BILLING_MONTH,
    dryRun: false,
  });

  const response = await call<readonly InvoiceData[]>(
    harness.app,
    'GET',
    `/invoices?serviceAccountId=${String(serviceAccountId)}&pageSize=50`,
    harness.admin,
  );
  const invoice = response.data[0];
  if (invoice === undefined) throw new Error('Expected an invoice to be generated.');
  return invoice;
}

async function capture(
  headers: Record<string, string>,
  subscriberId: number,
  serviceAccountId: number,
  paymentMethod: string,
  amountCentavos: number,
  extra: Record<string, unknown> = {},
) {
  return call<PaymentData>(harness.app, 'POST', '/payments', headers, {
    subscriberId,
    serviceAccountId,
    paymentMethod,
    amountCentavos,
    ...extra,
  });
}

describe('cash payments', () => {
  it('posts immediately, settles the invoice, issues a receipt, and credits the ledger', async () => {
    const account = await makeBillingAccount(harness, 'Cash Payer');
    const invoice = await generateInvoice(account.subscriberId, account.accountId);

    const payment = await capture(
      harness.cashier,
      account.subscriberId,
      account.accountId,
      'CASH',
      invoice.balanceCentavos,
    );

    expect(payment.status, payment.body).toBe(201);
    expect(payment.data.status).toBe('POSTED');
    expect(payment.data.appliedCentavos).toBe(99_900);
    expect(payment.data.unappliedCentavos).toBe(0);
    expect(payment.data.receiptNumber).toMatch(/^RCPT-\d{4}-\d{6}$/);

    const after = await call<InvoiceData>(
      harness.app,
      'GET',
      `/invoices/${String(invoice.id)}`,
      harness.admin,
    );
    expect(after.data.status).toBe('PAID');
    expect(after.data.paidCentavos).toBe(99_900);
    expect(after.data.balanceCentavos).toBe(0);

    const statement = await call<StatementData>(
      harness.app,
      'GET',
      `/ledger/service-accounts/${String(account.accountId)}`,
      harness.admin,
    );
    const paymentEntry = statement.data.entries.find((entry) => entry.entryType === 'PAYMENT');
    expect(paymentEntry?.creditCentavos).toBe(99_900);
    expect(statement.data.closingBalanceCentavos).toBe(0);
  });

  it('holds the excess as unapplied credit (advance payment)', async () => {
    const account = await makeBillingAccount(harness, 'Advance Payer');
    await generateInvoice(account.subscriberId, account.accountId);

    const payment = await capture(
      harness.cashier,
      account.subscriberId,
      account.accountId,
      'CASH',
      150_000,
    );

    expect(payment.status).toBe(201);
    expect(payment.data.appliedCentavos).toBe(99_900);
    expect(payment.data.unappliedCentavos).toBe(50_100);
  });
});

describe('GCash payments', () => {
  it('parks in PENDING_VERIFICATION until approved, then posts', async () => {
    const account = await makeBillingAccount(harness, 'GCash Payer');
    await generateInvoice(account.subscriberId, account.accountId);

    const payment = await capture(
      harness.cashier,
      account.subscriberId,
      account.accountId,
      'GCASH',
      99_900,
      { referenceNumber: 'GCASH-REF-001', senderName: 'Sender One', senderMobile: '0917 000 0001' },
    );

    expect(payment.status).toBe(201);
    expect(payment.data.status).toBe('PENDING_VERIFICATION');
    expect(payment.data.appliedCentavos).toBe(0);

    const verify = await call<PaymentData>(
      harness.app,
      'POST',
      `/payments/${String(payment.data.id)}/verify`,
      harness.cashier,
      { approve: true },
    );
    expect(verify.status).toBe(200);
    expect(verify.data.status).toBe('POSTED');
    expect(verify.data.appliedCentavos).toBe(99_900);
  });

  it('blocks a duplicate GCash reference', async () => {
    const account = await makeBillingAccount(harness, 'Duplicate GCash Payer');
    await generateInvoice(account.subscriberId, account.accountId);

    const first = await capture(
      harness.cashier,
      account.subscriberId,
      account.accountId,
      'GCASH',
      99_900,
      { referenceNumber: 'GCASH-DUP-002' },
    );
    expect(first.status).toBe(201);

    const second = await capture(
      harness.cashier,
      account.subscriberId,
      account.accountId,
      'GCASH',
      99_900,
      { referenceNumber: 'GCASH-DUP-002' },
    );
    expect(second.status).toBe(409);
  });
});

describe('reversal', () => {
  it('undoes a posted payment and refuses a role without payment.reverse', async () => {
    const account = await makeBillingAccount(harness, 'Reversal Payer');
    const invoice = await generateInvoice(account.subscriberId, account.accountId);

    const payment = await capture(
      harness.cashier,
      account.subscriberId,
      account.accountId,
      'CASH',
      invoice.balanceCentavos,
    );
    expect(payment.status).toBe(201);

    const cashierReverse = await call<PaymentData>(
      harness.app,
      'POST',
      `/payments/${String(payment.data.id)}/reverse`,
      harness.cashier,
      { reasonCode: 'WRONG_AMOUNT', reason: 'Captured the wrong amount by mistake.' },
    );
    expect(cashierReverse.status).toBe(403);

    const reverse = await call<PaymentData>(
      harness.app,
      'POST',
      `/payments/${String(payment.data.id)}/reverse`,
      harness.admin,
      { reasonCode: 'WRONG_AMOUNT', reason: 'Captured the wrong amount by mistake.' },
    );
    expect(reverse.status).toBe(200);
    expect(reverse.data.status).toBe('REVERSED');

    const after = await call<InvoiceData>(
      harness.app,
      'GET',
      `/invoices/${String(invoice.id)}`,
      harness.admin,
    );
    expect(after.data.status).toBe('UNPAID');
    expect(after.data.balanceCentavos).toBe(99_900);
  });
});
