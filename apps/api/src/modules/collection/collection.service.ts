import {
  ConflictError,
  NotFoundError,
  ValidationError,
  centavos,
  type RoleCode,
} from '@bcis/shared';
import { computeBatchTotals, computeRemittanceVariance } from '@bcis/domain';
import type {
  BatchReconciliationInput,
  BatchRemittanceInput,
  CloseCollectionBatchInput,
  CollectionAreaSummary,
  CollectionBatchDetail,
  CollectionBatchListQuery,
  CollectionBatchSummary,
  CollectorAssignmentSummary,
  CollectorSummary,
  CreateCollectionAreaInput,
  CreateCollectionBatchInput,
  RemittanceSummary,
  RouteSheetEntry,
  SubmitCollectionBatchInput,
  UpdateCollectionAreaInput,
} from '@bcis/validation';
import { offsetFor } from '@bcis/validation';
import { randomUUID } from 'node:crypto';

import type { Db } from '../../shared/database';
import type { ActorContext } from '../../shared/request-context';
import { AUDIT_ACTIONS, AUDIT_ENTITIES } from '../audit/audit.actions';
import { writeAudit } from '../audit/audit.service';
import { findServiceAccountRow } from '../service-accounts/service-accounts.repository';
import * as repository from './collection.repository';
import type { CollectionAreaRow } from './collection.repository';

/**
 * Collection areas.
 *
 * Areas are created and edited here; they are USED by subscribers and, from
 * Phase 6, by routes, batches, and remittance.
 */

function toSummary(row: CollectionAreaRow): CollectionAreaSummary {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    isActive: row.isActive,
    subscriberCount: row.subscriberCount,
  };
}

export async function listAreas(db: Db): Promise<readonly CollectionAreaSummary[]> {
  const rows = await repository.listCollectionAreas(db);
  return rows.map(toSummary);
}

export async function getArea(db: Db, areaId: number): Promise<CollectionAreaSummary> {
  const row = await repository.findCollectionAreaById(db, areaId);
  if (row === null) {
    throw new NotFoundError('That collection area does not exist.');
  }
  return toSummary(row);
}

export async function createArea(
  db: Db,
  input: CreateCollectionAreaInput,
  actor: ActorContext,
): Promise<CollectionAreaSummary> {
  if (await repository.collectionAreaCodeExists(db, input.code)) {
    throw new ConflictError(`Collection area ${input.code} already exists.`);
  }

  const areaId = await db.transaction(async (tx) => {
    const id = await repository.insertCollectionArea(tx, {
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      isActive: input.isActive,
      createdBy: actor.userId,
    });

    await writeAudit(tx, {
      action: AUDIT_ACTIONS.COLLECTION_AREA_CREATED,
      entityType: AUDIT_ENTITIES.COLLECTION_AREA,
      entityId: String(id),
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ip: actor.ip,
      newValues: { code: input.code, name: input.name },
    });

    return id;
  });

  return getArea(db, areaId);
}

export async function updateArea(
  db: Db,
  areaId: number,
  input: UpdateCollectionAreaInput,
  actor: ActorContext,
): Promise<CollectionAreaSummary> {
  const existing = await repository.findCollectionAreaById(db, areaId);
  if (existing === null) {
    throw new NotFoundError('That collection area does not exist.');
  }

  await db.transaction(async (tx) => {
    await repository.updateCollectionAreaRow(
      tx,
      areaId,
      {
        name: input.name,
        description: input.description ?? null,
        isActive: input.isActive,
      },
      actor.userId,
    );

    await writeAudit(tx, {
      action: AUDIT_ACTIONS.COLLECTION_AREA_UPDATED,
      entityType: AUDIT_ENTITIES.COLLECTION_AREA,
      entityId: String(areaId),
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ip: actor.ip,
      oldValues: { name: existing.name, isActive: existing.isActive },
      newValues: { name: input.name, isActive: input.isActive },
    });
  });

  return getArea(db, areaId);
}

