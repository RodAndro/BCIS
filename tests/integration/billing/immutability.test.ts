import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  BILLING_MONTH,
  bootBilling,
  call,
  makeBillingAccount,
  type BillingHarness,
} from '../helpers/billing';

/**
 * Immutability of posted financial records.
 *
 * ── WHY THESE ASSERTIONS GO THROUGH SQL ─────────────────────────────────────
 * The claim is "the database refuses to let a finalized invoice change". Testing
 * that through the API would only prove the API declines to try. These tests
 * issue real UPDATE and DELETE statements against real rows, so what they
 * demonstrate is the trigger — the thing that holds even when a future service
 * forgets, a migration is run by hand, or someone opens psql.
 */

let harness: BillingHarness;
let invoiceId: number;
let serviceAccountId: number;

beforeAll(async () => {
  harness = await bootBilling();

  const account = await makeBillingAccount(harness, 'Immutable Customer');
  serviceAccountId = account.accountId;

  const generated = await call(harness.app, 'POST', '/billing/generate', harness.admin, {
    month: BILLING_MONTH,
    dryRun: false,
  });
  expect(generated.status, generated.body).toBe(200);

  const invoices = await call<readonly { id: number }[]>(
    harness.app,
    'GET',
    `/invoices?serviceAccountId=${String(serviceAccountId)}&pageSize=10`,
    harness.admin,
  );

  const id = invoices.data[0]?.id;
  expect(id).toBeDefined();
  invoiceId = id ?? 0;
});

afterAll(async () => {
  await harness.app.close();
  await harness.testDatabase.close();
});

describe('a finalized invoice', () => {
  it('cannot have a total that disagrees with its parts', async () => {
    // `total_centavos` is DERIVED, so the trigger deliberately lets it move —
    // an adjustment has to move it. What stops it drifting is the CHECK that
    // ties it to subtotal − discount + penalty + adjustment + tax, and that
    // fires whatever wrote the row.
    await expect(
      harness.testDatabase.pool.query('UPDATE invoices SET total_centavos = 1 WHERE id = $1', [
        invoiceId,
      ]),
    ).rejects.toThrow(/ck_invoices_balance_identity|ck_invoices_total_identity/);
  });

  it('cannot have its dates or identity changed', async () => {
    await expect(
      harness.testDatabase.pool.query(`UPDATE invoices SET due_date = '2030-01-01' WHERE id = $1`, [
        invoiceId,
      ]),
    ).rejects.toThrow(/finalized invoice cannot be modified/i);

    await expect(
      harness.testDatabase.pool.query(
        `UPDATE invoices SET invoice_number = 'TAMPERED' WHERE id = $1`,
        [invoiceId],
      ),
    ).rejects.toThrow(/finalized invoice cannot be modified/i);
  });

  it('cannot have its components moved without a line to justify it', async () => {
    // The trigger checks subtotal, discount, penalty and adjustment against the
    // invoice_items actually attached. A total that moves on its own is refused
    // even though every CHECK constraint would still be satisfied.
    await expect(
      harness.testDatabase.pool.query(
        'UPDATE invoices SET adjustment_centavos = -1000, balance_centavos = 98900 WHERE id = $1',
        [invoiceId],
      ),
    ).rejects.toThrow(/must equal the lines attached/i);
  });

  it('cannot be deleted', async () => {
    await expect(
      harness.testDatabase.pool.query('DELETE FROM invoices WHERE id = $1', [invoiceId]),
    ).rejects.toThrow(/cannot be deleted/i);
  });

  it('cannot have its lines edited or removed', async () => {
    const items = await harness.testDatabase.pool.query<{ id: number }>(
      'SELECT id FROM invoice_items WHERE invoice_id = $1 LIMIT 1',
      [invoiceId],
    );
    const itemId = items.rows[0]?.id;

    await expect(
      harness.testDatabase.pool.query(
        'UPDATE invoice_items SET amount_centavos = 1 WHERE id = $1',
        [itemId],
      ),
    ).rejects.toThrow(/lines of a finalized invoice cannot be changed/i);

    await expect(
      harness.testDatabase.pool.query('DELETE FROM invoice_items WHERE id = $1', [itemId]),
    ).rejects.toThrow(/lines of a finalized invoice cannot be changed/i);
  });

  it('CAN still take a payment, because that is what payment posting needs', async () => {
    // Phase 5 must be able to move these three columns. Freezing them would make
    // the immutability rule unworkable rather than strict.
    const updated = await harness.testDatabase.pool.query(
      `UPDATE invoices
          SET paid_centavos = 50000, balance_centavos = 49900, status = 'PARTIALLY_PAID'
        WHERE id = $1`,
      [invoiceId],
    );

    expect(updated.rowCount).toBe(1);

    const detail = await call<{ paidCentavos: number; balanceCentavos: number; status: string }>(
      harness.app,
      'GET',
      `/invoices/${String(invoiceId)}`,
      harness.admin,
    );

    expect(detail.data.paidCentavos).toBe(50_000);
    expect(detail.data.balanceCentavos).toBe(49_900);
    expect(detail.data.status).toBe('PARTIALLY_PAID');
  });
});

