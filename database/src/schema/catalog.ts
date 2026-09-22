import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

const id = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();

/**
 * Collection areas.
 *
 * ── WHY THIS LANDS IN PHASE 3 ───────────────────────────────────────────────
 * A subscriber carries a collection area, so the table has to exist before a
 * subscriber can be routed. Phase 6 owns the rest of the collection module —
 * routes, collector assignments, batches, remittance — and only then does this
 * become anything more than a lookup.
 *
 * `code` is the stable identifier that appears on a route sheet and in a
 * report; `name` is what a person reads.
 */
export const collectionAreas = pgTable(
  'collection_areas',
  {
    id: id(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: bigint('created_by', { mode: 'number' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: bigint('updated_by', { mode: 'number' }),
  },
  (table) => [uniqueIndex('uq_collection_areas_code').on(table.code)],
);

/**
 * Service types — Internet, Cable, Combo.
 *
 * Kept as a table rather than a CHECK constraint because the set is expected to
 * grow (a future "Bundle" or "VOIP" type), and because the plan form needs to
 * list them with a human label.
 */
export const serviceTypes = pgTable(
  'service_types',
  {
    id: id(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_service_types_code').on(table.code),
    check('ck_service_types_code', sql`${table.code} IN ('INTERNET', 'CABLE', 'COMBO')`),
  ],
);

/**
 * Service plans — versioned by price, never edited in place.
 *
 * ── THE RULE THIS TABLE EXISTS TO ENFORCE ───────────────────────────────────
 * A price change creates a NEW ROW with a new `effective_from`; the previous
 * row is closed by setting its `effective_to`. That is what preserves the rate
 * an invoice was actually billed at: a later price change cannot reach back and
 * alter a historical figure, because the historical figure lives in a row
 * nothing writes to any more.
 *
 * Two indexes make the rule structural rather than conventional:
 *
 *   uq_service_plans_code_effective   one version per code per start date
 *   uq_service_plans_open_code        at most ONE open-ended version per code
 *
 * The second is a partial unique index. Without it, two concurrent "change the
 * price" requests would each close the old row and each insert an open one,
 * leaving a plan with two current prices — and no way to say which an account
 * should be charged.
 */
export const servicePlans = pgTable(
  'service_plans',
  {
    id: id(),
    /** Stable across versions, e.g. `INT-100`. */
    code: text('code').notNull(),
    serviceTypeId: bigint('service_type_id', { mode: 'number' })
      .notNull()
      .references(() => serviceTypes.id, { onDelete: 'restrict' }),

    name: text('name').notNull(),
    description: text('description'),

    /** Internet plans. Null for a plan that does not provide one. */
    speedMbps: integer('speed_mbps'),
    /** Cable plans. Null for a plan that does not provide one. */
    channelCount: integer('channel_count'),

    /** Integer centavos. Never a float, never a `numeric`. */
    monthlyFeeCentavos: bigint('monthly_fee_centavos', { mode: 'number' }).notNull(),
    installationFeeCentavos: bigint('installation_fee_centavos', { mode: 'number' })
      .notNull()
      .default(0),
    reconnectionFeeCentavos: bigint('reconnection_fee_centavos', { mode: 'number' })
      .notNull()
      .default(0),

    /** First business date this version applies from. */
    effectiveFrom: date('effective_from').notNull(),
    /** Last business date it applies to; null means "still current". */
    effectiveTo: date('effective_to'),

    status: text('status').notNull().default('ACTIVE'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: bigint('created_by', { mode: 'number' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: bigint('updated_by', { mode: 'number' }),
  },
  (table) => [
    uniqueIndex('uq_service_plans_code_effective').on(table.code, table.effectiveFrom),
    uniqueIndex('uq_service_plans_open_code')
      .on(table.code)
      .where(sql`${table.effectiveTo} IS NULL`),
    index('ix_service_plans_type').on(table.serviceTypeId),
    index('ix_service_plans_status').on(table.status),
    check('ck_service_plans_status', sql`${table.status} IN ('ACTIVE', 'RETIRED')`),
    check(
      'ck_service_plans_amounts_non_negative',
      sql`${table.monthlyFeeCentavos} >= 0 AND ${table.installationFeeCentavos} >= 0 AND ${table.reconnectionFeeCentavos} >= 0`,
    ),
    check('ck_service_plans_speed', sql`${table.speedMbps} IS NULL OR ${table.speedMbps} > 0`),
    check(
      'ck_service_plans_channels',
      sql`${table.channelCount} IS NULL OR ${table.channelCount} > 0`,
    ),
    check(
      'ck_service_plans_effective_range',
      sql`${table.effectiveTo} IS NULL OR ${table.effectiveTo} >= ${table.effectiveFrom}`,
    ),
  ],
);

/**
 * Document numbering.
 *
 * ── WHY A ROW-LOCKED TABLE AND NOT A POSTGRES SEQUENCE ──────────────────────
 * Read with `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` inside the same
 * transaction as the document it numbers, so the value is gapless: a rolled
 * back transaction rolls the counter back with it. A native `SEQUENCE` is
 * faster but leaves gaps, which is acceptable for a subscriber number and NOT
 * acceptable for a receipt, where §11 requires voided numbers to be reserved
 * rather than reused.
 *
 * `period_year` is 0 for scopes that are not year-scoped (subscriber and
 * service-account numbers) and the business year for those that are
 * (invoices and receipts, from Phase 4).
 */
export const documentSequences = pgTable(
  'document_sequences',
  {
    scope: text('scope').notNull(),
    periodYear: integer('period_year').notNull(),
    prefix: text('prefix').notNull(),
    currentValue: bigint('current_value', { mode: 'number' }).notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Composite primary key: one counter per scope per year. A primary key is
    // used rather than a plain unique index because it is also the
    // `ON CONFLICT` target the allocator upserts against.
    primaryKey({ columns: [table.scope, table.periodYear] }),
    check('ck_document_sequences_current_value', sql`${table.currentValue} >= 0`),
  ],
);
