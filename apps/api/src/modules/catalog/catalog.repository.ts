import { schema } from '@bcis/database';
import type { PlanListQuery } from '@bcis/validation';
import { and, asc, count, eq, ilike, inArray, isNull, or, type SQL } from 'drizzle-orm';

import type { Executor, Tx } from '../../shared/database';

/**
 * Service type and plan queries.
 *
 * The plan list is per-VERSION, not per-plan: `INT-100` at ₱999 and `INT-100` at
 * ₱1,299 are two rows, and the list shows both when `currentOnly` is off. That
 * is the whole point of the design — the history is queryable, not implied.
 */

export interface PlanRow {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly serviceTypeId: number;
  readonly serviceTypeCode: string;
  readonly serviceTypeName: string;
  readonly speedMbps: number | null;
  readonly channelCount: number | null;
  readonly monthlyFeeCentavos: number;
  readonly installationFeeCentavos: number;
  readonly reconnectionFeeCentavos: number;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly status: string;
  readonly createdAt: Date;
  readonly serviceAccountCount: number;
}

export interface ServiceTypeRow {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly planCount: number;
}

const planProjection = {
  id: schema.servicePlans.id,
  code: schema.servicePlans.code,
  name: schema.servicePlans.name,
  description: schema.servicePlans.description,
  serviceTypeId: schema.servicePlans.serviceTypeId,
  serviceTypeCode: schema.serviceTypes.code,
  serviceTypeName: schema.serviceTypes.name,
  speedMbps: schema.servicePlans.speedMbps,
  channelCount: schema.servicePlans.channelCount,
  monthlyFeeCentavos: schema.servicePlans.monthlyFeeCentavos,
  installationFeeCentavos: schema.servicePlans.installationFeeCentavos,
  reconnectionFeeCentavos: schema.servicePlans.reconnectionFeeCentavos,
  effectiveFrom: schema.servicePlans.effectiveFrom,
  effectiveTo: schema.servicePlans.effectiveTo,
  status: schema.servicePlans.status,
  createdAt: schema.servicePlans.createdAt,
} as const;

function buildPlanFilters(query: PlanListQuery): SQL | undefined {
  const conditions: SQL[] = [];

  if (query.currentOnly) {
    conditions.push(isNull(schema.servicePlans.effectiveTo));
  }

  if (query.serviceType !== undefined) {
    conditions.push(eq(schema.serviceTypes.code, query.serviceType));
  }

  if (query.status !== undefined) {
    conditions.push(eq(schema.servicePlans.status, query.status));
  }

  if (query.search !== undefined && query.search.length > 0) {
    const pattern = `%${query.search}%`;
    const search = or(
      ilike(schema.servicePlans.code, pattern),
      ilike(schema.servicePlans.name, pattern),
    );
    if (search !== undefined) conditions.push(search);
  }

  if (conditions.length === 0) return undefined;
  return and(...conditions);
}

/** How many service accounts are billed on each plan VERSION. */
async function loadAccountCounts(
  db: Executor,
  planIds: readonly number[],
): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  if (planIds.length === 0) return counts;

  const rows = await db
    .select({ planId: schema.serviceAccounts.servicePlanId, total: count() })
    .from(schema.serviceAccounts)
    .where(inArray(schema.serviceAccounts.servicePlanId, [...planIds]))
    .groupBy(schema.serviceAccounts.servicePlanId);

  for (const row of rows) {
    counts.set(row.planId, row.total);
  }
  return counts;
}

export async function listPlans(
  db: Executor,
  query: PlanListQuery,
  offset: number,
): Promise<readonly PlanRow[]> {
  const rows = await db
    .select(planProjection)
    .from(schema.servicePlans)
    .innerJoin(schema.serviceTypes, eq(schema.servicePlans.serviceTypeId, schema.serviceTypes.id))
    .where(buildPlanFilters(query))
    // Newest version first within a code, then by code, so a price history
    // reads top-down the way a person expects.
    .orderBy(asc(schema.servicePlans.code), asc(schema.servicePlans.effectiveFrom))
    .limit(query.pageSize)
    .offset(offset);

  const counts = await loadAccountCounts(
    db,
    rows.map((row) => row.id),
  );

  return rows.map((row) => ({
    ...row,
    effectiveFrom: String(row.effectiveFrom),
    serviceAccountCount: counts.get(row.id) ?? 0,
  }));
}

export async function countPlans(db: Executor, query: PlanListQuery): Promise<number> {
  const rows = await db
    .select({ total: count() })
    .from(schema.servicePlans)
    .innerJoin(schema.serviceTypes, eq(schema.servicePlans.serviceTypeId, schema.serviceTypes.id))
    .where(buildPlanFilters(query));

  return rows[0]?.total ?? 0;
}