export async function listCollectors(db: Db): Promise<readonly CollectorSummary[]> {
  const rows = await repository.listCollectors(db);

  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    fullName: row.fullName,
    roles: [...row.roles] as RoleCode[],
  }));
}

export async function createCollectorAssignment(
  db: Db,
  areaId: number,
  collectorUserId: number,
  effectiveFrom: string,
  actor: ActorContext,
): Promise<{ id: number }> {
  const exists = await repository.findCollectionAreaById(db, areaId);
  if (exists === null) {
    throw new NotFoundError('That collection area does not exist.');
  }

  if (!(await repository.isAssignableUser(db, collectorUserId))) {
    throw new ValidationError('That collector does not exist.', { field: 'collectorUserId' });
  }

  const assignmentId = await db.transaction(async (tx) => {
    const id = await repository.insertCollectorAssignment(tx, {
      collectionAreaId: areaId,
      collectorUserId: collectorUserId,
      effectiveFrom,
      effectiveTo: null,
      reason: 'Assigned to route',
      createdBy: actor.userId,
    });

    await writeAudit(tx, {
      action: 'COLLECTION_AREA_UPDATED',
      entityType: AUDIT_ENTITIES.COLLECTION_AREA,
      entityId: String(areaId),
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ip: actor.ip,
      newValues: { collectorUserId, assignedFrom: effectiveFrom },
    });

    return { id };
  });

  return assignmentId;
}

export async function createBatch(
  db: Db,
  input: CreateCollectionBatchInput,
  actor: ActorContext,
): Promise<{
  id: number;
  batchNumber: string;
  status: string;
  expectedReceivableCentavos: number;
}> {
  if (!(await repository.isAssignableUser(db, input.collectorUserId))) {
    throw new ValidationError('That collector does not exist.', { field: 'collectorUserId' });
  }

  const area = await repository.findCollectionAreaById(db, input.collectionAreaId);
  if (area === null) {
    throw new NotFoundError('That collection area does not exist.');
  }

  for (const accountId of input.serviceAccountIds) {
    const subscriber = await repository.accountInArea(db, accountId, input.collectionAreaId);
    if (!subscriber) {
      throw new ValidationError('One or more service accounts are not assigned to this area.', {
        field: 'serviceAccountIds',
      });
    }
  }

  const batchId = await db.transaction(async (tx) => {
    const batchNumber = `CB-${input.batchDate.replace(/-/g, '')}-${randomUUID().slice(0, 8).toUpperCase()}`;

    const id = await repository.insertCollectionBatch(tx, {
      batchNumber,
      collectorUserId: input.collectorUserId,
      collectionAreaId: input.collectionAreaId,
      batchDate: input.batchDate,
      status: 'OPEN',
      expectedReceivableCentavos: input.expectedReceivableCentavos,
      cashCollectedCentavos: 0,
      nonCashCollectedCentavos: 0,
      uncollectedCentavos: 0,
      createdBy: actor.userId,
    });

    for (const accountId of input.serviceAccountIds) {
      const accountRow = await findServiceAccountRow(tx, accountId);
      if (accountRow === null) {
        throw new ValidationError('One or more service accounts do not exist.', {
          field: 'serviceAccountIds',
        });
      }

      await repository.insertBatchAccount(tx, {
        batchId: id,
        serviceAccountId: accountId,
        expectedAmountCentavos: accountRow.currentPlanPriceCentavos,
        collectedAmountCentavos: 0,
        outcome: 'NOT_HOME',
        notes: input.notes ?? null,
        createdBy: actor.userId,
      });
    }

    await writeAudit(tx, {
      action: AUDIT_ACTIONS.COLLECTION_BATCH_CREATED,
      entityType: AUDIT_ENTITIES.COLLECTION_AREA,
      entityId: String(id),
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ip: actor.ip,
      newValues: {
        batchNumber,
        collectorUserId: input.collectorUserId,
        areaId: input.collectionAreaId,
      },
    });

    return { id, batchNumber };
  });

  return {
    id: batchId.id,
    batchNumber: batchId.batchNumber,
    status: 'OPEN',
    expectedReceivableCentavos: input.expectedReceivableCentavos,
  };
}

