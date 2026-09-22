import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { users } from './identity';
import { invoices } from './billing';
import { subscribers } from './subscribers';
import { serviceAccounts } from './service-accounts';

const id = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();

/**
 * Payments.
 *
 * ── THE ONE CONSTRAINT THAT MAKES A GCASH REFERENCE TRUSTWORTHY ─────────────
 *
 * `uq_payments_gcash_reference` is a partial unique index over the normalized
 * reference number, excluding REJECTED and REVERSED rows. Two operators
 * accepting the same GCash screenshot an hour apart would otherwise both post
 * it, the customer's balance would drop twice for one transfer, and nothing
 * would flag it — the references match, which is exactly the point.
 *
 * The index excludes rows carrying `duplicate_override_reason`, which is
 * decision A10's escape hatch: a hard block by default, and a supervisor who
 * finds a genuine coincidence (a telco reusing a reference, say) can record a
 * reason and proceed. The override needs `payment.override.duplicate_reference`
 * and writes an audit entry, so the exception is visible rather than silent.
 *
 * ── WHY THE STATUS AND THE TIMESTAMP MUST AGREE ─────────────────────────────
 *
 * A payment is either posted (money confirmed, allocations written, receipt
 * issued, ledger credited) or it is not. `ck_payments_posted_at` ties the two
 * together, so a row that claims POSTED without a posting timestamp — the shape
 * a half-finished transaction would leave — cannot be stored.
 */