export async function findPlanById(db: Executor, planId: number): Promise<PlanRow | null> {
  const rows = await db
    .select(planProjection)
    .from(schema.servicePlans)
    .innerJoin(schema.serviceTypes, eq(schema.servicePlans.serviceTypeId, schema.serviceTypes.id))
    .where(eq(schema.servicePlans.id, planId))
    .limit(1);

  const row = rows[0];
  if (row === undefined) return null;

  const counts = await loadAccountCounts(db, [row.id]);

  return {
    ...row,
    effectiveFrom: String(row.effectiveFrom),
    serviceAccountCount: counts.get(row.id) ?? 0,
  };
}

/** The open-ended version of a plan — the one a new account would be given. */
export async function findCurrentPlanByCode(db: Executor, code: string): Promise<PlanRow | null> {
  const rows = await db
    .select(planProjection)
    .from(schema.servicePlans)
    .innerJoin(schema.serviceTypes, eq(schema.servicePlans.serviceTypeId, schema.serviceTypes.id))
    .where(and(eq(schema.servicePlans.code, code), isNull(schema.servicePlans.effectiveTo)))
    .limit(1);

  const row = rows[0];
  if (row === undefined) return null;

  const counts = await loadAccountCounts(db, [row.id]);

  return {
    ...row,
    effectiveFrom: String(row.effectiveFrom),
    serviceAccountCount: counts.get(row.id) ?? 0,
  };
}

export async function planCodeExists(db: Executor, code: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.servicePlans.id })
    .from(schema.servicePlans)
    .where(eq(schema.servicePlans.code, code))
    .limit(1);

  return rows.length > 0;
}

export async function listServiceTypes(db: Executor): Promise<readonly ServiceTypeRow[]> {
  const rows = await db
    .select({
      id: schema.serviceTypes.id,
      code: schema.serviceTypes.code,
      name: schema.serviceTypes.name,
      description: schema.serviceTypes.description,
      planCount: count(schema.servicePlans.id),
    })
    .from(schema.serviceTypes)
    .leftJoin(schema.servicePlans, eq(schema.servicePlans.serviceTypeId, schema.serviceTypes.id))
    .groupBy(
      schema.serviceTypes.id,
      schema.serviceTypes.code,
      schema.serviceTypes.name,
      schema.serviceTypes.description,
    )
    .orderBy(asc(schema.serviceTypes.id));

  return rows;
}

export async function findServiceTypeByCode(
  db: Executor,
  code: string,
): Promise<{ id: number; code: string; name: string } | null> {
  const rows = await db
    .select({
      id: schema.serviceTypes.id,
      code: schema.serviceTypes.code,
      name: schema.serviceTypes.name,
    })
    .from(schema.serviceTypes)
    .where(eq(schema.serviceTypes.code, code))
    .limit(1);

  return rows[0] ?? null;
}

export interface InsertPlanValues {
  readonly code: string;
  readonly serviceTypeId: number;
  readonly name: string;
  readonly description: string | null;
  readonly speedMbps: number | null;
  readonly channelCount: number | null;
  readonly monthlyFeeCentavos: number;
  readonly installationFeeCentavos: number;
  readonly reconnectionFeeCentavos: number;
  readonly effectiveFrom: string;
  readonly createdBy: number | null;
}

export async function insertPlan(db: Executor, values: InsertPlanValues): Promise<number> {
  const rows = await db
    .insert(schema.servicePlans)
    .values({ ...values, updatedBy: values.createdBy })
    .returning({ id: schema.servicePlans.id });

  const id = rows[0]?.id;
  if (id === undefined) throw new Error('Inserting a service plan returned no id.');
  return id;
}

/**
 * Close a version by setting its `effective_to`.
 *
 * This is the only legitimate "edit" to a plan's price history, and it never
 * touches an amount — it only records that the version stopped applying.
 */
export async function closePlanVersion(
  tx: Tx,
  planId: number,
  effectiveTo: string,
  updatedBy: number | null,
): Promise<void> {
  await tx
    .update(schema.servicePlans)
    .set({ effectiveTo, updatedAt: new Date(), updatedBy })
    .where(eq(schema.servicePlans.id, planId));
}

export async function updatePlanAttributes(
  tx: Tx,
  planId: number,
  values: {
    readonly name: string;
    readonly description: string | null;
    readonly speedMbps: number | null;
    readonly channelCount: number | null;
  },
  updatedBy: number | null,
): Promise<void> {
  await tx
    .update(schema.servicePlans)
    .set({ ...values, updatedAt: new Date(), updatedBy })
    .where(eq(schema.servicePlans.id, planId));
}

export async function setPlanStatus(
  tx: Tx,
  planId: number,
  status: 'ACTIVE' | 'RETIRED',
  updatedBy: number | null,
): Promise<void> {
  await tx
    .update(schema.servicePlans)
    .set({ status, updatedAt: new Date(), updatedBy })
    .where(eq(schema.servicePlans.id, planId));
}
