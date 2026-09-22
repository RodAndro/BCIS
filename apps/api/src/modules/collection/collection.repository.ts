import { schema } from '@bcis/database';
import { and, asc, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import type { Executor, Tx } from '../../shared/database';
import type { CollectionBatchListQuery } from '@bcis/validation';

/**
 * Collection area and collector queries.
 *
 * Phase 6 owns routes, assignments, batches, and remittance. What is here is
 * what a subscriber form needs: the list of areas to route a customer into, and
 * the list of people an account could be assigned to.
 */

export interface CollectionAreaRow {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly isActive: boolean;
  readonly subscriberCount: number;
}

export interface CollectorRow {
  readonly id: number;
  readonly username: string;
  readonly fullName: string;
  readonly roles: readonly string[];
}

async function loadSubscriberCounts(
  db: Executor,
  areaIds: readonly number[],
): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  if (areaIds.length === 0) return counts;

  const rows = await db
    .select({ areaId: schema.subscribers.collectionAreaId, total: count() })
    .from(schema.subscribers)
    .where(inArray(schema.subscribers.collectionAreaId, [...areaIds]))
    .groupBy(schema.subscribers.collectionAreaId);

  for (const row of rows) {
    if (row.areaId !== null) counts.set(row.areaId, row.total);
  }
  return counts;
}

export async function listCollectionAreas(db: Executor): Promise<readonly CollectionAreaRow[]> {
  const rows = await db
    .select({
      id: schema.collectionAreas.id,
      code: schema.collectionAreas.code,
      name: schema.collectionAreas.name,
      description: schema.collectionAreas.description,
      isActive: schema.collectionAreas.isActive,
    })
    .from(schema.collectionAreas)
    .orderBy(asc(schema.collectionAreas.code));

  const counts = await loadSubscriberCounts(
    db,
    rows.map((row) => row.id),
  );

  return rows.map((row) => ({ ...row, subscriberCount: counts.get(row.id) ?? 0 }));
}

export async function findCollectionAreaById(
  db: Executor,
  areaId: number,
): Promise<CollectionAreaRow | null> {
  const areas = await listCollectionAreas(db);
  return areas.find((area) => area.id === areaId) ?? null;
}

export async function collectionAreaCodeExists(db: Executor, code: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.collectionAreas.id })
    .from(schema.collectionAreas)
    .where(eq(schema.collectionAreas.code, code))
    .limit(1);

  return rows.length > 0;
}

export async function insertCollectionArea(
  tx: Tx,
  values: {
    readonly code: string;
    readonly name: string;
    readonly description: string | null;
    readonly isActive: boolean;
    readonly createdBy: number | null;
  },
): Promise<number> {
  const rows = await tx
    .insert(schema.collectionAreas)
    .values({ ...values, updatedBy: values.createdBy })
    .returning({ id: schema.collectionAreas.id });

  const id = rows[0]?.id;
  if (id === undefined) throw new Error('Inserting a collection area returned no id.');
  return id;
}

export async function updateCollectionAreaRow(
  tx: Tx,
  areaId: number,
  values: {
    readonly name: string;
    readonly description: string | null;
    readonly isActive: boolean;
  },
  updatedBy: number | null,
): Promise<void> {
  await tx
    .update(schema.collectionAreas)
    .set({ ...values, updatedAt: new Date(), updatedBy })
    .where(eq(schema.collectionAreas.id, areaId));
}

/**
 * People who can be assigned to collect.
 *
 * ── WHY THIS IS EVERY ACTIVE USER ───────────────────────────────────────────
 * The seven roles do not include a "Collector". Who actually walks a route is
 * still an open question (roadmap A9 / Phase 6), and inventing a role here
 * would bake a guess into the permission model. The list therefore returns
 * active users WITH their roles, so the picker can show why someone is
 * available and Phase 6 can narrow it without changing this contract.
 */
export async function listCollectors(db: Executor): Promise<readonly CollectorRow[]> {
  const users = await db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      fullName: schema.users.fullName,
    })
    .from(schema.users)
    .where(eq(schema.users.status, 'ACTIVE'))
    .orderBy(asc(schema.users.fullName));

  if (users.length === 0) return [];

  const roleRows = await db
    .select({ userId: schema.userRoles.userId, roleCode: schema.roles.code })
    .from(schema.userRoles)
    .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
    .where(
      inArray(
        schema.userRoles.userId,
        users.map((user) => user.id),
      ),
    );

  const rolesByUser = new Map<number, string[]>();
  for (const row of roleRows) {
    const existing = rolesByUser.get(row.userId);
    if (existing === undefined) {
      rolesByUser.set(row.userId, [row.roleCode]);
    } else {
      existing.push(row.roleCode);
    }
  }

  return users.map((user) => ({ ...user, roles: rolesByUser.get(user.id) ?? [] }));
}

