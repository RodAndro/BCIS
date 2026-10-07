import {
  ConflictError,
  NotFoundError,
  ValidationError,
  businessToday,
  canTransitionServiceStatus,
  eventTypeForTransition,
  type ServiceAccountStatus,
} from '@bcis/shared';
import {
  offsetFor,
  type AgingSummary,
  type ReceivableListQuery,
  type ReceivableSummary,
  type ReconnectionCompleteInput,
  type ReconnectionRecord,
  type ReconnectionRequestInput,
  type ReconnectionScheduleInput,
  type SuspensionCandidate,
  type SuspendServiceInput,
} from '@bcis/validation';

import type { Db } from '../../shared/database';
import type { ActorContext } from '../../shared/request-context';
import { AUDIT_ACTIONS, AUDIT_ENTITIES } from '../audit/audit.actions';
import { writeAudit } from '../audit/audit.service';
import { findSettingByKey } from '../settings/settings.repository';
import * as accountRepository from '../service-accounts/service-accounts.repository';
import * as repository from './receivables.repository';

function daysOverdue(oldest: string | null, today: string): number {
  if (oldest === null) return 0;
  return Math.max(
    0,
    Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${oldest}T00:00:00Z`)) / 86_400_000),
  );
}

function toReceivable(row: repository.ReceivableRow): ReceivableSummary {
  return {
    serviceAccountId: row.serviceAccountId,
    accountNumber: row.accountNumber,
    subscriberId: row.subscriberId,
    subscriber: row.subscriber,
    servicePlanId: row.servicePlanId,
    plan: row.plan,
    serviceTypeCode: row.serviceTypeCode as 'INTERNET' | 'CABLE' | 'COMBO',
    area: row.area,
    collector: row.collector,
    monthsUnpaid: row.monthsUnpaid,
    oldestUnpaidInvoice: row.oldestUnpaidInvoice,
    lastPayment: row.lastPayment,
    totalArrearsCentavos: row.totalArrearsCentavos,
    agingBucket: row.agingBucket as ReceivableSummary['agingBucket'],
  };
}

export async function listReceivables(db: Db, query: ReceivableListQuery) {
  const today = businessToday();
  const offset = offsetFor(query.page, query.pageSize);
  const [rows, total] = await Promise.all([
    repository.listReceivables(db, query, today, offset),
    repository.countReceivables(db, query, today),
  ]);
  return { receivables: rows.map(toReceivable), total };
}

export async function getAgingSummary(db: Db): Promise<AgingSummary> {
  return repository.agingSummary(db, businessToday());
}

async function receivableSettings(db: Db): Promise<{ days: number; months: number }> {
  const [daysSetting, monthsSetting] = await Promise.all([
    findSettingByKey(db, 'receivables.suspension_days_overdue'),
    findSettingByKey(db, 'receivables.suspension_months_unpaid'),
  ]);
  const days = Number(daysSetting?.value ?? 60);
  const months = Number(monthsSetting?.value ?? 3);
  if (!Number.isInteger(days) || days < 0 || !Number.isInteger(months) || months < 0) {
    throw new ValidationError('Receivables suspension settings are invalid.');
  }
  return { days, months };
}

export async function listSuspensionCandidates(
  db: Db,
  query: ReceivableListQuery,
): Promise<{ candidates: readonly SuspensionCandidate[]; total: number }> {
  const today = businessToday();
  const settings = await receivableSettings(db);
  const candidateQuery = { ...query, overdueOnly: true, page: 1, pageSize: 1000 };
  const rows = await repository.listReceivables(db, candidateQuery, today, 0);
  const candidates = rows
    .filter((row) => row.serviceStatus === 'ACTIVE')
    .filter((row) => row.agingBucket !== 'CURRENT')
    .filter(
      (row) =>
        daysOverdue(row.oldestUnpaidInvoice, today) >= settings.days ||
        row.monthsUnpaid >= settings.months,
    )
    .map((row) => ({
      ...toReceivable(row),
      eligible: true,
      thresholdDaysOverdue: settings.days,
      thresholdMonthsUnpaid: settings.months,
    }));

  // Candidate eligibility is decided in memory, so the page window is applied
  // here rather than in SQL; `total` is the full candidate count, not the page.
  const offset = offsetFor(query.page, query.pageSize);
  return {
    candidates: candidates.slice(offset, offset + query.pageSize),
    total: candidates.length,
  };
}

export async function suspendService(
  db: Db,
  accountId: number,
  input: SuspendServiceInput,
  actor: ActorContext,
) {
  const existing = await accountRepository.findServiceAccountRow(db, accountId);
  if (existing === null) throw new NotFoundError('That service account does not exist.');
  if (existing.status !== 'ACTIVE') {
    throw new ConflictError(
      `Only an active account can be suspended; this account is ${existing.status.toLowerCase()}.`,
    );
  }
  if (!canTransitionServiceStatus('ACTIVE', 'SUSPENDED')) {
    throw new ConflictError('Suspension is not an allowed service transition.');
  }

  const recordId = await db.transaction(async (tx) => {
    await accountRepository.setServiceAccountStatusRow(
      tx,
      accountId,
      'SUSPENDED',
      existing.activationDate,
      actor.userId,
    );
    await accountRepository.insertServiceEvent(tx, {
      serviceAccountId: accountId,
      eventType: eventTypeForTransition('ACTIVE', 'SUSPENDED'),
      fromValue: 'ACTIVE',
      toValue: 'SUSPENDED',
      effectiveDate: input.effectiveDate,
      reason: input.reason,
      actorUserId: actor.userId,
    });
    const id = await repository.insertSuspension(tx, {
      serviceAccountId: accountId,
      reason: input.reason,
      effectiveDate: input.effectiveDate,
      approvedBy: actor.userId,
      notes: input.notes ?? null,
      createdBy: actor.userId,
    });
    await writeAudit(tx, {
      action: AUDIT_ACTIONS.SUSPENSION_RECORDED,
      entityType: AUDIT_ENTITIES.SUSPENSION,
      entityId: String(id),
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ip: actor.ip,
      reason: input.reason,
      newValues: { serviceAccountId: accountId, effectiveDate: input.effectiveDate },
    });
    return id;
  });
  return { id: recordId, status: 'SUSPENDED' as const };
}

async function reconnectionFee(db: Db, accountId: number): Promise<number> {
  const account = await accountRepository.findServiceAccountRow(db, accountId);
  if (account === null) throw new NotFoundError('That service account does not exist.');
  const plan = await (
    await import('../catalog/catalog.repository')
  ).findPlanById(db, account.servicePlanId);
  return plan?.reconnectionFeeCentavos ?? 0;
}

export async function requestReconnection(
  db: Db,
  accountId: number,
  input: ReconnectionRequestInput,
  actor: ActorContext,
): Promise<ReconnectionRecord> {
  const account = await accountRepository.findServiceAccountRow(db, accountId);
  if (account === null) throw new NotFoundError('That service account does not exist.');
  if (account.status !== 'SUSPENDED' && account.status !== 'DISCONNECTED') {
    throw new ConflictError('Only suspended or disconnected services can request reconnection.');
  }
  const payment = await repository.findPaymentForAccount(db, input.qualifyingPaymentId, accountId);
  if (payment === null || payment.status !== 'POSTED') {
    throw new ValidationError(
      'The qualifying payment does not belong to this account or is not posted.',
      { field: 'qualifyingPaymentId' },
    );
  }
  const minimum = await findSettingByKey(db, 'receivables.minimum_reconnection_payment_centavos');
  if (payment.amountCentavos < Number(minimum?.value ?? 0)) {
    throw new ConflictError('The qualifying payment does not meet the reconnection requirement.');
  }
  const fee = await reconnectionFee(db, accountId);
  const id = await db.transaction(async (tx) => {
    const recordId = await repository.insertReconnection(tx, {
      serviceAccountId: accountId,
      requestDate: input.requestDate,
      qualifyingPaymentId: input.qualifyingPaymentId,
      reconnectionFeeCentavos: fee,
      technicianUserId: input.technicianUserId ?? null,
      status: input.technicianUserId === undefined ? 'REQUESTED' : 'SCHEDULED',
      notes: input.notes ?? null,
      createdBy: actor.userId,
    });
    await writeAudit(tx, {
      action: AUDIT_ACTIONS.RECONNECTION_REQUESTED,
      entityType: AUDIT_ENTITIES.RECONNECTION,
      entityId: String(recordId),
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ip: actor.ip,
      newValues: {
        serviceAccountId: accountId,
        qualifyingPaymentId: input.qualifyingPaymentId,
        fee,
      },
    });
    return recordId;
  });
  return getReconnection(db, id);
}

export async function scheduleReconnection(
  db: Db,
  id: number,
  input: ReconnectionScheduleInput,
  actor: ActorContext,
): Promise<ReconnectionRecord> {
  const record = await repository.findReconnection(db, id);
  if (record === null) throw new NotFoundError('That reconnection request does not exist.');
  if (record.status !== 'REQUESTED' && record.status !== 'APPROVED')
    throw new ConflictError('That reconnection request cannot be scheduled.');
  await db.transaction(async (tx) => {
    await repository.updateReconnection(tx, id, {
      technicianUserId: input.technicianUserId,
      status: 'SCHEDULED',
      notes: input.notes ?? record.notes,
    });
    await writeAudit(tx, {
      action: AUDIT_ACTIONS.RECONNECTION_SCHEDULED,
      entityType: AUDIT_ENTITIES.RECONNECTION,
      entityId: String(id),
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ip: actor.ip,
      newValues: { technicianUserId: input.technicianUserId },
    });
  });
  return getReconnection(db, id);
}

export async function completeReconnection(
  db: Db,
  id: number,
  input: ReconnectionCompleteInput,
  actor: ActorContext,
): Promise<ReconnectionRecord> {
  const record = await repository.findReconnection(db, id);
  if (record === null) throw new NotFoundError('That reconnection request does not exist.');
  if (record.status !== 'SCHEDULED' || record.technicianUserId === null)
    throw new ConflictError('Only a scheduled reconnection with a technician can be completed.');
  const account = await accountRepository.findServiceAccountRow(db, record.serviceAccountId);
  if (account === null) throw new NotFoundError('That service account does not exist.');
  const from = account.status as ServiceAccountStatus;
  if (!canTransitionServiceStatus(from, 'ACTIVE'))
    throw new ConflictError(`Cannot reconnect an account that is ${from.toLowerCase()}.`);

  await db.transaction(async (tx) => {
    await accountRepository.setServiceAccountStatusRow(
      tx,
      account.id,
      'ACTIVE',
      account.activationDate,
      actor.userId,
    );
    await accountRepository.insertServiceEvent(tx, {
      serviceAccountId: account.id,
      eventType: eventTypeForTransition(from, 'ACTIVE'),
      fromValue: from,
      toValue: 'ACTIVE',
      effectiveDate: input.completionDate,
      reason: 'Reconnection completed.',
      actorUserId: actor.userId,
    });
    await repository.updateReconnection(tx, id, {
      status: 'COMPLETED',
      completionDate: input.completionDate,
      notes: input.notes ?? record.notes,
      updatedBy: actor.userId,
    });
    await writeAudit(tx, {
      action: AUDIT_ACTIONS.RECONNECTION_COMPLETED,
      entityType: AUDIT_ENTITIES.RECONNECTION,
      entityId: String(id),
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ip: actor.ip,
      newValues: { completionDate: input.completionDate, serviceAccountStatus: 'ACTIVE' },
    });
  });
  return getReconnection(db, id);
}

export async function getReconnection(db: Db, id: number): Promise<ReconnectionRecord> {
  const row = await repository.findReconnection(db, id);
  if (row === null) throw new NotFoundError('That reconnection request does not exist.');
  return {
    id: row.id,
    serviceAccountId: row.serviceAccountId,
    requestDate: row.requestDate,
    qualifyingPaymentId: row.qualifyingPaymentId,
    reconnectionFeeCentavos: row.reconnectionFeeCentavos,
    technicianUserId: row.technicianUserId,
    completionDate: row.completionDate,
    status: row.status as ReconnectionRecord['status'],
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  };
}
