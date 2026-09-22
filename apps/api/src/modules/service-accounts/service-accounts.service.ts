import {
  ALLOWED_STATUS_TRANSITIONS,
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
  type ApplyPlanRateInput,
  type ChangeServiceAccountPlanInput,
  type CreateServiceAccountInput,
  type ServiceAccountDetail,
  type ServiceAccountListQuery,
  type ServiceAccountSummary,
  type SetServiceAccountStatusInput,
  type UpdateServiceAccountInput,
} from '@bcis/validation';

import type { Db } from '../../shared/database';
import { NUMBER_SCOPES, allocateDocumentNumber } from '../../shared/numbering';
import type { ActorContext } from '../../shared/request-context';
import { AUDIT_ACTIONS, AUDIT_ENTITIES } from '../audit/audit.actions';
import { writeAudit } from '../audit/audit.service';
import { findPlanById, findCurrentPlanByCode } from '../catalog/catalog.repository';
import { toPlanSummary } from '../catalog/catalog.mapper';
import { isAssignableUser } from '../collection/collection.repository';
import { findSubscriberRow } from '../subscribers/subscribers.repository';
import { toServiceAccountDetail, toServiceAccountSummary } from './service-accounts.mapper';
import * as repository from './service-accounts.repository';

/**
 * Service accounts.
 *
 * ── THE RULE THIS MODULE EXISTS TO HOLD ─────────────────────────────────────
 * `current_plan_price_centavos` is written ONCE, at creation, from the plan
 * version in force. Nothing else in this file changes it except `applyPlanRate`,
 * which is an explicit, reasoned, audited action by a person. Changing a plan's
 * price does not move a single existing account — see
 * `catalog.service.changePlanPrice`.
 */

export interface ServiceAccountPage {
  readonly accounts: readonly ServiceAccountSummary[];
  readonly total: number;
}

export async function listServiceAccounts(
  db: Db,
  query: ServiceAccountListQuery,
): Promise<ServiceAccountPage> {
  const offset = offsetFor(query.page, query.pageSize);

  const [rows, total] = await Promise.all([
    repository.listServiceAccounts(db, query, offset),
    repository.countServiceAccounts(db, query),
  ]);

  return { accounts: rows.map(toServiceAccountSummary), total };
}

export async function getServiceAccount(db: Db, accountId: number): Promise<ServiceAccountDetail> {
  const row = await repository.findServiceAccountRow(db, accountId);
  if (row === null) {
    throw new NotFoundError('That service account does not exist.');
  }

  const [planRow, address, events] = await Promise.all([
    findPlanById(db, row.servicePlanId),
    row.installationAddressId === null
      ? Promise.resolve(null)
      : repository.findAddressById(db, row.installationAddressId),
    repository.listServiceEvents(db, accountId),
  ]);

  if (planRow === null) {
    // Cannot happen while the foreign key is `restrict`, but failing loudly is
    // better than returning a detail page with no plan.
    throw new NotFoundError('The plan on this service account is missing.');
  }

  return toServiceAccountDetail(
    row,
    toPlanSummary(planRow),
    address === null ? null : { ...address, addressType: address.addressType as 'SERVICE' },
    events,
  );
}

/**
 * Open a service account.
 *
 * ── WHAT IS REFUSED ─────────────────────────────────────────────────────────
 *   - a subscriber or plan that does not exist
 *   - a RETIRED plan, or a superseded plan VERSION: an account must start on the
 *     version that is current today, or its first invoice would be computed from
 *     a price that had already been replaced
 *   - an installation address belonging to a different subscriber, which is the
 *     kind of mistake that sends a technician to the wrong house
 */