/** Whether a user exists and may be assigned work. */
export async function isAssignableUser(db: Executor, userId: number): Promise<boolean> {
  const rows = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  return rows.length > 0;
}

export interface BatchRow {
  readonly id: number;
  readonly batchNumber: string;
  readonly collectorUserId: number;
  readonly collectionAreaId: number;
  readonly batchDate: string;
  readonly status: string;
  readonly expectedReceivableCentavos: number;
  readonly cashCollectedCentavos: number;
  readonly nonCashCollectedCentavos: number;
  readonly uncollectedCentavos: number;
  readonly remittedCashCentavos: number;
  readonly shortageCentavos: number;
  readonly overageCentavos: number;
  readonly submittedAt: Date | null;
  readonly reconciledAt: Date | null;
  readonly closedAt: Date | null;
  readonly createdAt: Date;
}

export async function findBatchById(db: Executor, batchId: number): Promise<BatchRow | null> {
  const rows = await db
    .select({
      id: schema.collectionBatches.id,
      batchNumber: schema.collectionBatches.batchNumber,
      collectorUserId: schema.collectionBatches.collectorUserId,
      collectionAreaId: schema.collectionBatches.collectionAreaId,
      batchDate: schema.collectionBatches.batchDate,
      status: schema.collectionBatches.status,
      expectedReceivableCentavos: schema.collectionBatches.expectedReceivableCentavos,
      cashCollectedCentavos: schema.collectionBatches.cashCollectedCentavos,
      nonCashCollectedCentavos: schema.collectionBatches.nonCashCollectedCentavos,
      uncollectedCentavos: schema.collectionBatches.uncollectedCentavos,
      remittedCashCentavos: schema.collectionBatches.remittedCashCentavos,
      shortageCentavos: schema.collectionBatches.shortageCentavos,
      overageCentavos: schema.collectionBatches.overageCentavos,
      submittedAt: schema.collectionBatches.submittedAt,
      reconciledAt: schema.collectionBatches.reconciledAt,
      closedAt: schema.collectionBatches.closedAt,
      createdAt: schema.collectionBatches.createdAt,
    })
    .from(schema.collectionBatches)
    .where(eq(schema.collectionBatches.id, batchId))
    .limit(1);

  return rows[0] ?? null;
}

export async function remittanceExists(db: Executor, batchId: number): Promise<boolean> {
  const rows = await db
    .select({ id: schema.collectorRemittances.id })
    .from(schema.collectorRemittances)
    .where(eq(schema.collectorRemittances.batchId, batchId))
    .limit(1);

  return rows.length > 0;
}

export async function getReconciliationView(
  db: Executor,
  batchId: number,
): Promise<{
  batchId: number;
  batchStatus: string;
  remittedCashCentavos: number | null;
  varianceCentavos: number | null;
  varianceType: string | null;
  reconcilerUserId: number | null;
  reconciledAt: Date | null;
  expectedCashCentavos: number | null;
  actualCashCentavos: number | null;
  differenceCentavos: number | null;
  reason: string | null;
} | null> {
  const rows = await db
    .select({
      batchId: schema.collectionBatches.id,
      batchStatus: schema.collectionBatches.status,
      remittedCashCentavos: schema.collectorRemittances.remittedCashCentavos,
      varianceCentavos: schema.collectorRemittances.varianceCentavos,
      varianceType: schema.collectorRemittances.varianceType,
      reconcilerUserId: schema.collectionReconciliations.reconcilerUserId,
      reconciledAt: schema.collectionReconciliations.reconciledAt,
      expectedCashCentavos: schema.collectionReconciliations.expectedCashCentavos,
      actualCashCentavos: schema.collectionReconciliations.actualCashCentavos,
      differenceCentavos: schema.collectionReconciliations.differenceCentavos,
      reason: schema.collectionReconciliations.reason,
    })
    .from(schema.collectionBatches)
    .leftJoin(
      schema.collectorRemittances,
      eq(schema.collectorRemittances.batchId, schema.collectionBatches.id),
    )
    .leftJoin(
      schema.collectionReconciliations,
      eq(schema.collectionReconciliations.batchId, schema.collectionBatches.id),
    )
    .where(eq(schema.collectionBatches.id, batchId))
    .limit(1);

  return rows[0] ?? null;
}

