import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { servicePlans } from './catalog';
import { users } from './identity';
import { subscriberAddresses, subscribers } from './subscribers';

const id = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();

/**
 * Service accounts.
 *
 * One subscriber, many service accounts: a household may hold an Internet
 * account and a Cable account, each billed separately, each with its own
 * address and its own rate.
 *
 * ── WHY THE RATE IS SNAPSHOT HERE ───────────────────────────────────────────
 * `current_plan_price_centavos` is the rate this account is charged. It is
 * copied from the plan version in force at activation and is NOT a live join to
 * `service_plans`. That is what makes a later plan price change unable to
 * silently reprice an existing customer: the two are separate facts, and moving
 * one to the other is a deliberate, audited action (`RATE_APPLIED`).
 *
 * ── WHY THE SERVICE TYPE IS NOT A COLUMN ────────────────────────────────────
 * The service type belongs to the plan, and the plan is already referenced.
 * Storing it again here would be a second copy that can disagree with the
 * first — an account reporting "Cable" while its plan says "Internet" is a
 * reporting bug with no owner. It is resolved through the plan and returned in
 * the DTO instead.
 *
 * ── WHY THE FOREIGN KEYS REFUSE DELETION ────────────────────────────────────
 * `onDelete: 'restrict'` on both the subscriber and the plan: an account must
 * not be able to lose the customer it belongs to or the plan it is billed on.
 */