export async function createServiceAccount(
  db: Db,
  input: CreateServiceAccountInput,
  actor: ActorContext,
): Promise<ServiceAccountDetail> {
  const subscriber = await findSubscriberRow(db, input.subscriberId);
  if (subscriber === null) {
    throw new ValidationError('That subscriber does not exist.', { field: 'subscriberId' });
  }

  const plan = await findPlanById(db, input.servicePlanId);
  if (plan === null) {
    throw new ValidationError('That service plan does not exist.', { field: 'servicePlanId' });
  }

  if (plan.effectiveTo !== null) {
    throw new ConflictError(
      'That plan version has been superseded. Open the account on the current version.',
    );
  }

  if (plan.status === 'RETIRED') {
    throw new ConflictError('That plan is retired and cannot be used for a new account.');
  }

  await assertAddressBelongs(db, input.installationAddressId ?? null, input.subscriberId);
  await assertCollectorExists(db, input.assignedCollectorId ?? null);

  const today = businessToday();
  const activationDate = input.status === 'ACTIVE' ? (input.activationDate ?? today) : null;
  const billingStartDate = input.billingStartDate ?? activationDate ?? today;

  const accountId = await db.transaction(async (tx) => {
    const accountNumber = await allocateDocumentNumber(tx, NUMBER_SCOPES.SERVICE_ACCOUNT);

    const id = await repository.insertServiceAccount(tx, {
      accountNumber,
      subscriberId: input.subscriberId,
      servicePlanId: input.servicePlanId,
      installationAddressId: input.installationAddressId ?? null,
      status: input.status,
      activationDate,
      billingStartDate,
      billingDay: input.billingDay ?? subscriber.billingDay,
      dueDay: input.dueDay ?? subscriber.dueDay,
      // THE snapshot. The rate this account is charged, copied from the plan
      // version, never re-read from the plan again.
      currentPlanPriceCentavos: plan.monthlyFeeCentavos,
      assignedCollectorId: input.assignedCollectorId ?? null,
      notes: input.notes ?? null,
      createdBy: actor.userId,
    });

    await repository.insertServiceEvent(tx, {
      serviceAccountId: id,
      eventType: input.status === 'ACTIVE' ? 'ACTIVATED' : 'STATUS_CHANGED',
      fromValue: null,
      toValue: input.status,
      effectiveDate: activationDate ?? billingStartDate,
      reason: 'Account created.',
      actorUserId: actor.userId,
    });

    await writeAudit(tx, {
      action: AUDIT_ACTIONS.SERVICE_ACCOUNT_CREATED,
      entityType: AUDIT_ENTITIES.SERVICE_ACCOUNT,
      entityId: String(id),
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ip: actor.ip,
      newValues: {
        accountNumber,
        subscriberId: input.subscriberId,
        servicePlanId: input.servicePlanId,
        status: input.status,
        currentPlanPriceCentavos: plan.monthlyFeeCentavos,
      },
    });

    return id;
  });

  return getServiceAccount(db, accountId);
}

export async function updateServiceAccount(
  db: Db,
  accountId: number,
  input: UpdateServiceAccountInput,
  actor: ActorContext,
): Promise<ServiceAccountDetail> {
  const existing = await repository.findServiceAccountRow(db, accountId);
  if (existing === null) {
    throw new NotFoundError('That service account does not exist.');
  }

  await assertAddressBelongs(db, input.installationAddressId ?? null, existing.subscriberId);
  await assertCollectorExists(db, input.assignedCollectorId ?? null);

  const today = businessToday();

  await db.transaction(async (tx) => {
    await repository.updateServiceAccountRow(
      tx,
      accountId,
      {
        installationAddressId: input.installationAddressId ?? null,
        billingDay: input.billingDay,
        dueDay: input.dueDay,
        assignedCollectorId: input.assignedCollectorId ?? null,
        notes: input.notes ?? null,
      },
      actor.userId,
    );

    // Each operational change leaves its own history entry, so "when did this
    // move to a different collector?" is answerable months later.
    if (existing.installationAddressId !== (input.installationAddressId ?? null)) {
      await repository.insertServiceEvent(tx, {
        serviceAccountId: accountId,
        eventType: 'ADDRESS_CHANGED',
        fromValue:
          existing.installationAddressId === null ? null : String(existing.installationAddressId),
        toValue: input.installationAddressId === null ? null : String(input.installationAddressId),
        effectiveDate: today,
        reason: null,
        actorUserId: actor.userId,
      });
    }

    if (existing.assignedCollectorId !== (input.assignedCollectorId ?? null)) {
      await repository.insertServiceEvent(tx, {
        serviceAccountId: accountId,
        eventType: 'COLLECTOR_CHANGED',
        fromValue:
          existing.assignedCollectorId === null ? null : String(existing.assignedCollectorId),
        toValue: input.assignedCollectorId === null ? null : String(input.assignedCollectorId),
        effectiveDate: today,
        reason: null,
        actorUserId: actor.userId,
      });
    }

    await writeAudit(tx, {
      action: AUDIT_ACTIONS.SERVICE_ACCOUNT_UPDATED,
      entityType: AUDIT_ENTITIES.SERVICE_ACCOUNT,
      entityId: String(accountId),
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ip: actor.ip,
      oldValues: {
        installationAddressId: existing.installationAddressId,
        assignedCollectorId: existing.assignedCollectorId,
        billingDay: existing.billingDay,
        dueDay: existing.dueDay,
      },
      newValues: {
        installationAddressId: input.installationAddressId ?? null,
        assignedCollectorId: input.assignedCollectorId ?? null,
        billingDay: input.billingDay,
        dueDay: input.dueDay,
      },
    });
  });

  return getServiceAccount(db, accountId);
}