export async function insertCollectionBatch(
  tx: Tx,
  values: {
    readonly batchNumber: string;
    readonly collectorUserId: number;
    readonly collectionAreaId: number;
    readonly batchDate: string;
    readonly status: string;
    readonly expectedReceivableCentavos: number;
    readonly cashCollectedCentavos: number;
    readonly nonCashCollectedCentavos: number;
    readonly uncollectedCentavos: number;
    readonly createdBy: number | null;
  },
): Promise<number> {
  const rows = await tx
    .insert(schema.collectionBatches)
    .values(values)
    .returning({ id: schema.collectionBatches.id });

  const id = rows[0]?.id;
  if (id === undefined) throw new Error('Inserting a collection batch returned no id.');
  return id;
}

export async function insertBatchAccount(
  tx: Tx,
  values: {
    readonly batchId: number;
    readonly serviceAccountId: number;
    readonly expectedAmountCentavos: number;
    readonly collectedAmountCentavos: number;
    readonly outcome: string;
    readonly notes: string | null;
    readonly createdBy: number | null;
  },
): Promise<void> {
  await tx.insert(schema.collectionBatchAccounts).values(values);
}

export async function listBatchRouteSheet(
  db: Executor,
  batchId: number,
): Promise<
  readonly {
    accountId: number;
    accountNumber: string;
    subscriber: string;
    address: string;
    currentBillCentavos: number;
    arrearsCentavos: number;
    totalDueCentavos: number;
    collector: string;
  }[]
> {
  const rows = await db
    .select({
      accountId: schema.serviceAccounts.id,
      accountNumber: schema.serviceAccounts.accountNumber,
      subscriber: schema.subscribers.displayName,
      currentBillCentavos: schema.serviceAccounts.currentPlanPriceCentavos,
      address: sql<string>`coalesce((
        select concat_ws(', ', address.line1, address.barangay, address.city_municipality, address.province)
        from subscriber_addresses address
        where address.subscriber_id = ${schema.subscribers.id}
          and address.address_type = 'SERVICE'
        order by address.is_primary desc, address.id asc
        limit 1
      ), 'Not provided')`,
      arrearsCentavos: sql<number>`coalesce((
        select sum(invoice.balance_centavos)
        from invoices invoice
        where invoice.subscriber_id = ${schema.subscribers.id}
          and invoice.status <> 'VOID'
          and invoice.balance_centavos > 0
      ), 0)`,
      collector: schema.users.fullName,
    })
    .from(schema.collectionBatchAccounts)
    .innerJoin(
      schema.serviceAccounts,
      eq(schema.collectionBatchAccounts.serviceAccountId, schema.serviceAccounts.id),
    )
    .innerJoin(schema.subscribers, eq(schema.serviceAccounts.subscriberId, schema.subscribers.id))
    .innerJoin(
      schema.collectionBatches,
      eq(schema.collectionBatchAccounts.batchId, schema.collectionBatches.id),
    )
    .innerJoin(schema.users, eq(schema.collectionBatches.collectorUserId, schema.users.id))
    .where(eq(schema.collectionBatchAccounts.batchId, batchId));

  return rows.map((row) => {
    const arrearsCentavos = Number(row.arrearsCentavos);
    const currentBillCentavos = row.currentBillCentavos ?? 0;

    return {
      accountId: row.accountId,
      accountNumber: row.accountNumber,
      subscriber: row.subscriber,
      address: row.address,
      currentBillCentavos,
      arrearsCentavos,
      totalDueCentavos: currentBillCentavos + arrearsCentavos,
      collector: row.collector,
    };
  });
}