export const payments = pgTable(
  'payments',
  {
    id: id(),

    subscriberId: bigint('subscriber_id', { mode: 'number' })
      .notNull()
      .references(() => subscribers.id, { onDelete: 'restrict' }),

    /**
     * The account the payment is primarily for.
     *
     * Allocations decide which accounts are credited (see `payment_allocations`);
     * this column is where the unapplied remainder — the advance — is held, and
     * it is what a receipt prints as the account paid.
     */
    serviceAccountId: bigint('service_account_id', { mode: 'number' })
      .notNull()
      .references(() => serviceAccounts.id, { onDelete: 'restrict' }),

    paymentDate: timestamp('payment_date', { withTimezone: true }).notNull().defaultNow(),

    paymentMethod: text('payment_method').notNull(),

    amountCentavos: bigint('amount_centavos', { mode: 'number' }).notNull(),
    /** Sum of the posted allocations. 0 until posted. */
    appliedCentavos: bigint('applied_centavos', { mode: 'number' }).notNull().default(0),
    /** The advance. Held against the account as a credit balance. */
    unappliedCentavos: bigint('unapplied_centavos', { mode: 'number' }).notNull().default(0),

    status: text('status').notNull().default('POSTED'),

    /** GCash / bank / cheque reference. Required for those methods. */
    referenceNumber: text('reference_number'),
    /** Who the money came from, when it is not the subscriber (GCash especially). */
    senderName: text('sender_name'),
    senderMobile: text('sender_mobile'),

    notes: text('notes'),

    /** A10's escape hatch. Set together with the audit action, never alone. */
    duplicateOverrideReason: text('duplicate_override_reason'),
    duplicateOverrideBy: bigint('duplicate_override_by', { mode: 'number' }).references(
      () => users.id,
      { onDelete: 'set null' },
    ),

    /** The actor who took the money. */
    receivedBy: bigint('received_by', { mode: 'number' }).references(() => users.id, {
      onDelete: 'set null',
    }),

    verifiedBy: bigint('verified_by', { mode: 'number' }).references(() => users.id, {
      onDelete: 'set null',
    }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),

    postedAt: timestamp('posted_at', { withTimezone: true }),
    reversedAt: timestamp('reversed_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: bigint('created_by', { mode: 'number' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: bigint('updated_by', { mode: 'number' }),
  },
  (table) => [
    index('ix_payments_subscriber').on(table.subscriberId),
    index('ix_payments_account').on(table.serviceAccountId),
    index('ix_payments_status').on(table.status),
    index('ix_payments_date').on(table.paymentDate),
    index('ix_payments_method').on(table.paymentMethod),
    index('ix_payments_reference').on(table.referenceNumber),

    /**
     * The duplicate-GCash rule, enforced by the database.
     *
     * `upper(btrim(...))` because the same reference arrives as `0012 345 678901`
     * from one cashier and `0012345678901` from another, and those are one
     * transfer.
     */
    uniqueIndex('uq_payments_gcash_reference')
      .on(sql`upper(btrim(${table.referenceNumber}))`)
      .where(
        sql`${table.paymentMethod} = 'GCASH'
            AND ${table.status} NOT IN ('REJECTED', 'REVERSED')
            AND ${table.duplicateOverrideReason} IS NULL`,
      ),

    check('ck_payments_amount_positive', sql`${table.amountCentavos} > 0`),
    check(
      'ck_payments_amounts_non_negative',
      sql`${table.appliedCentavos} >= 0 AND ${table.unappliedCentavos} >= 0`,
    ),
    /**
     * No centavo may be lost — but only once money has actually been counted.
     *
     * A payment awaiting verification is a CLAIM, not a receipt: nobody has
     * confirmed the money arrived, so nothing is applied and nothing is held,
     * and `amount_centavos` is the figure being claimed. A rejected payment is
     * in the same position — the claim was refused.
     *
     * A POSTED payment must account for every centavo, and a REVERSED one keeps
     * the split it posted with. That last part is deliberate: reversing writes
     * mirror allocation rows and never edits this payment, so `applied` stays
     * as it was and the reversal is visible in the allocations and the ledger
     * rather than by rewriting history here.
     */
    check(
      'ck_payments_amount_split',
      sql`(${table.status} IN ('PENDING_VERIFICATION', 'REJECTED')
            AND ${table.appliedCentavos} = 0 AND ${table.unappliedCentavos} = 0)
          OR (${table.status} IN ('POSTED', 'REVERSED')
            AND ${table.appliedCentavos} + ${table.unappliedCentavos} = ${table.amountCentavos})`,
    ),
    check(
      'ck_payments_status',
      sql`${table.status} IN ('PENDING_VERIFICATION', 'POSTED', 'REJECTED', 'REVERSED')`,
    ),
    check(
      'ck_payments_method',
      sql`${table.paymentMethod} IN ('CASH', 'GCASH', 'BANK_TRANSFER', 'CHEQUE', 'OTHER')`,
    ),
    check(
      'ck_payments_posted_at',
      sql`(${table.status} IN ('PENDING_VERIFICATION', 'REJECTED') AND ${table.postedAt} IS NULL)
          OR (${table.status} IN ('POSTED', 'REVERSED') AND ${table.postedAt} IS NOT NULL)`,
    ),
    check(
      'ck_payments_rejected_reason',
      sql`${table.status} <> 'REJECTED' OR ${table.rejectionReason} IS NOT NULL`,
    ),
    check(
      'ck_payments_reversed_at',
      sql`${table.status} <> 'REVERSED' OR ${table.reversedAt} IS NOT NULL`,
    ),
    check(
      'ck_payments_verified_at',
      sql`${table.status} NOT IN ('POSTED', 'REVERSED')
          OR ${table.verifiedBy} IS NOT NULL
          OR ${table.paymentMethod} NOT IN ('GCASH', 'BANK_TRANSFER')`,
    ),
    check(
      'ck_payments_reference_required',
      sql`${table.paymentMethod} NOT IN ('GCASH', 'BANK_TRANSFER')
          OR (${table.referenceNumber} IS NOT NULL AND length(btrim(${table.referenceNumber})) > 0)`,
    ),
    check(
      'ck_payments_duplicate_override',
      sql`num_nonnulls(${table.duplicateOverrideReason}, ${table.duplicateOverrideBy}) IN (0, 2)`,
    ),
    check(
      'ck_payments_notes_not_blank',
      sql`${table.notes} IS NULL OR length(btrim(${table.notes})) > 0`,
    ),
  ],
);

/**
 * Receipts — one per posted payment.
 *
 * The receipt number lives here rather than on `payments`, because a receipt is
 * the document a customer holds and it has its own lifecycle: issued, then
 * possibly voided, but never renumbered and never reused. Keeping the number in
 * one place means there is exactly one uniqueness guarantee to reason about.
 *
 * `payment_id` is unique, so a payment cannot acquire a second receipt. The
 * number is allocated from `document_sequences` inside the posting transaction,
 * which is why a rolled-back posting burns no number and two concurrent
 * postings cannot share one.
 */
export const receipts = pgTable(
  'receipts',
  {
    id: id(),

    receiptNumber: text('receipt_number').notNull(),

    paymentId: bigint('payment_id', { mode: 'number' })
      .notNull()
      .references(() => payments.id, { onDelete: 'restrict' }),

    status: text('status').notNull().default('ISSUED'),

    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),

    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: bigint('voided_by', { mode: 'number' }).references(() => users.id, {
      onDelete: 'set null',
    }),
    voidReason: text('void_reason'),

    /** Incremented by the print path, so a reprint is visible. */
    printedCount: integer('printed_count').notNull().default(0),
    lastPrintedAt: timestamp('last_printed_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: bigint('created_by', { mode: 'number' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: bigint('updated_by', { mode: 'number' }),
  },
  (table) => [
    uniqueIndex('uq_receipts_number').on(table.receiptNumber),
    uniqueIndex('uq_receipts_payment').on(table.paymentId),
    index('ix_receipts_status').on(table.status),
    index('ix_receipts_issued').on(table.issuedAt),

    check('ck_receipts_status', sql`${table.status} IN ('ISSUED', 'VOID')`),
    check(
      'ck_receipts_void_reason',
      sql`${table.status} <> 'VOID' OR (${table.voidReason} IS NOT NULL AND ${table.voidedAt} IS NOT NULL)`,
    ),
    check('ck_receipts_printed_count', sql`${table.printedCount} >= 0`),
  ],
);

/**
 * Payment allocations — which invoice a payment's money was applied to.
 *
 * ── WHY THERE ARE REVERSAL ROWS INSTEAD OF DELETES ──────────────────────────
 *
 * INV-9 makes posted allocations append-only, so reversing a payment cannot
 * delete the rows that applied it. It inserts mirror rows instead: same invoice,
 * `is_reversal` set, pointing at the allocation they undo. The effective
 * allocation to an invoice is then
 *
 *     SUM(CASE WHEN is_reversal THEN -amount ELSE amount END)
 *
 * which is zero once a payment is reversed, and the original rows stay readable
 * so the receipt, the reversal, and the invoice all tell one story.
 *
 * `uq_payment_allocations_active` allows one forward allocation per
 * (payment, invoice) and lets the reversal row share the pair. The self-
 * reference is unique, so one allocation cannot be reversed twice.
 */
export const paymentAllocations = pgTable(
  'payment_allocations',
  {
    id: id(),

    paymentId: bigint('payment_id', { mode: 'number' })
      .notNull()
      .references(() => payments.id, { onDelete: 'restrict' }),

    invoiceId: bigint('invoice_id', { mode: 'number' })
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),

    amountCentavos: bigint('amount_centavos', { mode: 'number' }).notNull(),

    isReversal: boolean('is_reversal').notNull().default(false),
    reversesAllocationId: bigint('reverses_allocation_id', { mode: 'number' }).references(
      (): AnyPgColumn => paymentAllocations.id,
      { onDelete: 'restrict' },
    ),

    /** True when a person chose the invoice instead of the oldest-first rule. */
    isManual: boolean('is_manual').notNull().default(false),

    allocatedAt: timestamp('allocated_at', { withTimezone: true }).notNull().defaultNow(),
    allocatedBy: bigint('allocated_by', { mode: 'number' }),
  },
  (table) => [
    uniqueIndex('uq_payment_allocations_active')
      .on(table.paymentId, table.invoiceId)
      .where(sql`NOT ${table.isReversal}`),
    uniqueIndex('uq_payment_allocations_reversal').on(table.reversesAllocationId),
    index('ix_payment_allocations_payment').on(table.paymentId),
    index('ix_payment_allocations_invoice').on(table.invoiceId),

    check('ck_payment_allocations_amount_positive', sql`${table.amountCentavos} > 0`),
    check(
      'ck_payment_allocations_reversal_link',
      sql`${table.isReversal} = (${table.reversesAllocationId} IS NOT NULL)`,
    ),
    check(
      'ck_payment_allocations_manual_not_reversal',
      sql`NOT ${table.isManual} OR NOT ${table.isReversal}`,
    ),
  ],
);

