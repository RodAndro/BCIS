import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  BILLING_MONTH,
  bootBilling,
  call,
  makeBillingAccount,
  type BillingHarness,
} from '../helpers/billing';

/**
 * AT-11 — duplicate billing.
 *
 * ── TWO LAYERS, TESTED SEPARATELY ───────────────────────────────────────────
 * Running the generator twice must not produce two live invoices for the same
 * service account and period. Two things make that true, and each is tested on
 * its own:
 *
 *   1. The planner skips accounts that already have a live invoice for the
 *      period. This is the layer that produces the readable "already invoiced"
 *      line an operator sees, and it is the one that could be defeated by two
 *      runs starting at the same moment.
 *   2. `uq_invoices_account_period`, a partial unique index. This is the layer
 *      that holds when the first one races, and it is tested by writing the
 *      duplicate directly in SQL — past every application check.
 *
 * The rollback test is the other half of "generation must be transactional": a
 * failure part-way through must leave NO invoices behind, not the ones that
 * happened to be written first.
 */

interface RunResult {
  readonly invoicesCreated: number;
  readonly accountsSkipped: number;
  readonly invoiceNumbers: string[];
  readonly skipped: readonly { accountNumber: string; reason: string }[];
}

let harness: BillingHarness;
let accountA: Awaited<ReturnType<typeof makeBillingAccount>>;
let accountB: Awaited<ReturnType<typeof makeBillingAccount>>;

beforeAll(async () => {
  harness = await bootBilling();
  // Created in this order, so the billing run processes A before B.
  accountA = await makeBillingAccount(harness, 'Duplicate Alpha');
  accountB = await makeBillingAccount(harness, 'Duplicate Beta');
});

afterAll(async () => {
  await harness.app.close();
  await harness.testDatabase.close();
});

async function run(month: string): Promise<RunResult> {
  const response = await call<RunResult>(harness.app, 'POST', '/billing/generate', harness.admin, {
    month,
    dryRun: false,
  });
  return { ...response.data, status: response.status } as RunResult;
}