export async function updateBatchStatus(
  tx: Tx,
  batchId: number,
  values: {
    readonly status: string;
    readonly remittedCashCentavos?: number;
    readonly shortageCentavos?: number;
    readonly overageCentavos?: number;
    readonly cashCollectedCentavos?: number;
    readonly nonCashCollectedCentavos?: number;
    readonly uncollectedCentavos?: number;
    readonly submittedAt?: Date | null;
    readonly reconciledAt?: Date | null;
    readonly closedAt?: Date | null;
    readonly updatedBy?: number | null;
  },
): Promise<void> {
  await tx
    .update(schema.collectionBatches)
    .set({
      status: values.status,
      ...(values.remittedCashCentavos !== undefined
        ? { remittedCashCentavos: values.remittedCashCentavos }
        : {}),
      ...(values.shortageCentavos !== undefined
        ? { shortageCentavos: values.shortageCentavos }
        : {}),
      ...(values.overageCentavos !== undefined ? { overageCentavos: values.overageCentavos } : {}),
      ...(values.cashCollectedCentavos !== undefined
        ? { cashCollectedCentavos: values.cashCollectedCentavos }
        : {}),
      ...(values.nonCashCollectedCentavos !== undefined
        ? { nonCashCollectedCentavos: values.nonCashCollectedCentavos }
        : {}),
      ...(values.uncollectedCentavos !== undefined
        ? { uncollectedCentavos: values.uncollectedCentavos }
        : {}),
      ...(values.submittedAt !== undefined ? { submittedAt: values.submittedAt } : {}),
      ...(values.reconciledAt !== undefined ? { reconciledAt: values.reconciledAt } : {}),
      ...(values.closedAt !== undefined ? { closedAt: values.closedAt } : {}),
      ...(values.updatedBy !== undefined ? { updatedBy: values.updatedBy } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.collectionBatches.id, batchId));
}

export async function insertRemittance(
  tx: Tx,
  values: {
    readonly batchId: number;
    readonly remittedCashCentavos: number;
    readonly varianceCentavos: number;
    readonly varianceType: string;
    readonly remittedAt: Date;
    readonly receivedBy: number | null;
    readonly resolutionNotes: string | null;
    readonly approvedBy: number | null;
    readonly createdBy: number | null;
  },
): Promise<void> {
  await tx.insert(schema.collectorRemittances).values(values);
}

export async function insertReconciliation(
  tx: Tx,
  values: {
    readonly batchId: number;
    readonly reconcilerUserId: number;
    readonly expectedCashCentavos: number;
    readonly actualCashCentavos: number;
    readonly differenceCentavos: number;
    readonly reason: string | null;
  },
): Promise<void> {
  await tx.insert(schema.collectionReconciliations).values(values);
}

export async function findCollectorAssignment(
  db: Executor,
  areaId: number,
  collectorUserId: number,
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.collectionAssignments.id })
    .from(schema.collectionAssignments)
    .where(
      and(
        eq(schema.collectionAssignments.collectionAreaId, areaId),
        eq(schema.collectionAssignments.collectorUserId, collectorUserId),
        sql`${schema.collectionAssignments.effectiveTo} IS NULL`,
      ),
    )
    .limit(1);

  return rows.length > 0;
}

export async function insertCollectorAssignment(
  tx: Tx,
  values: {
    readonly collectionAreaId: number;
    readonly collectorUserId: number;
    readonly effectiveFrom: string;
    readonly effectiveTo: string | null;
    readonly reason: string | null;
    readonly createdBy: number | null;
  },
): Promise<number> {
  const rows = await tx
    .insert(schema.collectionAssignments)
    .values(values)
    .returning({ id: schema.collectionAssignments.id });

  const id = rows[0]?.id;
  if (id === undefined) throw new Error('Inserting a collector assignment returned no id.');
  return id;
}

export async function serviceAccountsInArea(
  db: Executor,
  areaId: number,
): Promise<readonly number[]> {
  const rows = await db
    .select({ serviceAccountId: schema.serviceAccounts.id })
    .from(schema.serviceAccounts)
    .innerJoin(schema.subscribers, eq(schema.serviceAccounts.subscriberId, schema.subscribers.id))
    .where(eq(schema.subscribers.collectionAreaId, areaId));

  return rows.map((row) => row.serviceAccountId);
}