export async function getRouteSheet(
  db: Db,
  batchId: number,
): Promise<{ entries: readonly RouteSheetEntry[] }> {
  const batch = await repository.findBatchById(db, batchId);
  if (batch === null) {
    throw new NotFoundError('That collection batch does not exist.');
  }

  const entries = await repository.listBatchRouteSheet(db, batchId);
  return { entries };
}

export async function getReconciliationView(db: Db, batchId: number) {
  const batch = await repository.findBatchById(db, batchId);
  if (batch === null) throw new NotFoundError('That collection batch does not exist.');
  return repository.getReconciliationView(db, batchId);
}

export async function submitBatch(
  db: Db,
  batchId: number,
  input: SubmitCollectionBatchInput,
  actor: ActorContext,
): Promise<{ status: string; totalCollectedCentavos: number; uncollectedCentavos: number }> {
  const batch = await repository.findBatchById(db, batchId);
  if (batch === null) throw new NotFoundError('That collection batch does not exist.');
  if (batch.status !== 'OPEN' && batch.status !== 'IN_PROGRESS') {
    throw new ConflictError(`A ${batch.status.toLowerCase()} batch cannot be submitted.`);
  }

  const totals = computeBatchTotals({
    expectedReceivable: centavos(batch.expectedReceivableCentavos),
    cashCollected: centavos(input.cashCollectedCentavos),
    nonCashCollected: centavos(input.nonCashCollectedCentavos),
  });
  if (totals.uncollected !== input.uncollectedCentavos) {
    throw new ValidationError('Uncollected amount does not match the batch totals.', {
      field: 'uncollectedCentavos',
    });
  }

  await db.transaction(async (tx) => {
    await repository.updateBatchStatus(tx, batchId, {
      status: 'SUBMITTED',
      cashCollectedCentavos: input.cashCollectedCentavos,
      nonCashCollectedCentavos: input.nonCashCollectedCentavos,
      uncollectedCentavos: input.uncollectedCentavos,
      submittedAt: new Date(),
      updatedBy: actor.userId,
    });
    await writeAudit(tx, {
      action: AUDIT_ACTIONS.COLLECTION_BATCH_SUBMITTED,
      entityType: AUDIT_ENTITIES.COLLECTION_BATCH,
      entityId: String(batchId),
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ip: actor.ip,
      newValues: input,
    });
  });

  return {
    status: 'SUBMITTED',
    totalCollectedCentavos: totals.totalCollected,
    uncollectedCentavos: totals.uncollected,
  };
}

export async function startBatch(
  db: Db,
  batchId: number,
  actor: ActorContext,
): Promise<{ status: string }> {
  const batch = await repository.findBatchById(db, batchId);
  if (batch === null) throw new NotFoundError('That collection batch does not exist.');
  if (batch.status !== 'OPEN') {
    throw new ConflictError(`A ${batch.status.toLowerCase()} batch cannot be started.`);
  }

  await db.transaction(async (tx) => {
    await repository.updateBatchStatus(tx, batchId, {
      status: 'IN_PROGRESS',
      updatedBy: actor.userId,
    });
    await writeAudit(tx, {
      action: AUDIT_ACTIONS.COLLECTION_BATCH_STARTED,
      entityType: AUDIT_ENTITIES.COLLECTION_BATCH,
      entityId: String(batchId),
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ip: actor.ip,
      newValues: { status: 'IN_PROGRESS' },
    });
  });

  return { status: 'IN_PROGRESS' };
}