/**
 * Change status.
 *
 * The transition table lives in `@bcis/shared` and is unit-tested there; this
 * function only applies it and records the outcome.
 */
export async function setServiceAccountStatus(
  db: Db,
  accountId: number,
  input: SetServiceAccountStatusInput,
  actor: ActorContext,
): Promise<ServiceAccountDetail> {
  const existing = await repository.findServiceAccountRow(db, accountId);
  if (existing === null) {
    throw new NotFoundError('That service account does not exist.');
  }

  const from = existing.status as ServiceAccountStatus;
  const to = input.status;

  if (from === to) {
    throw new ConflictError(`That account is already ${to.toLowerCase()}.`);
  }

  if (!canTransitionServiceStatus(from, to)) {
    const allowed = ALLOWED_STATUS_TRANSITIONS[from];
    throw new ConflictError(
      allowed.length === 0
        ? `A ${from.toLowerCase()} account cannot be changed.`
        : `Cannot move from ${from.toLowerCase()} to ${to.toLowerCase()}. ` +
            `Allowed from here: ${allowed.map((status) => status.toLowerCase()).join(', ')}.`,
    );
  }

  // The check constraint requires a non-pending account to carry an activation
  // date, so leaving PENDING is when one is first recorded.
  const activationDate = existing.activationDate ?? (to === 'PENDING' ? null : input.effectiveDate);

  await db.transaction(async (tx) => {
    await repository.setServiceAccountStatusRow(tx, accountId, to, activationDate, actor.userId);

    await repository.insertServiceEvent(tx, {
      serviceAccountId: accountId,
      eventType: eventTypeForTransition(from, to),
      fromValue: from,
      toValue: to,
      effectiveDate: input.effectiveDate,
      reason: input.reason,
      actorUserId: actor.userId,
    });

    await writeAudit(tx, {
      action: AUDIT_ACTIONS.SERVICE_ACCOUNT_STATUS_CHANGED,
      entityType: AUDIT_ENTITIES.SERVICE_ACCOUNT,
      entityId: String(accountId),
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ip: actor.ip,
      reason: input.reason,
      oldValues: { status: from, effectiveDate: input.effectiveDate },
      newValues: { status: to },
    });
  });

  return getServiceAccount(db, accountId);
}

/**
 * Move this account onto its plan's current rate.
 *
 * ── WHY THIS IS DELIBERATE ──────────────────────────────────────────────────
 * A price change does not reprice existing customers. This is the action that
 * does, one account at a time, with a reason — so a price rise is a decision
 * someone made and can be shown to have made, not a side effect.
 */
export async function applyPlanRate(
  db: Db,
  accountId: number,
  input: ApplyPlanRateInput,
  actor: ActorContext,
): Promise<ServiceAccountDetail> {
  const existing = await repository.findServiceAccountRow(db, accountId);
  if (existing === null) {
    throw new NotFoundError('That service account does not exist.');
  }

  const currentVersion = await findCurrentPlanByCode(db, existing.planCode);
  if (currentVersion === null) {
    throw new NotFoundError('That plan has no current version.');
  }

  if (currentVersion.monthlyFeeCentavos === existing.currentPlanPriceCentavos) {
    throw new ConflictError('This account is already on the current rate for its plan.');
  }

  await db.transaction(async (tx) => {
    await repository.updateServiceAccountRate(
      tx,
      accountId,
      currentVersion.monthlyFeeCentavos,
      actor.userId,
    );

    await repository.insertServiceEvent(tx, {
      serviceAccountId: accountId,
      eventType: 'RATE_APPLIED',
      fromValue: String(existing.currentPlanPriceCentavos),
      toValue: String(currentVersion.monthlyFeeCentavos),
      effectiveDate: input.effectiveDate,
      reason: input.reason,
      actorUserId: actor.userId,
    });

    await writeAudit(tx, {
      action: AUDIT_ACTIONS.SERVICE_ACCOUNT_RATE_APPLIED,
      entityType: AUDIT_ENTITIES.SERVICE_ACCOUNT,
      entityId: String(accountId),
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ip: actor.ip,
      reason: input.reason,
      oldValues: { currentPlanPriceCentavos: existing.currentPlanPriceCentavos },
      newValues: { currentPlanPriceCentavos: currentVersion.monthlyFeeCentavos },
    });
  });

  return getServiceAccount(db, accountId);
}

