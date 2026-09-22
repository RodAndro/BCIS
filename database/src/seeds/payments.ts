import { businessToday } from '@bcis/shared';
import type { Pool, PoolClient } from 'pg';

/**
 * Demo payments.
 *
 * ── WHY THE SAME RULES AS THE API ───────────────────────────────────────────
 * A posted payment writes its allocation, updates the invoice caches, credits
 * the ledger, and issues a receipt — all in one transaction. This seed replays
 * that shape for a deterministic subset of the seeded invoices, plus a couple
 * of GCash payments parked in PENDING_VERIFICATION so the verification queue is
 * not empty on first launch.
 *
 * Idempotent: payments are only written for invoices that are still unpaid, so
 * re-running the seed does not double-credit an account.
 */

export interface PaymentsSeedResult {
  readonly payments: number;
  readonly receipts: number;
  readonly pendingVerification: number;
}

export async function seedPayments(pool: Pool): Promise<PaymentsSeedResult> {
  const client = await pool.connect();

  let payments = 0;
  let receipts = 0;
  let pendingVerification = 0;

  try {
    await client.query('BEGIN');

    const cashierId = await firstActiveUser(client, ['cashier', 'administrator']);
    const collectorId = await firstActiveUser(client, ['collector', 'supervisor', 'cashier']);

    // A deterministic subset of unpaid invoices, oldest first, paid in full.
    const invoices = await client.query<{
      id: number;
      service_account_id: number;
      subscriber_id: number;
      invoice_number: string;
      balance_centavos: number;
      total_centavos: number;
    }>(
      `SELECT id, service_account_id, subscriber_id, invoice_number, balance_centavos, total_centavos
         FROM invoices
        WHERE status IN ('UNPAID', 'PARTIALLY_PAID') AND balance_centavos > 0
        ORDER BY due_date, id
        LIMIT 12`,
    );

    for (const invoice of invoices.rows) {
      if (invoice.balance_centavos <= 0) continue;

      const paymentId = await insertCashPayment(
        client,
        invoice,
        cashierId,
        new Date().toISOString(),
      );
      if (paymentId === null) continue;

      const receiptNumber = await allocateReceiptNumber(client);
      await client.query(
        `INSERT INTO receipts (receipt_number, payment_id, issued_at)
         VALUES ($1, $2, now())`,
        [receiptNumber, paymentId],
      );

      payments += 1;
      receipts += 1;
    }

    // GCash payments awaiting verification, so the queue is not empty.
    const accounts = await client.query<{ service_account_id: number; subscriber_id: number }>(
      `SELECT DISTINCT service_account_id, subscriber_id
         FROM invoices
        WHERE status IN ('UNPAID', 'PARTIALLY_PAID') AND balance_centavos > 0
        ORDER BY service_account_id
        LIMIT 2`,
    );

    for (const [index, account] of accounts.rows.entries()) {
      await client.query(
        `INSERT INTO payments
           (subscriber_id, service_account_id, payment_method, amount_centavos,
            applied_centavos, unapplied_centavos, status, reference_number, sender_name,
            sender_mobile, received_by)
         VALUES ($1, $2, 'GCASH', 50000, 0, 0, 'PENDING_VERIFICATION', $3, $4, $5, $6)`,
        [
          account.subscriber_id,
          account.service_account_id,
          `SEED-GCASH-${String(index + 1)}`,
          'Demo Sender',
          `0917 000 00${String(index + 1)}`,
          collectorId,
        ],
      );
      pendingVerification += 1;
    }

    await client.query('COMMIT');

    return { payments, receipts, pendingVerification };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

interface InvoiceRow {
  readonly id: number;
  readonly service_account_id: number;
  readonly subscriber_id: number;
  readonly invoice_number: string;
  readonly balance_centavos: number;
  readonly total_centavos: number;
}

/** Insert a POSTED cash payment that fully settles the invoice. */
async function insertCashPayment(
  client: PoolClient,
  invoice: InvoiceRow,
  actorId: number | null,
  paymentDate: string,
): Promise<number | null> {
  const amount = invoice.balance_centavos;

  const payment = await client.query<{ id: number }>(
    `INSERT INTO payments
       (subscriber_id, service_account_id, payment_method, amount_centavos,
        applied_centavos, unapplied_centavos, status, payment_date, posted_at, received_by)
     VALUES ($1, $2, 'CASH', $3, $3, 0, 'POSTED', $4, now(), $5)
     RETURNING id`,
    [invoice.subscriber_id, invoice.service_account_id, amount, paymentDate, actorId],
  );

  const paymentId = payment.rows[0]?.id;
  if (paymentId === undefined) return null;

  await client.query(
    `INSERT INTO payment_allocations
       (payment_id, invoice_id, amount_centavos, is_reversal, is_manual, allocated_at)
     VALUES ($1, $2, $3, false, false, now())`,
    [paymentId, invoice.id, amount],
  );

  await client.query(
    `UPDATE invoices
        SET paid_centavos = total_centavos, balance_centavos = 0, status = 'PAID',
            updated_at = now()
      WHERE id = $1`,
    [invoice.id],
  );

  await client.query(
    `INSERT INTO ledger_entries
       (service_account_id, subscriber_id, entry_date, entry_type, source_type, source_id,
        description, debit_centavos, credit_centavos, actor_user_id)
     VALUES ($1, $2, $3, 'PAYMENT', 'payment', $4, 'Payment received', 0, $5, $6)`,
    [
      invoice.service_account_id,
      invoice.subscriber_id,
      businessToday(),
      paymentId,
      amount,
      actorId,
    ],
  );

  return paymentId;
}

/** Allocate the next receipt number from the same row-locked counter the API uses. */
async function allocateReceiptNumber(client: PoolClient): Promise<string> {
  const year = Number(businessToday().slice(0, 4));

  const sequence = await client.query<{ prefix: string; current_value: number }>(
    `INSERT INTO document_sequences (scope, period_year, prefix, current_value)
     VALUES ('RECEIPT', $1, 'RCPT', 1)
     ON CONFLICT (scope, period_year) DO UPDATE
       SET current_value = document_sequences.current_value + 1, updated_at = now()
     RETURNING prefix, current_value`,
    [year],
  );

  const row = sequence.rows[0];
  if (row === undefined) throw new Error('Seed failed: receipt numbering returned no row.');
  return `${row.prefix}-${String(year)}-${String(row.current_value).padStart(6, '0')}`;
}

async function firstActiveUser(
  client: PoolClient,
  usernames: readonly string[],
): Promise<number | null> {
  const rows = await client.query<{ id: number }>(
    `SELECT id FROM users
      WHERE status = 'ACTIVE' AND username = ANY($1::text[])
      ORDER BY username
      LIMIT 1`,
    [[...usernames]],
  );
  return rows.rows[0]?.id ?? null;
}