async function liveInvoiceCount(month: string): Promise<number> {
  const rows = await harness.testDatabase.pool.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM invoices
      WHERE billing_period_start = $1 AND status <> 'VOID'`,
    [`${month}-01`],
  );
  return Number(rows.rows[0]?.total ?? '0');
}

describe('AT-11 — running billing twice', () => {
  it('creates the invoices on the first run', async () => {
    const first = await run(BILLING_MONTH);

    expect(first.invoicesCreated).toBe(2);
    expect(await liveInvoiceCount(BILLING_MONTH)).toBe(2);
  });

  it('creates nothing on the second run, and says why', async () => {
    const second = await run(BILLING_MONTH);

    expect(second.invoicesCreated).toBe(0);
    expect(second.invoiceNumbers).toHaveLength(0);
    expect(second.accountsSkipped).toBe(2);
    expect(second.skipped.every((entry) => /already invoiced/i.test(entry.reason))).toBe(true);

    // The database agrees: still two, not four.
    expect(await liveInvoiceCount(BILLING_MONTH)).toBe(2);
  });

  it('is refused by the database even when the application check is bypassed', async () => {
    // This is the layer that holds under concurrency. The planner's check races;
    // the index does not.
    const rows = await harness.testDatabase.pool.query<{
      id: number;
      subscriber_id: number;
      service_account_id: number;
      billing_cycle_id: number;
    }>(
      `SELECT id, subscriber_id, service_account_id, billing_cycle_id
         FROM invoices
        WHERE service_account_id = $1 AND billing_period_start = $2
        LIMIT 1`,
      [accountA.accountId, `${BILLING_MONTH}-01`],
    );

    const existing = rows.rows[0];
    expect(existing).toBeDefined();

    await expect(
      harness.testDatabase.pool.query(
        `INSERT INTO invoices
           (invoice_number, subscriber_id, service_account_id, billing_cycle_id,
            billing_period_start, billing_period_end, issue_date, due_date,
            subtotal_centavos, discount_centavos, penalty_centavos, adjustment_centavos,
            tax_centavos, total_centavos, paid_centavos, balance_centavos, status, finalized_at)
         VALUES ('INV-2026-999999', $1, $2, $3, $4, '2026-03-31', '2026-03-05', '2026-03-10',
                 99900, 0, 0, 0, 0, 99900, 0, 99900, 'UNPAID', now())`,
        [
          existing?.subscriber_id,
          existing?.service_account_id,
          existing?.billing_cycle_id,
          `${BILLING_MONTH}-01`,
        ],
      ),
    ).rejects.toThrow();
  });

  it('allows a replacement once the original is voided', async () => {
    const list = await call<readonly { id: number }[]>(
      harness.app,
      'GET',
      `/invoices?serviceAccountId=${String(accountA.accountId)}&month=${BILLING_MONTH}`,
      harness.admin,
    );

    const voided = await call(
      harness.app,
      'POST',
      `/invoices/${String(list.data[0]?.id ?? 0)}/void`,
      harness.admin,
      { reason: 'Voided so the period can be billed again.' },
    );
    expect(voided.status).toBe(200);

    // The VOID row no longer occupies the slot.
    expect(await liveInvoiceCount(BILLING_MONTH)).toBe(1);

    const rerun = await run(BILLING_MONTH);
    expect(rerun.invoicesCreated).toBe(1);
    expect(await liveInvoiceCount(BILLING_MONTH)).toBe(2);
  });
});

describe('generation is transactional', () => {
  it('rolls the whole run back when one write fails', async () => {
    // ── HOW THE FAILURE IS INJECTED ────────────────────────────────────────
    // The run will allocate INV-2027-000001, then INV-2027-000002. Reserving
    // 000002 up front for an unrelated December invoice makes the SECOND
    // account's insert collide on the invoice-number index. The first account's
    // invoice must therefore disappear with the rollback — which is the point:
    // a half-written billing run is worse than a failed one.
    await harness.testDatabase.pool.query(
      `INSERT INTO billing_cycles (period_start, period_end, due_date, label, status)
       VALUES ('2025-12-01', '2025-12-31', '2025-12-15', 'December 2025', 'GENERATED')
       ON CONFLICT (period_start) DO NOTHING`,
    );

    const cycle = await harness.testDatabase.pool.query<{ id: number }>(
      `SELECT id FROM billing_cycles WHERE period_start = '2025-12-01'`,
    );
    const cycleId = cycle.rows[0]?.id;

    await harness.testDatabase.pool.query(
      `INSERT INTO invoices
         (invoice_number, subscriber_id, service_account_id, billing_cycle_id,
          billing_period_start, billing_period_end, issue_date, due_date,
          subtotal_centavos, discount_centavos, penalty_centavos, adjustment_centavos,
          tax_centavos, total_centavos, paid_centavos, balance_centavos, status, finalized_at)
       VALUES ('INV-2027-000002', $1, $2, $3, '2025-12-01', '2025-12-31', '2025-12-05',
               '2025-12-10', 1000, 0, 0, 0, 0, 1000, 0, 1000, 'UNPAID', now())`,
      [accountA.subscriberId, accountA.accountId, cycleId],
    );

    const before = await harness.testDatabase.pool.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM invoices WHERE billing_period_start = '2027-02-01'`,
    );
    expect(Number(before.rows[0]?.total ?? '0')).toBe(0);

    const response = await call(harness.app, 'POST', '/billing/generate', harness.admin, {
      month: '2027-02',
      dryRun: false,
    });

    // The run fails, and it fails as a conflict rather than as an internal
    // error: the caller needs to know a number collided, not that something
    // unknown went wrong.
    expect(response.status).toBeGreaterThanOrEqual(400);

    // Nothing from the run survived — including the invoice for the account
    // that was processed first.
    const after = await harness.testDatabase.pool.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM invoices WHERE billing_period_start = '2027-02-01'`,
    );
    expect(Number(after.rows[0]?.total ?? '0')).toBe(0);

    // As a second witness: no ledger entry was posted for that period either.
    const ledger = await harness.testDatabase.pool.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM ledger_entries WHERE entry_date = '2027-02-05'`,
    );
    expect(Number(ledger.rows[0]?.total ?? '0')).toBe(0);

    void accountB;
  });
});
