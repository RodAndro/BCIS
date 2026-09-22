import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  BILLING_MONTH,
  bootBilling,
  call,
  makeBillingAccount,
  type BillingHarness,
} from '../helpers/billing';

/**
 * Billing generation.
 *
 * ── WHAT THIS FILE IS CHECKING ──────────────────────────────────────────────
 * Not "does POST /billing/generate return 200". It checks that the numbers a
 * customer is billed are the numbers the rules say: the rate the account was
 * activated at, the dates its billing day and due day imply, one ledger debit
 * for one invoice, and nothing at all for a run that was only a preview or an
 * account that is not delivering service.
 */

interface GeneratedInvoice {
  readonly id: number;
  readonly invoiceNumber: string;
  readonly issueDate: string;
  readonly dueDate: string;
  readonly subtotalCentavos: number;
  readonly totalCentavos: number;
  readonly balanceCentavos: number;
  readonly status: string;
  readonly displayStatus: string;
  readonly billingPeriodStart: string;
  readonly billingPeriodEnd: string;
}

interface RunResult {
  readonly dryRun: boolean;
  readonly invoicesCreated: number;
  readonly accountsSkipped: number;
  readonly totalCentavos: number;
  readonly invoiceNumbers: string[];
  readonly skipped: readonly { accountNumber: string; reason: string }[];
}

interface StatementEntry {
  readonly entryDate: string;
  readonly entryType: string;
  readonly referenceNo: string | null;
  readonly description: string;
  readonly debitCentavos: number;
  readonly creditCentavos: number;
  readonly balanceCentavos: number;
}

let harness: BillingHarness;

beforeAll(async () => {
  harness = await bootBilling();
});

afterAll(async () => {
  await harness.app.close();
  await harness.testDatabase.close();
});

async function invoicesFor(month: string): Promise<readonly GeneratedInvoice[]> {
  const response = await call<readonly GeneratedInvoice[]>(
    harness.app,
    'GET',
    `/invoices?month=${month}&pageSize=200`,
    harness.admin,
  );
  return response.data ?? [];
}

async function run(month: string, extra: Record<string, unknown> = {}): Promise<RunResult> {
  const response = await call<RunResult>(harness.app, 'POST', '/billing/generate', harness.admin, {
    month,
    dryRun: false,
    ...extra,
  });
  expect(response.status, response.body).toBe(200);
  return response.data;
}

describe('preview', () => {
  it('reports what a run would do without writing anything', async () => {
    const account = await makeBillingAccount(harness, 'Preview Customer');

    const preview = await call<{
      willInvoice: readonly { accountNumber: string; totalCentavos: number; dueDate: string }[];
      willSkip: readonly unknown[];
      totalCentavos: number;
    }>(harness.app, 'GET', `/billing/preview?month=${BILLING_MONTH}`, harness.admin);

    expect(preview.status).toBe(200);
    expect(preview.data.willInvoice).toHaveLength(1);
    expect(preview.data.willInvoice[0]?.accountNumber).toBe(account.serviceAccount.accountNumber);
    expect(preview.data.totalCentavos).toBe(99_900);

    // Nothing was written.
    expect(await invoicesFor(BILLING_MONTH)).toHaveLength(0);
  });
});

