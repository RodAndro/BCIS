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

import { collectionAreas } from './catalog';
import { users } from './identity';
import { serviceAccounts } from './service-accounts';

const id = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();

export const collectionAssignments = pgTable(
  'collection_assignments',
  {
    id: id(),
    collectionAreaId: bigint('collection_area_id', { mode: 'number' })
      .notNull()
      .references(() => collectionAreas.id, { onDelete: 'restrict' }),
    collectorUserId: bigint('collector_user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: bigint('created_by', { mode: 'number' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: bigint('updated_by', { mode: 'number' }),
  },
  (table) => [
    index('ix_collection_assignments_area').on(table.collectionAreaId),
    index('ix_collection_assignments_collector').on(table.collectorUserId),
    uniqueIndex('uq_collection_assignments_active')
      .on(table.collectionAreaId, table.collectorUserId)
      .where(sql`${table.effectiveTo} IS NULL`),
    check(
      'ck_collection_assignments_range',
      sql`${table.effectiveTo} IS NULL OR ${table.effectiveTo} >= ${table.effectiveFrom}`,
    ),
  ],
);

export const collectionBatches = pgTable(
  'collection_batches',
  {
    id: id(),
    batchNumber: text('batch_number').notNull(),
    collectorUserId: bigint('collector_user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    collectionAreaId: bigint('collection_area_id', { mode: 'number' })
      .notNull()
      .references(() => collectionAreas.id, { onDelete: 'restrict' }),
    batchDate: date('batch_date').notNull(),
    status: text('status').notNull().default('OPEN'),
    expectedReceivableCentavos: bigint('expected_receivable_centavos', { mode: 'number' })
      .notNull()
      .default(0),
    cashCollectedCentavos: bigint('cash_collected_centavos', { mode: 'number' })
      .notNull()
      .default(0),
    nonCashCollectedCentavos: bigint('non_cash_collected_centavos', { mode: 'number' })
      .notNull()
      .default(0),
    uncollectedCentavos: bigint('uncollected_centavos', { mode: 'number' }).notNull().default(0),
    remittedCashCentavos: bigint('remitted_cash_centavos', { mode: 'number' }).notNull().default(0),
    shortageCentavos: bigint('shortage_centavos', { mode: 'number' }).notNull().default(0),
    overageCentavos: bigint('overage_centavos', { mode: 'number' }).notNull().default(0),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    reconciledAt: timestamp('reconciled_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: bigint('created_by', { mode: 'number' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: bigint('updated_by', { mode: 'number' }),
  },
  (table) => [
    uniqueIndex('uq_collection_batches_number').on(table.batchNumber),
    index('ix_collection_batches_collector').on(table.collectorUserId),
    index('ix_collection_batches_area').on(table.collectionAreaId),
    index('ix_collection_batches_status').on(table.status),
    index('ix_collection_batches_date').on(table.batchDate),
    check(
      'ck_collection_batches_status',
      sql`${table.status} IN ('OPEN', 'IN_PROGRESS', 'SUBMITTED', 'REMITTED', 'RECONCILED', 'CLOSED')`,
    ),
    check(
      'ck_collection_batches_non_negative',
      sql`${table.expectedReceivableCentavos} >= 0
        AND ${table.cashCollectedCentavos} >= 0
        AND ${table.nonCashCollectedCentavos} >= 0
        AND ${table.uncollectedCentavos} >= 0
        AND ${table.remittedCashCentavos} >= 0
        AND ${table.shortageCentavos} >= 0
        AND ${table.overageCentavos} >= 0`,
    ),
  ],
);

export const collectionBatchAccounts = pgTable(
  'collection_batch_accounts',
  {
    id: id(),
    batchId: bigint('batch_id', { mode: 'number' })
      .notNull()
      .references(() => collectionBatches.id, { onDelete: 'cascade' }),
    serviceAccountId: bigint('service_account_id', { mode: 'number' })
      .notNull()
      .references(() => serviceAccounts.id, { onDelete: 'restrict' }),
    expectedAmountCentavos: bigint('expected_amount_centavos', { mode: 'number' })
      .notNull()
      .default(0),
    collectedAmountCentavos: bigint('collected_amount_centavos', { mode: 'number' })
      .notNull()
      .default(0),
    outcome: text('outcome').notNull().default('COLLECTED'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: bigint('created_by', { mode: 'number' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: bigint('updated_by', { mode: 'number' }),
  },
  (table) => [
    uniqueIndex('uq_collection_batch_accounts').on(table.batchId, table.serviceAccountId),
    index('ix_collection_batch_accounts_batch').on(table.batchId),
    index('ix_collection_batch_accounts_account').on(table.serviceAccountId),
    check(
      'ck_collection_batch_accounts_outcome',
      sql`${table.outcome} IN ('COLLECTED', 'PARTIAL', 'PROMISE_TO_PAY', 'NOT_HOME', 'REFUSED', 'CLOSED')`,
    ),
    check(
      'ck_collection_batch_accounts_amounts',
      sql`${table.expectedAmountCentavos} >= 0 AND ${table.collectedAmountCentavos} >= 0`,
    ),
  ],
);

export const collectorRemittances = pgTable(
  'collector_remittances',
  {
    id: id(),
    batchId: bigint('batch_id', { mode: 'number' })
      .notNull()
      .unique()
      .references(() => collectionBatches.id, { onDelete: 'restrict' }),
    remittedCashCentavos: bigint('remitted_cash_centavos', { mode: 'number' }).notNull().default(0),
    varianceCentavos: bigint('variance_centavos', { mode: 'number' }).notNull().default(0),
    varianceType: text('variance_type').notNull().default('BALANCED'),
    remittedAt: timestamp('remitted_at', { withTimezone: true }).notNull().defaultNow(),
    receivedBy: bigint('received_by', { mode: 'number' }).references(() => users.id, {
      onDelete: 'set null',
    }),
    resolutionNotes: text('resolution_notes'),
    approvedBy: bigint('approved_by', { mode: 'number' }).references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: bigint('created_by', { mode: 'number' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: bigint('updated_by', { mode: 'number' }),
  },
  (table) => [
    index('ix_collector_remittances_batch').on(table.batchId),
    check(
      'ck_collector_remittances_variance_type',
      sql`${table.varianceType} IN ('BALANCED', 'SHORTAGE', 'OVERAGE')`,
    ),
    check(
      'ck_collector_remittances_amounts',
      sql`${table.remittedCashCentavos} >= 0 AND ${table.varianceCentavos} >= -9223372036854775807`,
    ),
  ],
);

export const collectionReconciliations = pgTable(
  'collection_reconciliations',
  {
    id: id(),
    batchId: bigint('batch_id', { mode: 'number' })
      .notNull()
      .references(() => collectionBatches.id, { onDelete: 'cascade' }),
    reconcilerUserId: bigint('reconciler_user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    reconciledAt: timestamp('reconciled_at', { withTimezone: true }).notNull().defaultNow(),
    expectedCashCentavos: bigint('expected_cash_centavos', { mode: 'number' }).notNull().default(0),
    actualCashCentavos: bigint('actual_cash_centavos', { mode: 'number' }).notNull().default(0),
    differenceCentavos: bigint('difference_centavos', { mode: 'number' }).notNull().default(0),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('ix_collection_reconciliations_batch').on(table.batchId),
    index('ix_collection_reconciliations_reconciler').on(table.reconcilerUserId),
    uniqueIndex('uq_collection_reconciliations_batch').on(table.batchId),
    check(
      'ck_collection_reconciliations_amounts',
      sql`${table.expectedCashCentavos} >= 0 AND ${table.actualCashCentavos} >= 0`,
    ),
  ],
);