export async function accountInArea(
  db: Executor,
  accountId: number,
  areaId: number,
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.serviceAccounts.id })
    .from(schema.serviceAccounts)
    .innerJoin(schema.subscribers, eq(schema.serviceAccounts.subscriberId, schema.subscribers.id))
    .where(
      and(
        eq(schema.serviceAccounts.id, accountId),
        eq(schema.subscribers.collectionAreaId, areaId),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

/* ─────────────────────── Phase 6 read models ─────────────────────────────── */

export interface CollectionBatchSummaryRow extends BatchRow {
  readonly collectorName: string;
  readonly areaName: string;
}

const batchSummaryProjection = {
  id: schema.collectionBatches.id,
  batchNumber: schema.collectionBatches.batchNumber,
  collectorUserId: schema.collectionBatches.collectorUserId,
  collectorName: schema.users.fullName,
  collectionAreaId: schema.collectionBatches.collectionAreaId,
  areaName: schema.collectionAreas.name,
  batchDate: schema.collectionBatches.batchDate,
  status: schema.collectionBatches.status,
  expectedReceivableCentavos: schema.collectionBatches.expectedReceivableCentavos,
  cashCollectedCentavos: schema.collectionBatches.cashCollectedCentavos,
  nonCashCollectedCentavos: schema.collectionBatches.nonCashCollectedCentavos,
  uncollectedCentavos: schema.collectionBatches.uncollectedCentavos,
  remittedCashCentavos: schema.collectionBatches.remittedCashCentavos,
  shortageCentavos: schema.collectionBatches.shortageCentavos,
  overageCentavos: schema.collectionBatches.overageCentavos,
  submittedAt: schema.collectionBatches.submittedAt,
  reconciledAt: schema.collectionBatches.reconciledAt,
  closedAt: schema.collectionBatches.closedAt,
  createdAt: schema.collectionBatches.createdAt,
} as const;

function batchQuery(db: Executor) {
  return db
    .select(batchSummaryProjection)
    .from(schema.collectionBatches)
    .innerJoin(schema.users, eq(schema.collectionBatches.collectorUserId, schema.users.id))
    .innerJoin(
      schema.collectionAreas,
      eq(schema.collectionBatches.collectionAreaId, schema.collectionAreas.id),
    );
}

export async function listCollectionBatches(
  db: Executor,
  query: CollectionBatchListQuery,
  offset: number,
): Promise<readonly CollectionBatchSummaryRow[]> {
  const conditions: SQL[] = [];
  if (query.status !== undefined) conditions.push(eq(schema.collectionBatches.status, query.status));
  if (query.collectorUserId !== undefined) {
    conditions.push(eq(schema.collectionBatches.collectorUserId, query.collectorUserId));
  }
  if (query.collectionAreaId !== undefined) {
    conditions.push(eq(schema.collectionBatches.collectionAreaId, query.collectionAreaId));
  }

  return batchQuery(db)
    .where(conditions.length === 0 ? undefined : and(...conditions))
    .orderBy(desc(schema.collectionBatches.batchDate), desc(schema.collectionBatches.id))
    .limit(query.pageSize)
    .offset(offset);
}

export async function countCollectionBatches(
  db: Executor,
  query: CollectionBatchListQuery,
): Promise<number> {
  const conditions: SQL[] = [];
  if (query.status !== undefined) conditions.push(eq(schema.collectionBatches.status, query.status));
  if (query.collectorUserId !== undefined) {
    conditions.push(eq(schema.collectionBatches.collectorUserId, query.collectorUserId));
  }
  if (query.collectionAreaId !== undefined) {
    conditions.push(eq(schema.collectionBatches.collectionAreaId, query.collectionAreaId));
  }

  const rows = await db
    .select({ total: count() })
    .from(schema.collectionBatches)
    .where(conditions.length === 0 ? undefined : and(...conditions));

  return rows[0]?.total ?? 0;
}

export async function findCollectionBatchById(
  db: Executor,
  batchId: number,
): Promise<CollectionBatchSummaryRow | null> {
  const rows = await batchQuery(db).where(eq(schema.collectionBatches.id, batchId)).limit(1);
  return rows[0] ?? null;
}

export interface CollectionBatchAccountRow {
  readonly serviceAccountId: number;
  readonly accountNumber: string;
  readonly subscriberName: string;
  readonly expectedAmountCentavos: number;
  readonly collectedAmountCentavos: number;
  readonly outcome: string;
  readonly notes: string | null;
}

export async function listCollectionBatchAccounts(
  db: Executor,
  batchId: number,
): Promise<readonly CollectionBatchAccountRow[]> {
  return db
    .select({
      serviceAccountId: schema.collectionBatchAccounts.serviceAccountId,
      accountNumber: schema.serviceAccounts.accountNumber,
      subscriberName: schema.subscribers.displayName,
      expectedAmountCentavos: schema.collectionBatchAccounts.expectedAmountCentavos,
      collectedAmountCentavos: schema.collectionBatchAccounts.collectedAmountCentavos,
      outcome: schema.collectionBatchAccounts.outcome,
      notes: schema.collectionBatchAccounts.notes,
    })
    .from(schema.collectionBatchAccounts)
    .innerJoin(
      schema.serviceAccounts,
      eq(schema.collectionBatchAccounts.serviceAccountId, schema.serviceAccounts.id),
    )
    .innerJoin(schema.subscribers, eq(schema.serviceAccounts.subscriberId, schema.subscribers.id))
    .where(eq(schema.collectionBatchAccounts.batchId, batchId))
    .orderBy(asc(schema.serviceAccounts.accountNumber));
}

export interface RemittanceRow {
  readonly id: number;
  readonly batchId: number;
  readonly batchNumber: string;
  readonly collectorName: string;
  readonly areaName: string;
  readonly batchDate: string;
  readonly remittedCashCentavos: number;
  readonly varianceCentavos: number;
  readonly varianceType: string;
  readonly remittedAt: Date;
  readonly receivedByName: string | null;
  readonly resolutionNotes: string | null;
  readonly approvedByName: string | null;
}

export async function listRemittances(db: Executor): Promise<readonly RemittanceRow[]> {
  const receivedBy = alias(schema.users, 'received_by_user');
  const approvedBy = alias(schema.users, 'approved_by_user');

  return db
    .select({
      id: schema.collectorRemittances.id,
      batchId: schema.collectorRemittances.batchId,
      batchNumber: schema.collectionBatches.batchNumber,
      collectorName: schema.users.fullName,
      areaName: schema.collectionAreas.name,
      batchDate: schema.collectionBatches.batchDate,
      remittedCashCentavos: schema.collectorRemittances.remittedCashCentavos,
      varianceCentavos: schema.collectorRemittances.varianceCentavos,
      varianceType: schema.collectorRemittances.varianceType,
      remittedAt: schema.collectorRemittances.remittedAt,
      receivedByName: receivedBy.fullName,
      resolutionNotes: schema.collectorRemittances.resolutionNotes,
      approvedByName: approvedBy.fullName,
    })
    .from(schema.collectorRemittances)
    .innerJoin(
      schema.collectionBatches,
      eq(schema.collectorRemittances.batchId, schema.collectionBatches.id),
    )
    .innerJoin(
      schema.collectionAreas,
      eq(schema.collectionBatches.collectionAreaId, schema.collectionAreas.id),
    )
    .innerJoin(schema.users, eq(schema.collectionBatches.collectorUserId, schema.users.id))
    .leftJoin(receivedBy, eq(schema.collectorRemittances.receivedBy, receivedBy.id))
    .leftJoin(approvedBy, eq(schema.collectorRemittances.approvedBy, approvedBy.id))
    .orderBy(desc(schema.collectorRemittances.remittedAt));
}

export interface CollectorAssignmentRow {
  readonly id: number;
  readonly collectionAreaId: number;
  readonly areaCode: string;
  readonly areaName: string;
  readonly collectorUserId: number;
  readonly collectorName: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
}

export async function listCollectorAssignments(
  db: Executor,
): Promise<readonly CollectorAssignmentRow[]> {
  return db
    .select({
      id: schema.collectionAssignments.id,
      collectionAreaId: schema.collectionAssignments.collectionAreaId,
      areaCode: schema.collectionAreas.code,
      areaName: schema.collectionAreas.name,
      collectorUserId: schema.collectionAssignments.collectorUserId,
      collectorName: schema.users.fullName,
      effectiveFrom: schema.collectionAssignments.effectiveFrom,
      effectiveTo: schema.collectionAssignments.effectiveTo,
    })
    .from(schema.collectionAssignments)
    .innerJoin(
      schema.collectionAreas,
      eq(schema.collectionAssignments.collectionAreaId, schema.collectionAreas.id),
    )
    .innerJoin(schema.users, eq(schema.collectionAssignments.collectorUserId, schema.users.id))
    .where(sql`${schema.collectionAssignments.effectiveTo} IS NULL`)
    .orderBy(asc(schema.collectionAreas.code));
}