export async function recordRemittance(
  db: Db,
  batchId: number,
  input: BatchRemittanceInput,
  actor: ActorContext,
): Promise<{ varianceCentavos: number; varianceType: string; status: string }> {
  const batch = await repository.findBatchById(db, batchId);
  if (batch === null) {
    throw new NotFoundError('That collection batch does not exist.');
  }

  if (batch.status !== 'SUBMITTED') {
    throw new ConflictError(`A ${batch.status.toLowerCase()} batch cannot be remitted.`);
  }
  if (await repository.remittanceExists(db, batchId)) {
    throw new ConflictError('This collection batch already has a remittance.');
  }

  const variance = computeRemittanceVariance(
    centavos(batch.cashCollectedCentavos),
    centavos(input.remittedCashCentavos),
  );
  await db.transaction(async (tx) => {
    await repository.insertRemittance(tx, {
      batchId,
      remittedCashCentavos: input.remittedCashCentavos,
      varianceCentavos: variance.variance,
      varianceType: variance.type,
      remittedAt: new Date(),
      receivedBy: input.receivedByUserId,
      resolutionNotes: input.resolutionNotes ?? null,
      approvedBy: actor.userId,
      createdBy: actor.userId,
    });

    await repository.updateBatchStatus(tx, batchId, {
      status: 'REMITTED',
      remittedCashCentavos: input.remittedCashCentavos,
      shortageCentavos: variance.type === 'SHORTAGE' ? Math.abs(variance.variance) : 0,
      overageCentavos: variance.type === 'OVERAGE' ? variance.variance : 0,
      updatedBy: actor.userId,
    });

    await writeAudit(tx, {
      action: AUDIT_ACTIONS.COLLECTOR_REMITTANCE_RECORDED,
      entityType: AUDIT_ENTITIES.COLLECTION_BATCH,
      entityId: String(batchId),
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ip: actor.ip,
      newValues: {
        remittedCashCentavos: input.remittedCashCentavos,
        varianceCentavos: variance.variance,
        varianceType: variance.type,
      },
    });
  });

  return {
    varianceCentavos: variance.variance,
    varianceType: variance.type,
    status: 'REMITTED',
  };
}

export async function reconcileBatch(
  db: Db,
  batchId: number,
  input: BatchReconciliationInput,
  actor: ActorContext,
): Promise<{ differenceCentavos: number; status: string }> {
  const batch = await repository.findBatchById(db, batchId);
  if (batch === null) {
    throw new NotFoundError('That collection batch does not exist.');
  }

  if (batch.status !== 'REMITTED') {
    throw new ConflictError(`A ${batch.status.toLowerCase()} batch cannot be reconciled.`);
  }

  const difference = input.actualCashCentavos - input.expectedCashCentavos;

  await db.transaction(async (tx) => {
    await repository.insertReconciliation(tx, {
      batchId,
      reconcilerUserId: actor.userId,
      expectedCashCentavos: input.expectedCashCentavos,
      actualCashCentavos: input.actualCashCentavos,
      differenceCentavos: difference,
      reason: input.reason ?? null,
    });

    await repository.updateBatchStatus(tx, batchId, {
      status: 'RECONCILED',
      reconciledAt: new Date(),
      updatedBy: actor.userId,
    });

    await writeAudit(tx, {
      action: AUDIT_ACTIONS.COLLECTION_BATCH_RECONCILED,
      entityType: AUDIT_ENTITIES.COLLECTION_BATCH,
      entityId: String(batchId),
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ip: actor.ip,
      newValues: {
        expectedCashCentavos: input.expectedCashCentavos,
        actualCashCentavos: input.actualCashCentavos,
      },
    });
  });

  return { differenceCentavos: difference, status: 'RECONCILED' };
}

export async function closeBatch(
  db: Db,
  batchId: number,
  input: CloseCollectionBatchInput,
  actor: ActorContext,
): Promise<{ status: string }> {
  const batch = await repository.findBatchById(db, batchId);
  if (batch === null) {
    throw new NotFoundError('That collection batch does not exist.');
  }

  if (batch.status !== 'RECONCILED') {
    throw new ConflictError('Only a reconciled batch can be closed.');
  }

  await db.transaction(async (tx) => {
    await repository.updateBatchStatus(tx, batchId, {
      status: 'CLOSED',
      closedAt: new Date(),
      updatedBy: actor.userId,
    });

    await writeAudit(tx, {
      action: AUDIT_ACTIONS.COLLECTION_BATCH_CLOSED,
      entityType: AUDIT_ENTITIES.COLLECTION_BATCH,
      entityId: String(batchId),
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ip: actor.ip,
      newValues: { closed: true, reason: input.reason ?? null },
    });
  });

  return { status: 'CLOSED' };
}

