import { ConflictError, NotFoundError, ValidationError, addBusinessDays } from '@bcis/shared';
import {
  offsetFor,
  type ChangePlanPriceInput,
  type CreatePlanInput,
  type PlanListQuery,
  type PlanSummary,
  type RetirePlanInput,
  type ServiceTypeCode,
  type ServiceTypeSummary,
  type UpdatePlanInput,
} from '@bcis/validation';

import type { Db } from '../../shared/database';
import type { ActorContext } from '../../shared/request-context';
import { AUDIT_ACTIONS, AUDIT_ENTITIES } from '../audit/audit.actions';
import { writeAudit } from '../audit/audit.service';
import * as repository from './catalog.repository';
import { toPlanSummary, toServiceTypeSummary } from './catalog.mapper';

/**
 * The plan catalog.
 *
 * ── THE ONE RULE WORTH REPEATING ────────────────────────────────────────────
 * `updatePlan` cannot change a price — there is no fee field on its input type.
 * `changePlanPrice` does not modify a price either: it closes the current
 * version and inserts a new one. The old row keeps its amount for as long as
 * the database exists, which is what makes "the rate this customer was billed"
 * a fact rather than a reconstruction.
 */

export interface PlanPage {
  readonly plans: readonly PlanSummary[];
  readonly total: number;
}

export async function listServiceTypes(db: Db): Promise<readonly ServiceTypeSummary[]> {
  const rows = await repository.listServiceTypes(db);
  return rows.map(toServiceTypeSummary);
}

export async function listPlans(db: Db, query: PlanListQuery): Promise<PlanPage> {
  const offset = offsetFor(query.page, query.pageSize);

  const [rows, total] = await Promise.all([
    repository.listPlans(db, query, offset),
    repository.countPlans(db, query),
  ]);

  return { plans: rows.map(toPlanSummary), total };
}

export async function getPlan(db: Db, planId: number): Promise<PlanSummary> {
  const row = await repository.findPlanById(db, planId);
  if (row === null) {
    throw new NotFoundError('That service plan does not exist.');
  }
  return toPlanSummary(row);
}

/**
 * Create a plan's first version.
 *
 * A code may be used only once at creation. A second version of an existing
 * code is produced by `changePlanPrice`, which is why this refuses rather than
 * quietly creating a second open-ended row for the same plan.
 */
export async function createPlan(
  db: Db,
  input: CreatePlanInput,
  actor: ActorContext,
): Promise<PlanSummary> {
  if (await repository.planCodeExists(db, input.code)) {
    throw new ConflictError(
      `Plan code ${input.code} already exists. Change its price to create a new version instead.`,
    );
  }

  const serviceType = await repository.findServiceTypeByCode(db, input.serviceTypeCode);
  if (serviceType === null) {
    throw new ValidationError(`Unknown service type: ${input.serviceTypeCode}.`, {
      field: 'serviceTypeCode',
    });
  }

  const planId = await db.transaction(async (tx) => {
    const id = await repository.insertPlan(tx, {
      code: input.code,
      serviceTypeId: serviceType.id,
      name: input.name,
      description: input.description ?? null,
      speedMbps: input.speedMbps ?? null,
      channelCount: input.channelCount ?? null,
      monthlyFeeCentavos: input.monthlyFeeCentavos,
      installationFeeCentavos: input.installationFeeCentavos,
      reconnectionFeeCentavos: input.reconnectionFeeCentavos,
      effectiveFrom: input.effectiveFrom,
      createdBy: actor.userId,
    });

    await writeAudit(tx, {
      action: AUDIT_ACTIONS.PLAN_CREATED,
      entityType: AUDIT_ENTITIES.SERVICE_PLAN,
      entityId: String(id),
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ip: actor.ip,
      newValues: {
        code: input.code,
        serviceTypeCode: input.serviceTypeCode,
        monthlyFeeCentavos: input.monthlyFeeCentavos,
        effectiveFrom: input.effectiveFrom,
      },
    });

    return id;
  });

  return getPlan(db, planId);
}

/**
 * Edit the current version's non-price attributes.
 *
 * Only the open-ended version may be edited: changing the name of a version
 * that was superseded in March would rewrite what a March statement said.
 */
export async function updatePlan(
  db: Db,
  planId: number,
  input: UpdatePlanInput,
  actor: ActorContext,
): Promise<PlanSummary> {
  const existing = await repository.findPlanById(db, planId);
  if (existing === null) {
    throw new NotFoundError('That service plan does not exist.');
  }

  if (existing.effectiveTo !== null) {
    throw new ConflictError(
      'Only the current version of a plan can be edited. Superseded versions are history.',
    );
  }

  assertAttributesMatchType(
    existing.serviceTypeCode as ServiceTypeCode,
    input.speedMbps ?? existing.speedMbps,
    input.channelCount ?? existing.channelCount,
  );

  await db.transaction(async (tx) => {
    await repository.updatePlanAttributes(
      tx,
      planId,
      {
        name: input.name,
        description: input.description ?? null,
        speedMbps: input.speedMbps ?? null,
        channelCount: input.channelCount ?? null,
      },
      actor.userId,
    );

    await writeAudit(tx, {
      action: AUDIT_ACTIONS.PLAN_UPDATED,
      entityType: AUDIT_ENTITIES.SERVICE_PLAN,
      entityId: String(planId),
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ip: actor.ip,
      oldValues: {
        name: existing.name,
        speedMbps: existing.speedMbps,
        channelCount: existing.channelCount,
      },
      newValues: {
        name: input.name,
        speedMbps: input.speedMbps ?? null,
        channelCount: input.channelCount ?? null,
      },
    });
  });

  return getPlan(db, planId);
}