describe('generation', () => {
  it('creates one invoice at the account rate, with the dates the account implies', async () => {
    const result = await run(BILLING_MONTH);

    expect(result.invoicesCreated).toBe(1);
    expect(result.totalCentavos).toBe(99_900);

    const invoices = await invoicesFor(BILLING_MONTH);
    const invoice = invoices[0];

    expect(invoice?.subtotalCentavos).toBe(99_900);
    expect(invoice?.totalCentavos).toBe(99_900);
    expect(invoice?.balanceCentavos).toBe(99_900);
    expect(invoice?.status).toBe('UNPAID');
    expect(invoice?.billingPeriodStart).toBe('2026-03-01');
    expect(invoice?.billingPeriodEnd).toBe('2026-03-31');

    // The account bills on the 5th and is due on the 10th.
    expect(invoice?.issueDate).toBe('2026-03-05');
    expect(invoice?.dueDate).toBe('2026-03-10');
  });

  it('derives OVERDUE rather than storing it', async () => {
    const invoices = await invoicesFor(BILLING_MONTH);

    // The due date is long past, so the display state is OVERDUE while the
    // stored lifecycle stays UNPAID.
    expect(invoices[0]?.displayStatus).toBe('OVERDUE');
    expect(invoices[0]?.status).toBe('UNPAID');
  });

  it('numbers invoices per business year', async () => {
    const invoices = await invoicesFor(BILLING_MONTH);
    expect(invoices[0]?.invoiceNumber).toMatch(/^INV-2026-\d{6}$/);
  });

  it('adds a ledger entry for each invoice and the running balance equals the total owed', async () => {
    const invoices = await invoicesFor(BILLING_MONTH);
    const invoice = invoices[0];
    expect(invoice).toBeDefined();

    const detail = await call<{ serviceAccountId: number; invoiceNumber: string }>(
      harness.app,
      'GET',
      `/invoices/${String(invoice?.id ?? 0)}`,
      harness.admin,
    );

    const statement = await call<{
      entries: readonly StatementEntry[];
      closingBalanceCentavos: number;
      totalDebitCentavos: number;
      totalCreditCentavos: number;
    }>(
      harness.app,
      'GET',
      `/ledger/service-accounts/${String(detail.data.serviceAccountId)}`,
      harness.admin,
    );

    expect(statement.status).toBe(200);

    const entry = statement.data.entries[0];
    expect(entry?.entryType).toBe('INVOICE');
    expect(entry?.debitCentavos).toBe(99_900);
    expect(entry?.creditCentavos).toBe(0);
    expect(entry?.referenceNo).toBe(detail.data.invoiceNumber);
    expect(statement.data.totalDebitCentavos).toBe(99_900);
    expect(statement.data.totalCreditCentavos).toBe(0);
    expect(statement.data.closingBalanceCentavos).toBe(99_900);
  });

  it('does not bill a service account that is not delivering service', async () => {
    const account = await makeBillingAccount(harness, 'Suspended Customer');

    const suspend = await call(
      harness.app,
      'PATCH',
      `/service-accounts/${String(account.accountId)}/status`,
      harness.admin,
      {
        status: 'SUSPENDED',
        effectiveDate: '2026-05-01',
        reason: 'Suspended before the May run.',
      },
    );
    expect(suspend.status).toBe(200);

    const may = await run('2026-05');

    // Only the ACTIVE accounts are considered; the suspended one is not even a
    // skip, it is simply not a candidate.
    expect(may.invoicesCreated).toBe(1);
    expect((await invoicesFor('2026-05')).some((i) => i.subtotalCentavos === 99_900)).toBe(true);

    const accountInvoices = await call<readonly GeneratedInvoice[]>(
      harness.app,
      'GET',
      `/invoices?serviceAccountId=${String(account.accountId)}&pageSize=50`,
      harness.admin,
    );

    expect(accountInvoices.data).toHaveLength(0);
  });

  it('bills several accounts in one run', async () => {
    await makeBillingAccount(harness, 'June Customer One');
    await makeBillingAccount(harness, 'June Customer Two', { planId: harness.cablePlan.id });

    const june = await run('2026-06');

    expect(june.invoicesCreated).toBeGreaterThanOrEqual(2);
    // 99,900 + 55,000 from the two new accounts, plus the earlier ones.
    expect(june.totalCentavos).toBeGreaterThanOrEqual(154_900);
  });

  it('creates a draft without posting it to the ledger', async () => {
    const account = await makeBillingAccount(harness, 'Draft Customer');

    const july = await run('2026-07', { asDraft: true });
    expect(july.invoicesCreated).toBeGreaterThanOrEqual(1);

    const drafts = await call<readonly GeneratedInvoice[]>(
      harness.app,
      'GET',
      `/invoices?month=2026-07&status=DRAFT&serviceAccountId=${String(account.accountId)}`,
      harness.admin,
    );

    expect(drafts.data).toHaveLength(1);

    const statement = await call<{ entries: readonly StatementEntry[] }>(
      harness.app,
      'GET',
      `/ledger/service-accounts/${String(account.accountId)}`,
      harness.admin,
    );

    // A draft is not a posted document, so it writes nothing to the ledger.
    expect(statement.data.entries).toHaveLength(0);

    // Posting it writes the debit.
    const finalized = await call<GeneratedInvoice>(
      harness.app,
      'POST',
      `/invoices/${String(drafts.data[0]?.id ?? 0)}/finalize`,
      harness.admin,
      {},
    );

    expect(finalized.status).toBe(200);
    expect(finalized.data.status).toBe('UNPAID');

    const afterPosting = await call<{ entries: readonly StatementEntry[] }>(
      harness.app,
      'GET',
      `/ledger/service-accounts/${String(account.accountId)}`,
      harness.admin,
    );

    expect(afterPosting.data.entries).toHaveLength(1);
    expect(afterPosting.data.entries[0]?.debitCentavos).toBe(99_900);
  });
});