/* ─────────────────────── Phase 6 read models ─────────────────────────────── */

export interface CollectionBatchPage {
  readonly batches: readonly CollectionBatchSummary[];
  readonly total: number;
}

export async function listBatches(
  db: Db,
  query: CollectionBatchListQuery,
): Promise<CollectionBatchPage> {
  const offset = offsetFor(query.page, query.pageSize);
  const [rows, total] = await Promise.all([
    repository.listCollectionBatches(db, query, offset),
    repository.countCollectionBatches(db, query),
  ]);

  return { batches: rows.map(toBatchSummary), total };
}

export async function getBatch(db: Db, batchId: number): Promise<CollectionBatchDetail> {
  const batch = await repository.findCollectionBatchById(db, batchId);
  if (batch === null) {
    throw new NotFoundError('That collection batch does not exist.');
  }

  const accounts = await repository.listCollectionBatchAccounts(db, batchId);
  return {
    ...toBatchSummary(batch),
    accounts: accounts.map((account) => ({
      serviceAccountId: account.serviceAccountId,
      accountNumber: account.accountNumber,
      subscriberName: account.subscriberName,
      expectedAmountCentavos: account.expectedAmountCentavos,
      collectedAmountCentavos: account.collectedAmountCentavos,
      outcome: account.outcome as CollectionBatchDetail['accounts'][number]['outcome'],
      notes: account.notes,
    })),
  };
}

export async function listRemittances(db: Db): Promise<readonly RemittanceSummary[]> {
  const rows = await repository.listRemittances(db);
  return rows.map((row) => ({
    id: row.id,
    batchId: row.batchId,
    batchNumber: row.batchNumber,
    collectorName: row.collectorName,
    areaName: row.areaName,
    batchDate: row.batchDate,
    remittedCashCentavos: row.remittedCashCentavos,
    varianceCentavos: row.varianceCentavos,
    varianceType: row.varianceType as RemittanceSummary['varianceType'],
    remittedAt: row.remittedAt.toISOString(),
    receivedByName: row.receivedByName,
    resolutionNotes: row.resolutionNotes,
    approvedByName: row.approvedByName,
  }));
}

export async function listAssignments(
  db: Db,
): Promise<readonly CollectorAssignmentSummary[]> {
  const rows = await repository.listCollectorAssignments(db);
  return rows.map((row) => ({
    id: row.id,
    collectionAreaId: row.collectionAreaId,
    areaCode: row.areaCode,
    areaName: row.areaName,
    collectorUserId: row.collectorUserId,
    collectorName: row.collectorName,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
  }));
}

function toBatchSummary(
  row: repository.CollectionBatchSummaryRow,
): CollectionBatchSummary {
  return {
    id: row.id,
    batchNumber: row.batchNumber,
    collectorUserId: row.collectorUserId,
    collectorName: row.collectorName,
    collectionAreaId: row.collectionAreaId,
    areaName: row.areaName,
    batchDate: row.batchDate,
    status: row.status as CollectionBatchSummary['status'],
    expectedReceivableCentavos: row.expectedReceivableCentavos,
    cashCollectedCentavos: row.cashCollectedCentavos,
    nonCashCollectedCentavos: row.nonCashCollectedCentavos,
    uncollectedCentavos: row.uncollectedCentavos,
    remittedCashCentavos: row.remittedCashCentavos,
    shortageCentavos: row.shortageCentavos,
    overageCentavos: row.overageCentavos,
    submittedAt: row.submittedAt === null ? null : row.submittedAt.toISOString(),
    reconciledAt: row.reconciledAt === null ? null : row.reconciledAt.toISOString(),
    closedAt: row.closedAt === null ? null : row.closedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}