/**
 * Change a plan's price by creating a new version.
 *
 * ── WHAT THIS DOES **NOT** DO ───────────────────────────────────────────────
 * It does not reprice a single existing service account. Those keep the rate
 * they were activated at until someone explicitly applies the new one
 * (`applyPlanRate`). Silently repricing customers whose bills were already
 * issued is exactly the class of change this system exists to prevent.
 */
export async function changePlanPrice(
  db: Db,
  planId: number,
  input: ChangePlanPriceInput,
  actor: ActorContext,
): Promise<PlanSummary> {
  const current = await repository.findPlanById(db, planId);
  if (current === null) {
    throw new NotFoundError('That service plan does not exist.');
  }

  if (current.effectiveTo !== null) {
    throw new ConflictError(
      'That version has already been superseded. Change the price of the current version instead.',
    );
  }

  if (input.effectiveFrom <= current.effectiveFrom) {
    throw new ValidationError(`A new version must start after ${current.effectiveFrom}.`, {
      field: 'effectiveFrom',
      currentVersionFrom: current.effectiveFrom,
    });
  }

  // The day before the new version starts. `addBusinessDays` handles month and
  // year boundaries using UTC arithmetic, so no local date can shift it.
  const previousEffectiveTo = addBusinessDays(input.effectiveFrom, -1);

  const newPlanId = await db.transaction(async (tx) => {
    await repository.closePlanVersion(tx, current.id, previousEffectiveTo, actor.userId);

    const id = await repository.insertPlan(tx, {
      code: current.code,
      serviceTypeId: current.serviceTypeId,
      name: input.name ?? current.name,
      description: current.description,
      speedMbps: current.speedMbps,
      channelCount: current.channelCount,
      monthlyFeeCentavos: input.monthlyFeeCentavos,
      installationFeeCentavos: input.installationFeeCentavos ?? current.installationFeeCentavos,
      reconnectionFeeCentavos: input.reconnectionFeeCentavos ?? current.reconnectionFeeCentavos,
      effectiveFrom: input.effectiveFrom,
      createdBy: actor.userId,
    });

    await writeAudit(tx, {
      action: AUDIT_ACTIONS.PLAN_PRICE_CHANGED,
      entityType: AUDIT_ENTITIES.SERVICE_PLAN,
      entityId: String(id),
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ip: actor.ip,
      reason: input.reason,
      oldValues: {
        planVersionId: current.id,
        monthlyFeeCentavos: current.monthlyFeeCentavos,
        effectiveTo: previousEffectiveTo,
      },
      newValues: {
        planVersionId: id,
        monthlyFeeCentavos: input.monthlyFeeCentavos,
        effectiveFrom: input.effectiveFrom,
        // Stated explicitly so the audit answers "did this reprice anyone?".
        accountsRepriced: 0,
      },
    });

    return id;
  });

  return getPlan(db, newPlanId);
}

/**
 * Retire a plan.
 *
 * The plan stops being offered — it disappears from the picker that new
 * accounts use — while the accounts already billed on it keep working. That is
 * the difference between retiring and deleting, and it is why `status` and
 * `effective_to` are separate ideas.
 */
export async function retirePlan(
  db: Db,
  planId: number,
  input: RetirePlanInput,
  actor: ActorContext,
): Promise<PlanSummary> {
  const existing = await repository.findPlanById(db, planId);
  if (existing === null) {
    throw new NotFoundError('That service plan does not exist.');
  }

  if (existing.status === 'RETIRED') {
    throw new ConflictError('That plan is already retired.');
  }

  await db.transaction(async (tx) => {
    await repository.setPlanStatus(tx, planId, 'RETIRED', actor.userId);

    await writeAudit(tx, {
      action: AUDIT_ACTIONS.PLAN_RETIRED,
      entityType: AUDIT_ENTITIES.SERVICE_PLAN,
      entityId: String(planId),
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ip: actor.ip,
      reason: input.reason,
      newValues: { status: 'RETIRED', accountsStillBilled: existing.serviceAccountCount },
    });
  });

  return getPlan(db, planId);
}

/** An attribute that belongs to another service type is a mistake, not a choice. */
function assertAttributesMatchType(
  serviceTypeCode: ServiceTypeCode,
  speedMbps: number | null,
  channelCount: number | null,
): void {
  if (speedMbps !== null && serviceTypeCode === 'CABLE') {
    throw new ValidationError('A Cable plan does not have a download speed.', {
      field: 'speedMbps',
    });
  }

  if (channelCount !== null && serviceTypeCode === 'INTERNET') {
    throw new ValidationError('An Internet plan does not have a channel count.', {
      field: 'channelCount',
    });
  }
}