describe('the ledger', () => {
  it('is append-only', async () => {
    const entries = await harness.testDatabase.pool.query<{ id: number }>(
      'SELECT id FROM ledger_entries LIMIT 1',
    );
    const entryId = entries.rows[0]?.id;

    await expect(
      harness.testDatabase.pool.query(
        'UPDATE ledger_entries SET debit_centavos = 1 WHERE id = $1',
        [entryId],
      ),
    ).rejects.toThrow(/append-only/i);

    await expect(
      harness.testDatabase.pool.query('DELETE FROM ledger_entries WHERE id = $1', [entryId]),
    ).rejects.toThrow(/append-only/i);
  });
});

describe('adjustments', () => {
  it('reduce the invoice with a credit and post a ledger credit', async () => {
    const before = await call<{ totalCentavos: number; balanceCentavos: number }>(
      harness.app,
      'GET',
      `/invoices/${String(invoiceId)}`,
      harness.admin,
    );

    const adjusted = await call<{
      totalCentavos: number;
      balanceCentavos: number;
      adjustmentCentavos: number;
      items: readonly { itemType: string; direction: string; amountCentavos: number }[];
    }>(harness.app, 'POST', `/invoices/${String(invoiceId)}/adjustments`, harness.admin, {
      adjustmentType: 'CREDIT',
      amountCentavos: 10_000,
      reasonCode: 'GOODWILL',
      memo: 'Goodwill credit after a service outage last month.',
    });

    expect(adjusted.status, adjusted.body).toBe(201);

    // The credit moved the total by exactly its amount...
    expect(adjusted.data.totalCentavos).toBe(before.data.totalCentavos - 10_000);
    expect(adjusted.data.adjustmentCentavos).toBe(-10_000);

    // ...and it is justified by a line on the invoice, which is what makes the
    // move legitimate rather than tampering.
    const adjustmentLine = adjusted.data.items.find((line) => line.itemType === 'ADJUSTMENT');
    expect(adjustmentLine?.direction).toBe('CREDIT');
    expect(adjustmentLine?.amountCentavos).toBe(10_000);

    const statement = await call<{
      entries: readonly { entryType: string; creditCentavos: number; debitCentavos: number }[];
      totalCreditCentavos: number;
      closingBalanceCentavos: number;
      totalDebitCentavos: number;
    }>(harness.app, 'GET', `/ledger/service-accounts/${String(serviceAccountId)}`, harness.admin);

    expect(statement.data.entries.some((entry) => entry.entryType === 'ADJUSTMENT')).toBe(true);
    expect(statement.data.totalCreditCentavos).toBe(10_000);
    // 99,900 charged − 10,000 credited.
    expect(statement.data.closingBalanceCentavos).toBe(89_900);
  });

  it('refuses a credit larger than the invoice rather than clamping it', async () => {
    const response = await call(
      harness.app,
      'POST',
      `/invoices/${String(invoiceId)}/adjustments`,
      harness.admin,
      {
        adjustmentType: 'CREDIT',
        amountCentavos: 5_000_000,
        reasonCode: 'GOODWILL',
        memo: 'A credit far larger than the invoice, which must be refused.',
      },
    );

    expect(response.status).toBe(422);
    expect(response.body).toMatch(/larger than the invoice/i);
  });

  it('cannot be changed after it is posted', async () => {
    const rows = await harness.testDatabase.pool.query<{ id: number }>(
      "SELECT id FROM adjustments WHERE status = 'POSTED' LIMIT 1",
    );
    const adjustmentId = rows.rows[0]?.id;

    await expect(
      harness.testDatabase.pool.query('UPDATE adjustments SET amount_centavos = 1 WHERE id = $1', [
        adjustmentId,
      ]),
    ).rejects.toThrow(/posted adjustment cannot be changed/i);
  });
});