export const serviceAccounts = pgTable(
  'service_accounts',
  {
    id: id(),
    /** Unique, e.g. `SA-000123`. Allocated, never typed. */
    accountNumber: text('account_number').notNull(),

    subscriberId: bigint('subscriber_id', { mode: 'number' })
      .notNull()
      .references(() => subscribers.id, { onDelete: 'restrict' }),
    servicePlanId: bigint('service_plan_id', { mode: 'number' })
      .notNull()
      .references(() => servicePlans.id, { onDelete: 'restrict' }),

    /** Where the service is delivered. Optional: an account may be created before it. */
    installationAddressId: bigint('installation_address_id', { mode: 'number' }).references(
      () => subscriberAddresses.id,
      { onDelete: 'set null' },
    ),

    status: text('status').notNull().default('PENDING'),

    /** When the service physically went live. Null while PENDING. */
    activationDate: date('activation_date'),
    /** When billing should begin. Defaults to the activation date. */
    billingStartDate: date('billing_start_date').notNull(),

    billingDay: smallint('billing_day').notNull().default(1),
    dueDay: smallint('due_day').notNull().default(15),

    /** The rate this account is charged. See the note above. */
    currentPlanPriceCentavos: bigint('current_plan_price_centavos', { mode: 'number' }).notNull(),

    /**
     * Whether the one-time installation fee has been billed.
     *
     * ── WHY THIS IS A FLAG AND NOT A DATE COMPARISON ────────────────────────
     * "Activated during this period" looks like a sufficient test and is not: if
     * the operator starts billing a month after activation, the fee falls in a
     * period that is never generated again and is silently never charged. The
     * flag is set in the same transaction that bills it, so the fee is charged
     * exactly once, whenever the first invoice happens to be.
     */
    installationFeeCharged: boolean('installation_fee_charged').notNull().default(false),

    assignedCollectorId: bigint('assigned_collector_id', { mode: 'number' }).references(
      () => users.id,
      { onDelete: 'set null' },
    ),

    notes: text('notes'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: bigint('created_by', { mode: 'number' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: bigint('updated_by', { mode: 'number' }),
  },
  (table) => [
    uniqueIndex('uq_service_accounts_account_number').on(table.accountNumber),
    index('ix_service_accounts_subscriber').on(table.subscriberId),
    index('ix_service_accounts_plan').on(table.servicePlanId),
    index('ix_service_accounts_status').on(table.status),
    index('ix_service_accounts_collector').on(table.assignedCollectorId),
    check(
      'ck_service_accounts_status',
      sql`${table.status} IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'DISCONNECTED', 'CLOSED')`,
    ),
    check('ck_service_accounts_billing_day', sql`${table.billingDay} BETWEEN 1 AND 28`),
    check('ck_service_accounts_due_day', sql`${table.dueDay} BETWEEN 1 AND 28`),
    check('ck_service_accounts_price_non_negative', sql`${table.currentPlanPriceCentavos} >= 0`),
    // An account that is live must say when it went live; a PENDING one must
    // not pretend it did.
    check(
      'ck_service_accounts_activation',
      sql`(${table.status} = 'PENDING' AND ${table.activationDate} IS NULL)
          OR (${table.status} <> 'PENDING' AND ${table.activationDate} IS NOT NULL)`,
    ),
  ],
);

/**
 * Service history — append-only.
 *
 * ── WHY THIS IS A TABLE AND NOT COLUMNS ON THE ACCOUNT ──────────────────────
 * "When was this customer suspended, and by whom?" is asked months later, after
 * the account has been reconnected. A `suspension_date` column on a live row
 * can only answer the last one. State changes are appended here with
 * `from_value`, `to_value`, `effective_date`, actor, and reason, and the history
 * is read from here rather than reconstructed.
 *
 * A trigger in the migration rejects UPDATE and DELETE, so the history cannot
 * be rewritten — the same pattern as `audit_logs`.
 */
export const serviceEvents = pgTable(
  'service_events',
  {
    id: id(),
    serviceAccountId: bigint('service_account_id', { mode: 'number' })
      .notNull()
      .references(() => serviceAccounts.id, { onDelete: 'cascade' }),

    eventType: text('event_type').notNull(),
    /** Previous value, as text, for a state or a rate. Null when there was none. */
    fromValue: text('from_value'),
    toValue: text('to_value'),

    effectiveDate: date('effective_date').notNull(),
    reason: text('reason'),
    actorUserId: bigint('actor_user_id', { mode: 'number' }).references(() => users.id, {
      onDelete: 'set null',
    }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('ix_service_events_account').on(table.serviceAccountId),
    index('ix_service_events_effective').on(table.effectiveDate),
    index('ix_service_events_type').on(table.eventType),
    check(
      'ck_service_events_type',
      sql`${table.eventType} IN (
        'ACTIVATED', 'STATUS_CHANGED', 'PLAN_CHANGED', 'RATE_APPLIED',
        'SUSPENDED', 'RECONNECTED', 'DISCONNECTED', 'CLOSED', 'TRANSFERRED',
        'ADDRESS_CHANGED', 'COLLECTOR_CHANGED', 'NOTE'
      )`,
    ),
  ],
);

export const suspensionRecords = pgTable(
  'suspension_records',
  {
    id: id(),
    serviceAccountId: bigint('service_account_id', { mode: 'number' })
      .notNull()
      .references(() => serviceAccounts.id, { onDelete: 'restrict' }),
    reason: text('reason').notNull(),
    effectiveDate: date('effective_date').notNull(),
    approvedBy: bigint('approved_by', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: bigint('created_by', { mode: 'number' }),
  },
  (table) => [
    index('ix_suspension_records_account').on(table.serviceAccountId),
    index('ix_suspension_records_effective').on(table.effectiveDate),
  ],
);

export const reconnectionRecords = pgTable(
  'reconnection_records',
  {
    id: id(),
    serviceAccountId: bigint('service_account_id', { mode: 'number' })
      .notNull()
      .references(() => serviceAccounts.id, { onDelete: 'restrict' }),
    requestDate: date('request_date').notNull(),
    qualifyingPaymentId: bigint('qualifying_payment_id', { mode: 'number' }),
    reconnectionFeeCentavos: bigint('reconnection_fee_centavos', { mode: 'number' })
      .notNull()
      .default(0),
    technicianUserId: bigint('technician_user_id', { mode: 'number' }).references(() => users.id, {
      onDelete: 'set null',
    }),
    completionDate: date('completion_date'),
    status: text('status').notNull().default('REQUESTED'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: bigint('created_by', { mode: 'number' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: bigint('updated_by', { mode: 'number' }),
  },
  (table) => [
    index('ix_reconnection_records_account').on(table.serviceAccountId),
    index('ix_reconnection_records_status').on(table.status),
    check(
      'ck_reconnection_records_status',
      sql`${table.status} IN ('REQUESTED', 'APPROVED', 'SCHEDULED', 'COMPLETED', 'CANCELLED')`,
    ),
    check('ck_reconnection_records_fee_non_negative', sql`${table.reconnectionFeeCentavos} >= 0`),
    check(
      'ck_reconnection_records_completion',
      sql`${table.status} <> 'COMPLETED' OR ${table.completionDate} IS NOT NULL`,
    ),
  ],
);
