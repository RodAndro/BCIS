import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { subscribers } from './subscribers';
import { serviceAccounts } from './service-accounts';

const id = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();

/**
 * Billing cycles — one row per billing period.
 *
 * `period_start` is unique, so a period cannot be opened twice. That is the
 * coarse half of duplicate-billing protection; the fine half is the partial
 * unique index on `invoices` below.
 */
export const billingCycles = pgTable(
  'billing_cycles',
  {
    id: id(),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    /** The cycle's standard due date. Per-invoice dates come from the account. */
    dueDate: date('due_date').notNull(),
    /** Human label, e.g. `September 2026`. */
    label: text('label').notNull(),

    status: text('status').notNull().default('OPEN'),
    generatedAt: timestamp('generated_at', { withTimezone: true }),
    generatedBy: bigint('generated_by', { mode: 'number' }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: bigint('created_by', { mode: 'number' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: bigint('updated_by', { mode: 'number' }),
  },
  (table) => [
    uniqueIndex('uq_billing_cycles_period').on(table.periodStart),
    index('ix_billing_cycles_status').on(table.status),
    check(
      'ck_billing_cycles_status',
      sql`${table.status} IN ('OPEN', 'GENERATING', 'GENERATED', 'CLOSED', 'LOCKED')`,
    ),
    check('ck_billing_cycles_range', sql`${table.periodEnd} >= ${table.periodStart}`),
    check('ck_billing_cycles_due', sql`${table.dueDate} >= ${table.periodStart}`),
  ],
);

/**
 * Invoices.
 *
 * ── THE FOUR CONSTRAINTS THAT CARRY THE PHASE ───────────────────────────────
 *
 * 1. `uq_invoices_account_period` — a PARTIAL unique index over
 *    `(service_account_id, billing_period_start)` excluding VOID rows. This is
 *    AT-11: a service account cannot receive two live invoices for one period,
 *    even if two operators press Generate at the same moment. An application
 *    check races; an index does not.
 *
 * 2. `ck_invoices_total_identity` — `total = subtotal − discount + penalty +
 *    adjustment + tax`. The invoice's advertised total can never disagree with
 *    the lines that produced it, including after an adjustment.
 *
 * 3. `ck_invoices_balance_identity` — `balance = total − paid`. The outstanding
 *    figure is derived from two facts already in the row rather than being a
 *    third one that can drift when a payment posts.
 *
 * 4. `ck_invoices_finalized_matches_status` — a DRAFT has no `finalized_at` and
 *    anything else does. That single flag is what the immutability trigger keys
 *    on, so it must not be able to lie.
 *
 * `adjustment_centavos` is the only SIGNED money column in the schema: it is the
 * net of debit and credit adjustments, and a credit-only invoice legitimately
 * has a negative value here. It is excluded from the non-negative check, and
 * `total_centavos` is constrained non-negative below it, so a net credit larger
 * than the invoice cannot be written at all.
 */
export const invoices = pgTable(
  'invoices',
  {
    id: id(),
    invoiceNumber: text('invoice_number').notNull(),

    subscriberId: bigint('subscriber_id', { mode: 'number' })
      .notNull()
      .references(() => subscribers.id, { onDelete: 'restrict' }),
    serviceAccountId: bigint('service_account_id', { mode: 'number' })
      .notNull()
      .references(() => serviceAccounts.id, { onDelete: 'restrict' }),
    billingCycleId: bigint('billing_cycle_id', { mode: 'number' })
      .notNull()
      .references(() => billingCycles.id, { onDelete: 'restrict' }),

    /** The duplicate-billing key, together with the service account. */
    billingPeriodStart: date('billing_period_start').notNull(),
    billingPeriodEnd: date('billing_period_end').notNull(),
    issueDate: date('issue_date').notNull(),
    dueDate: date('due_date').notNull(),

    subtotalCentavos: bigint('subtotal_centavos', { mode: 'number' }).notNull(),
    discountCentavos: bigint('discount_centavos', { mode: 'number' }).notNull().default(0),
    penaltyCentavos: bigint('penalty_centavos', { mode: 'number' }).notNull().default(0),
    /** SIGNED: net of debit and credit adjustments. */
    adjustmentCentavos: bigint('adjustment_centavos', { mode: 'number' }).notNull().default(0),
    /** VAT breakdown. Zero while plan prices are treated as VAT-inclusive. */
    taxCentavos: bigint('tax_centavos', { mode: 'number' }).notNull().default(0),

    totalCentavos: bigint('total_centavos', { mode: 'number' }).notNull(),
    /** Updated by payment posting (Phase 5). Constrained to equal total − balance. */
    paidCentavos: bigint('paid_centavos', { mode: 'number' }).notNull().default(0),
    balanceCentavos: bigint('balance_centavos', { mode: 'number' }).notNull(),

    status: text('status').notNull().default('DRAFT'),

    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
    finalizedBy: bigint('finalized_by', { mode: 'number' }),

    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: bigint('voided_by', { mode: 'number' }),
    voidReason: text('void_reason'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: bigint('created_by', { mode: 'number' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: bigint('updated_by', { mode: 'number' }),
  },
  (table) => [
    uniqueIndex('uq_invoices_invoice_number').on(table.invoiceNumber),
    uniqueIndex('uq_invoices_account_period')
      .on(table.serviceAccountId, table.billingPeriodStart)
      .where(sql`${table.status} <> 'VOID'`),
    index('ix_invoices_subscriber').on(table.subscriberId),
    index('ix_invoices_account').on(table.serviceAccountId),
    index('ix_invoices_cycle').on(table.billingCycleId),
    index('ix_invoices_status').on(table.status),
    index('ix_invoices_due').on(table.dueDate),
    index('ix_invoices_period').on(table.billingPeriodStart),

    check(
      'ck_invoices_status',
      sql`${table.status} IN ('DRAFT', 'UNPAID', 'PARTIALLY_PAID', 'PAID', 'VOID', 'CREDITED')`,
    ),
    check(
      'ck_invoices_amounts_non_negative',
      sql`${table.subtotalCentavos} >= 0
          AND ${table.discountCentavos} >= 0
          AND ${table.penaltyCentavos} >= 0
          AND ${table.taxCentavos} >= 0
          AND ${table.totalCentavos} >= 0
          AND ${table.paidCentavos} >= 0
          AND ${table.balanceCentavos} >= 0`,
    ),
    check(
      'ck_invoices_total_identity',
      sql`${table.totalCentavos} = ${table.subtotalCentavos} - ${table.discountCentavos}
          + ${table.penaltyCentavos} + ${table.adjustmentCentavos} + ${table.taxCentavos}`,
    ),
    check(
      'ck_invoices_balance_identity',
      sql`${table.balanceCentavos} = ${table.totalCentavos} - ${table.paidCentavos}`,
    ),
    check(
      'ck_invoices_period_range',
      sql`${table.billingPeriodEnd} >= ${table.billingPeriodStart}`,
    ),
    check('ck_invoices_due_after_issue', sql`${table.dueDate} >= ${table.issueDate}`),
    check(
      'ck_invoices_finalized_matches_status',
      sql`(${table.status} = 'DRAFT' AND ${table.finalizedAt} IS NULL)
          OR (${table.status} <> 'DRAFT' AND ${table.finalizedAt} IS NOT NULL)`,
    ),
    check(
      'ck_invoices_void_reason',
      sql`${table.status} <> 'VOID' OR ${table.voidReason} IS NOT NULL`,
    ),
    check('ck_invoices_paid_within_total', sql`${table.paidCentavos} <= ${table.totalCentavos}`),
  ],
);

/**
 * Invoice lines.
 *
 * ── THE SNAPSHOT THAT PRESERVES HISTORY ─────────────────────────────────────
 * `unit_price_centavos` is copied from the plan version in force when the
 * invoice was generated. Nothing joins back to `service_plans` at read time, so
 * a later price change cannot reach into a historical invoice — INV-12, and the
 * reason "the rate this customer was billed" is a fact rather than a
 * reconstruction.
 *
 * `amount_centavos` is always a positive magnitude and `direction` says which
 * way it moves the total, so "amounts are never negative" stays true for every
 * line and a credit cannot be smuggled in as a negative charge.
 */
export const invoiceItems = pgTable(
  'invoice_items',
  {
    id: id(),
    invoiceId: bigint('invoice_id', { mode: 'number' })
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),

    itemType: text('item_type').notNull(),
    direction: text('direction').notNull().default('DEBIT'),
    description: text('description').notNull(),

    quantity: integer('quantity').notNull().default(1),
    unitPriceCentavos: bigint('unit_price_centavos', { mode: 'number' }).notNull(),
    amountCentavos: bigint('amount_centavos', { mode: 'number' }).notNull(),

    /** Which plan version priced this line. Kept for traceability, never joined live. */
    servicePlanId: bigint('service_plan_id', { mode: 'number' }),
    serviceAccountId: bigint('service_account_id', { mode: 'number' }),

    sortOrder: integer('sort_order').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: bigint('created_by', { mode: 'number' }),
  },
  (table) => [
    index('ix_invoice_items_invoice').on(table.invoiceId),
    check(
      'ck_invoice_items_type',
      sql`${table.itemType} IN ('SUBSCRIPTION', 'INSTALLATION', 'RECONNECTION', 'DISCOUNT', 'PENALTY', 'ADJUSTMENT')`,
    ),
    check('ck_invoice_items_direction', sql`${table.direction} IN ('DEBIT', 'CREDIT')`),
    check(
      'ck_invoice_items_direction_matches_type',
      sql`(${table.itemType} IN ('SUBSCRIPTION', 'INSTALLATION', 'RECONNECTION', 'PENALTY')
             AND ${table.direction} = 'DEBIT')
          OR (${table.itemType} = 'DISCOUNT' AND ${table.direction} = 'CREDIT')
          OR ${table.itemType} = 'ADJUSTMENT'`,
    ),
    check(
      'ck_invoice_items_amounts_non_negative',
      sql`${table.amountCentavos} >= 0 AND ${table.unitPriceCentavos} >= 0`,
    ),
    check('ck_invoice_items_quantity', sql`${table.quantity} > 0`),
    check(
      'ck_invoice_items_amount_matches_unit',
      sql`${table.amountCentavos} = ${table.unitPriceCentavos} * ${table.quantity}`,
    ),
  ],
);

/**
 * Adjustments — the controlled way to change what an invoice says.
 *
 * A finalized invoice cannot be edited, so this is how its arithmetic changes:
 * a DEBIT raises the total, a CREDIT lowers it, and either way the change is its
 * own row with a reason and an actor.
 *
 * `invoice_item_id` points at the line the adjustment added, so the invoice and
 * the reason for its change are linked in one direction only. An adjustment
 * targets EITHER an invoice OR a service account — never both and never
 * neither — which is what the `num_nonnulls` check enforces.
 */
export const adjustments = pgTable(
  'adjustments',
  {
    id: id(),

    invoiceId: bigint('invoice_id', { mode: 'number' }).references(() => invoices.id, {
      onDelete: 'restrict',
    }),
    serviceAccountId: bigint('service_account_id', { mode: 'number' }).references(
      () => serviceAccounts.id,
      { onDelete: 'restrict' },
    ),

    adjustmentType: text('adjustment_type').notNull(),
    /** Stable reason vocabulary, e.g. `GOODWILL`, `BILLING_ERROR`. */
    reasonCode: text('reason_code').notNull(),
    /** Positive magnitude; `adjustment_type` says which side it lands on. */
    amountCentavos: bigint('amount_centavos', { mode: 'number' }).notNull(),
    memo: text('memo').notNull(),

    status: text('status').notNull().default('POSTED'),
    /** The line this adjustment added to the invoice. */
    invoiceItemId: bigint('invoice_item_id', { mode: 'number' }).references(() => invoiceItems.id, {
      onDelete: 'restrict',
    }),

    postedAt: timestamp('posted_at', { withTimezone: true }),
    approvedBy: bigint('approved_by', { mode: 'number' }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: bigint('created_by', { mode: 'number' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: bigint('updated_by', { mode: 'number' }),
  },
  (table) => [
    index('ix_adjustments_invoice').on(table.invoiceId),
    index('ix_adjustments_account').on(table.serviceAccountId),
    check('ck_adjustments_type', sql`${table.adjustmentType} IN ('DEBIT', 'CREDIT')`),
    check('ck_adjustments_status', sql`${table.status} IN ('PENDING', 'POSTED', 'VOID')`),
    check('ck_adjustments_amount_positive', sql`${table.amountCentavos} > 0`),
    check(
      'ck_adjustments_target',
      sql`num_nonnulls(${table.invoiceId}, ${table.serviceAccountId}) = 1`,
    ),
    check(
      'ck_adjustments_posted_at',
      sql`${table.status} <> 'POSTED' OR ${table.postedAt} IS NOT NULL`,
    ),
  ],
);