describe('voiding an invoice', () => {
  it('reverses the ledger instead of erasing the charge', async () => {
    // A fresh account: the invoice in the tests above now carries a payment, and
    // voiding a paid invoice is refused for a different and correct reason.
    const account = await makeBillingAccount(harness, 'Void Customer');

    const generated = await call(harness.app, 'POST', '/billing/generate', harness.admin, {
      month: '2026-05',
      dryRun: false,
    });
    expect(generated.status, generated.body).toBe(200);

    const found = await call<readonly { id: number; invoiceNumber: string }[]>(
      harness.app,
      'GET',
      `/invoices?serviceAccountId=${String(account.accountId)}&month=2026-05`,
      harness.admin,
    );

    const target = found.data[0];
    expect(target).toBeDefined();

    const voided = await call<{ status: string; invoiceNumber: string; voidReason: string | null }>(
      harness.app,
      'POST',
      `/invoices/${String(target?.id ?? 0)}/void`,
      harness.admin,
      { reason: 'Billed in error; the account was not active in that period.' },
    );

    expect(voided.status, voided.body).toBe(200);
    expect(voided.data.status).toBe('VOID');
    expect(voided.data.voidReason).not.toBeNull();
    // The number is preserved, not reused.
    expect(voided.data.invoiceNumber).toBe(target?.invoiceNumber);

    // The invoice is still there, with its lines.
    const detail = await call<{ totalCentavos: number; items: readonly unknown[] }>(
      harness.app,
      'GET',
      `/invoices/${String(target?.id ?? 0)}`,
      harness.admin,
    );

    expect(detail.data.totalCentavos).toBe(99_900);
    expect(detail.data.items.length).toBeGreaterThan(0);

    // The ledger nets to zero: the original debit plus a reversal credit.
    const statement = await call<{
      entries: readonly { entryType: string; debitCentavos: number; creditCentavos: number }[];
      totalDebitCentavos: number;
      totalCreditCentavos: number;
      closingBalanceCentavos: number;
    }>(harness.app, 'GET', `/ledger/service-accounts/${String(account.accountId)}`, harness.admin);

    expect(statement.data.entries.some((entry) => entry.entryType === 'REVERSAL')).toBe(true);
    expect(statement.data.totalDebitCentavos).toBe(99_900);
    expect(statement.data.totalCreditCentavos).toBe(99_900);
    expect(statement.data.closingBalanceCentavos).toBe(0);
  });

  it('refuses to void an invoice that has payments applied', async () => {
    // The invoice above was paid 50,000 by the payment-posting test. Voiding it
    // would leave the ledger showing money received against nothing.
    const response = await call(
      harness.app,
      'POST',
      `/invoices/${String(invoiceId)}/void`,
      harness.admin,
      { reason: 'Attempting to void an invoice that carries a payment.' },
    );

    expect(response.status).toBe(409);
    expect(response.body).toMatch(/reverse the payments/i);
  });
});
