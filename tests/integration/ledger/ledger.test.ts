import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootBilling, call, makeBillingAccount, type BillingHarness } from '../helpers/billing';

/**
 * The subscriber ledger.
 *
 * ── THE CLAIM UNDER TEST ────────────────────────────────────────────────────
 * The balance is derived, not stored. Every assertion here recomputes what the
 * balance should be from the entries and requires the API to agree — which is
 * only possible because there is no stored figure to drift.
 *
 * The ordering test matters as much as the arithmetic: the window function
 * orders by `(entry_date, id)`, so two entries on the same day still produce one
 * answer rather than whichever order the database returned rows in.
 */

interface StatementEntry {
  readonly entryDate: string;
  readonly entryType: string;
  readonly referenceNo: string | null;
  readonly debitCentavos: number;
  readonly creditCentavos: number;
  readonly balanceCentavos: number;
}

interface Statement {
  readonly entries: readonly StatementEntry[];
  readonly openingBalanceCentavos: number;
  readonly closingBalanceCentavos: number;
  readonly totalDebitCentavos: number;
  readonly totalCreditCentavos: number;
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

async function statement(accountId: number, query = ''): Promise<Statement> {
  const response = await call<Statement>(
    harness.app,
    'GET',
    `/ledger/service-accounts/${String(accountId)}${query}`,
    harness.admin,
  );
  expect(response.status, response.body).toBe(200);
  return response.data;
}

describe('the running balance', () => {
  it('accumulates across periods and is ordered oldest to newest', async () => {
    const account = await makeBillingAccount(harness, 'Ledger Customer');

    await generate('2026-03');
    await generate('2026-04');
    await generate('2026-05');

    const result = await statement(account.accountId);

    // Three debits of the account rate.
    expect(result.entries).toHaveLength(3);
    expect(result.totalDebitCentavos).toBe(299_700);
    expect(result.totalCreditCentavos).toBe(0);

    // Newest first on screen, each carrying the balance AFTER it.
    expect(result.entries[0]?.entryDate).toBe('2026-05-05');
    expect(result.entries[0]?.balanceCentavos).toBe(299_700);
    expect(result.entries[1]?.balanceCentavos).toBe(199_800);
    expect(result.entries[2]?.balanceCentavos).toBe(99_900);

    // The closing balance is exactly the sum of the debits.
    expect(result.closingBalanceCentavos).toBe(299_700);
  });

  it('carries an opening balance into a ranged statement', async () => {
    const account = await makeBillingAccount(harness, 'Ranged Customer');

    // Re-running these months bills only this new account: every other account
    // already has a live invoice for them.
    await generate('2026-03');
    await generate('2026-04');
    await generate('2026-05');

    expect((await statement(account.accountId)).entries).toHaveLength(3);

    const ranged = await statement(account.accountId, '?from=2026-04-01');

    // The March charge is carried in, not shown as a row.
    expect(ranged.openingBalanceCentavos).toBe(99_900);
    expect(ranged.entries).toHaveLength(2);
    expect(ranged.entries[0]?.balanceCentavos).toBe(299_700);
    expect(ranged.closingBalanceCentavos).toBe(299_700);
  });

  it('records a credit on the other side', async () => {
    const account = await makeBillingAccount(harness, 'Credit Customer');
    await generate('2026-06');

    const accountId = account.accountId;

    const invoices = await call<readonly { id: number }[]>(
      harness.app,
      'GET',
      `/invoices?serviceAccountId=${String(accountId)}&pageSize=10`,
      harness.admin,
    );

    const adjusted = await call(
      harness.app,
      'POST',
      `/invoices/${String(invoices.data[0]?.id ?? 0)}/adjustments`,
      harness.admin,
      {
        adjustmentType: 'CREDIT',
        amountCentavos: 30_000,
        reasonCode: 'SERVICE_OUTAGE',
        memo: 'Service was down for three days in June.',
      },
    );
    expect(adjusted.status, adjusted.body).toBe(201);

    const result = await statement(accountId);

    expect(result.entries).toHaveLength(2);
    expect(result.totalDebitCentavos).toBe(99_900);
    expect(result.totalCreditCentavos).toBe(30_000);
    expect(result.closingBalanceCentavos).toBe(69_900);
  });
});

describe('the subscriber statement', () => {
  it('spans every account the subscriber holds', async () => {
    const first = await makeBillingAccount(harness, 'Multi Account Customer');

    const second = await call<{ id: number }>(
      harness.app,
      'POST',
      '/service-accounts',
      harness.admin,
      {
        subscriberId: first.subscriberId,
        servicePlanId: harness.cablePlan.id,
        activationDate: '2026-01-05',
      },
    );
    expect(second.status).toBe(201);

    await generate('2026-06');

    const response = await call<Statement & { subscriber: { id: number } }>(
      harness.app,
      'GET',
      `/ledger/subscribers/${String(first.subscriberId)}`,
      harness.admin,
    );

    expect(response.status, response.body).toBe(200);

    // Both accounts charged in the same run: one statement, two debits.
    const debits = response.data.entries.filter((entry) => entry.debitCentavos > 0);
    expect(debits).toHaveLength(2);
    expect(response.data.closingBalanceCentavos).toBe(99_900 + 55_000);
  });
});

describe('billing made invoice numbers searchable', () => {
  it('finds the subscriber from an invoice number', async () => {
    const account = await makeBillingAccount(harness, 'Searchable Customer');
    await generate('2026-07');

    const invoices = await call<readonly { invoiceNumber: string }[]>(
      harness.app,
      'GET',
      `/invoices?serviceAccountId=${String(account.accountId)}&pageSize=10`,
      harness.admin,
    );

    const invoiceNumber = invoices.data[0]?.invoiceNumber;
    expect(invoiceNumber).toBeDefined();

    // The Phase 3 registry picked up the Phase 4 provider: the search endpoint,
    // its query, and the UI were not touched to make this work.
    const found = await call<readonly { id: number; displayName: string }[]>(
      harness.app,
      'GET',
      `/search/subscribers?q=${encodeURIComponent(String(invoiceNumber))}`,
      harness.admin,
    );

    expect(found.status).toBe(200);
    expect(found.data.some((row) => row.id === account.subscriberId)).toBe(true);

    // ...and it is advertised in the provider list the UI renders.
    const providers = await call<readonly { key: string }[]>(
      harness.app,
      'GET',
      '/search/providers',
      harness.admin,
    );

    expect(providers.data.map((provider) => provider.key)).toContain('invoice-number');
  });
});

describe('authorization', () => {
  it('lets a Cashier read a statement, because serving a customer needs it', async () => {
    const accounts = await call<readonly { id: number }[]>(
      harness.app,
      'GET',
      '/service-accounts?pageSize=1',
      harness.admin,
    );

    const response = await call(
      harness.app,
      'GET',
      `/ledger/service-accounts/${String(accounts.data[0]?.id ?? 0)}`,
      harness.cashier,
    );

    expect(response.status).toBe(200);
  });

  it('refuses an unauthenticated statement', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/ledger/service-accounts/1',
    });

    expect(response.statusCode).toBe(401);
  });

  it('refuses a Cashier generating billing', async () => {
    const response = await call(harness.app, 'POST', '/billing/generate', harness.cashier, {
      month: '2026-08',
      dryRun: true,
    });

    expect(response.status).toBe(403);
  });

  it('refuses an Auditor generating billing but allows the preview', async () => {
    const blocked = await call(harness.app, 'POST', '/billing/generate', harness.auditor, {
      month: '2026-08',
      dryRun: false,
    });
    expect(blocked.status).toBe(403);

    const preview = await call(
      harness.app,
      'GET',
      '/billing/preview?month=2026-08',
      harness.auditor,
    );
    expect(preview.status).toBe(200);
  });
});