/**
 * Payment reversals — the record of a payment being undone.
 *
 * `original_payment_id` is unique: a payment is reversed once, in full. A
 * partial reversal sounds reasonable and is a trap — it needs its own
 * allocation arithmetic, its own receipt treatment, and its own answer to
 * "what does the customer owe now", and the honest way to correct a
 * wrong-amount payment is to reverse it and take a new one. That also keeps
 * the ledger to one reversal per payment, which is what makes
 * `uq_ledger_source` able to catch a double reversal.
 */
export const paymentReversals = pgTable(
  'payment_reversals',
  {
    id: id(),

    originalPaymentId: bigint('original_payment_id', { mode: 'number' })
      .notNull()
      .references(() => payments.id, { onDelete: 'restrict' }),

    reasonCode: text('reason_code').notNull(),
    reason: text('reason').notNull(),
    amountCentavos: bigint('amount_centavos', { mode: 'number' }).notNull(),

    reversedBy: bigint('reversed_by', { mode: 'number' }).references(() => users.id, {
      onDelete: 'set null',
    }),
    reversedAt: timestamp('reversed_at', { withTimezone: true }).notNull().defaultNow(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: bigint('created_by', { mode: 'number' }),
  },
  (table) => [
    uniqueIndex('uq_payment_reversals_payment').on(table.originalPaymentId),
    index('ix_payment_reversals_date').on(table.reversedAt),

    check('ck_payment_reversals_amount_positive', sql`${table.amountCentavos} > 0`),
    check(
      'ck_payment_reversals_reason_code',
      sql`${table.reasonCode} IN ('WRONG_AMOUNT', 'WRONG_SUBSCRIBER', 'DUPLICATE_ENTRY', 'DISHONOURED_CHEQUE', 'GCASH_REVERSED', 'UNAPPLIED_IN_ERROR', 'OTHER')`,
    ),
    check('ck_payment_reversals_reason_length', sql`length(btrim(${table.reason})) >= 10`),
  ],
);

/**
 * Payment proofs — the screenshot, the deposit slip, the cheque image.
 *
 * The bytes live on disk outside the database (`storage/proofs/...`) and the row
 * holds the metadata and the SHA-256. Two reasons: a database that carries
 * megabytes of JPEGs becomes slow to back up and slow to restore, and a hash
 * lets the same screenshot attached to two different payments be visible as
 * what it is.
 *
 * ── THE POINT OF THIS TABLE ────────────────────────────────────────────────
 *
 * A proof is evidence, not a decision. Attaching one changes no balance, posts
 * nothing, and verifies nothing — the workflow still needs a person to confirm
 * the money arrived. `proofs` being separate from `payments.status` is what
 * makes that structurally true rather than a convention.
 */
export const paymentProofs = pgTable(
  'payment_proofs',
  {
    id: id(),

    paymentId: bigint('payment_id', { mode: 'number' })
      .notNull()
      .references(() => payments.id, { onDelete: 'restrict' }),

    /** Relative to the proof root, so the root can move between machines. */
    filePath: text('file_path').notNull(),
    fileSha256: text('file_sha256').notNull(),
    mimeType: text('mime_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    originalName: text('original_name').notNull(),

    uploadedBy: bigint('uploaded_by', { mode: 'number' }).references(() => users.id, {
      onDelete: 'set null',
    }),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('ix_payment_proofs_payment').on(table.paymentId),
    uniqueIndex('uq_payment_proofs_hash').on(table.paymentId, table.fileSha256),

    check('ck_payment_proofs_size', sql`${table.byteSize} > 0`),
    check(
      'ck_payment_proofs_mime',
      sql`${table.mimeType} IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')`,
    ),
    check('ck_payment_proofs_sha256', sql`length(${table.fileSha256}) = 64`),
  ],
);