/**
 * Move an account to a different plan.
 *
 * The rate is only moved when the caller asks (`applyPlanRate` defaults to
 * true). Passing `false` keeps the account on its existing rate — which is what
 * happens when a customer is switched to a plan of the same value.
 */
export async function changeServiceAccountPlan(
  db: Db,
  accountId: number,
  input: ChangeServiceAccountPlanInput,
  actor: ActorContext,
): Promise<ServiceAccountDetail> {
  const existing = await repository.findServiceAccountRow(db, accountId);
  if (existing === null) {
    throw new NotFoundError('That service account does not exist.');
  }

  if (existing.servicePlanId === input.servicePlanId) {
    throw new ConflictError('That account is already on this plan.');
  }

  const plan = await findPlanById(db, input.servicePlanId);
  if (plan === null) {
    throw new ValidationError('That service plan does not exist.', { field: 'servicePlanId' });
  }

  if (plan.status === 'RETIRED') {
    throw new ConflictError('That plan is retired and cannot be assigned.');
  }

  await db.transaction(async (tx) => {
    await repository.updateServiceAccountPlan(tx, accountId, plan.id, actor.userId);

    await repository.insertServiceEvent(tx, {
      serviceAccountId: accountId,
      eventType: 'PLAN_CHANGED',
      fromValue: existing.planCode,
      toValue: plan.code,
      effectiveDate: input.effectiveDate,
      reason: input.reason,
      actorUserId: actor.userId,
    });

    if (input.applyPlanRate) {
      await repository.updateServiceAccountRate(
        tx,
        accountId,
        plan.monthlyFeeCentavos,
        actor.userId,
      );

      await repository.insertServiceEvent(tx, {
        serviceAccountId: accountId,
        eventType: 'RATE_APPLIED',
        fromValue: String(existing.currentPlanPriceCentavos),
        toValue: String(plan.monthlyFeeCentavos),
        effectiveDate: input.effectiveDate,
        reason: input.reason,
        actorUserId: actor.userId,
      });
    }

    await writeAudit(tx, {
      action: AUDIT_ACTIONS.SERVICE_ACCOUNT_PLAN_CHANGED,
      entityType: AUDIT_ENTITIES.SERVICE_ACCOUNT,
      entityId: String(accountId),
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ip: actor.ip,
      reason: input.reason,
      oldValues: {
        servicePlanId: existing.servicePlanId,
        currentPlanPriceCentavos: existing.currentPlanPriceCentavos,
      },
      newValues: {
        servicePlanId: plan.id,
        currentPlanPriceCentavos: input.applyPlanRate
          ? plan.monthlyFeeCentavos
          : existing.currentPlanPriceCentavos,
      },
    });
  });

  return getServiceAccount(db, accountId);
}

/** Append a free-text note to the account's history. */
export async function addServiceNote(
  db: Db,
  accountId: number,
  effectiveDate: string,
  note: string,
  actor: ActorContext,
): Promise<ServiceAccountDetail> {
  const existing = await repository.findServiceAccountRow(db, accountId);
  if (existing === null) {
    throw new NotFoundError('That service account does not exist.');
  }

  await db.transaction(async (tx) => {
    await repository.insertServiceEvent(tx, {
      serviceAccountId: accountId,
      eventType: 'NOTE',
      fromValue: null,
      toValue: null,
      effectiveDate,
      reason: note,
      actorUserId: actor.userId,
    });

    await writeAudit(tx, {
      action: AUDIT_ACTIONS.SERVICE_ACCOUNT_NOTE,
      entityType: AUDIT_ENTITIES.SERVICE_ACCOUNT,
      entityId: String(accountId),
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ip: actor.ip,
      newValues: { effectiveDate, note },
    });
  });

  return getServiceAccount(db, accountId);
}

async function assertAddressBelongs(
  db: Db,
  addressId: number | null,
  subscriberId: number,
): Promise<void> {
  if (addressId === null) return;

  if (!(await repository.addressBelongsToSubscriber(db, addressId, subscriberId))) {
    throw new ValidationError('That installation address does not belong to this subscriber.', {
      field: 'installationAddressId',
    });
  }
}

async function assertCollectorExists(db: Db, collectorId: number | null): Promise<void> {
  if (collectorId === null) return;

  if (!(await isAssignableUser(db, collectorId))) {
    throw new ValidationError('That collector does not exist.', { field: 'assignedCollectorId' });
  }
}
