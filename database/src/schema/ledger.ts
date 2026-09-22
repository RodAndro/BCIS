import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { subscribers } from './subscribers';
import { serviceAccounts } from './service-accounts';

const id = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();

/**
 * The subscriber ledger.
 *
 * ── WHY THERE IS NO BALANCE COLUMN ──────────────────────────────────────────
 * This is the single most important design decision in the billing engine.
 *
 * A stored balance is a second source of truth: it agrees with the entries
 * until the day a posting fails halfway, a migration backfills it wrongly, or
 * two concurrent postings each read the old value. At that point the balance is
 * wrong and nothing can say what it should have been, because the number that
 * would have told you is the number that is wrong.
 *
 * Instead every row is an immutable fact — this much was debited, or this much
 * was credited — and the running balance is DERIVED:
 *
 *   SUM(debit_centavos) OVER (PARTITION BY service_account_id ORDER BY entry_date, id)
 *   - SUM(credit_centavos) OVER (same window)
 *
 * Recomputing from the entries gives the same answer every time, for every
 * account, in every year. That is what "reproducible" means here, and it is why
 * `balance_centavos` appears nowhere in this table. `docs/business-rules.md`
 * INV-3 states it as an invariant.
 *
 * ── SIGN CONVENTION (CLAUDE.md §2) ──────────────────────────────────────────
 * Debits increase what the customer owes; credits reduce it. A positive running
 * balance means the customer owes money; a negative one means the customer has
 * credit. Getting this backwards makes every screen and report read wrong, so
 * it is asserted by tests rather than left to this comment.
 *
 * ── IDEMPOTENT POSTING ──────────────────────────────────────────────────────
 * `uq_ledger_source` on `(source_type, source_id, entry_type)` means replaying
 * the same source document cannot double-post. A retried request, a re-run job,
 * or a bug that calls post twice produces a constraint violation instead of a
 * doubled balance — INV-7.
 *
 * The table is append-only: a trigger in the migration rejects UPDATE and
 * DELETE, so a correction is a new reversing entry, never an edit.
 */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: id(),

    serviceAccountId: bigint('service_account_id', { mode: 'number' })
      .notNull()
      .references(() => serviceAccounts.id, { onDelete: 'restrict' }),
    subscriberId: bigint('subscriber_id', { mode: 'number' })
      .notNull()
      .references(() => subscribers.id, { onDelete: 'restrict' }),

    /** The business date the entry falls on — a calendar date, not an instant. */
    entryDate: date('entry_date').notNull(),

    entryType: text('entry_type').notNull(),
    /** The document that caused this entry, e.g. `invoice` or `adjustment`. */
    sourceType: text('source_type').notNull(),
    sourceId: bigint('source_id', { mode: 'number' }).notNull(),
    /** Human-facing reference, e.g. `INV-2026-000123`. */
    referenceNo: text('reference_no'),
    description: text('description').notNull(),

    debitCentavos: bigint('debit_centavos', { mode: 'number' }).notNull().default(0),
    creditCentavos: bigint('credit_centavos', { mode: 'number' }).notNull().default(0),

    actorUserId: bigint('actor_user_id', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_ledger_source').on(table.sourceType, table.sourceId, table.entryType),
    // The window function's ordering. Without it, computing a balance over a
    // large account degenerates into a sort of the whole table.
    index('ix_ledger_account_date').on(table.serviceAccountId, table.entryDate, table.id),
    index('ix_ledger_subscriber_date').on(table.subscriberId, table.entryDate, table.id),
    index('ix_ledger_entry_type').on(table.entryType),
    index('ix_ledger_entry_date').on(table.entryDate),

    check(
      'ck_ledger_entry_type',
      sql`${table.entryType} IN ('INVOICE', 'PAYMENT', 'ADJUSTMENT', 'REVERSAL', 'CREDIT_APPLIED', 'CREDIT_ISSUED')`,
    ),
    check(
      'ck_ledger_amounts_non_negative',
      sql`${table.debitCentavos} >= 0 AND ${table.creditCentavos} >= 0`,
    ),
    /**
     * Exactly one side is non-zero.
     *
     * A row with both sides set is ambiguous, and a row with neither is noise
     * that makes every sum harder to read. A zero-value event belongs in
     * `service_events` or `audit_logs`, not in a ledger.
     */
    check(
      'ck_ledger_exactly_one_side',
      sql`(${table.debitCentavos} > 0 AND ${table.creditCentavos} = 0)
          OR (${table.creditCentavos} > 0 AND ${table.debitCentavos} = 0)`,
    ),
    check('ck_ledger_source_id_positive', sql`${table.sourceId} > 0`),
  ],
);
