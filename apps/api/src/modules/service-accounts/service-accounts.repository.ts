import { schema } from '@bcis/database';
import type { ServiceAccountListQuery } from '@bcis/validation';
import { alias } from 'drizzle-orm/pg-core';
import { and, asc, count, eq, ilike, or, sql, type SQL } from 'drizzle-orm';

import type { Executor, Tx } from '../../shared/database';

/**
 * Service account queries.
 *
 * ── WHY THE CURRENT PLAN PRICE IS JOINED IN ─────────────────────────────────
 * `service_accounts.current_plan_price_centavos` is a snapshot, and the list
 * shows it alongside the plan version's price TODAY. When the two differ the
 * account is on an older rate — which is a normal, deliberate state, and one an
 * operator should be able to see rather than infer.
 */

export interface ServiceAccountRow {
  readonly id: number;
  readonly accountNumber: string;
  readonly subscriberId: number;
  readonly subscriberAccountNumber: string;
  readonly subscriberName: string;
  readonly servicePlanId: number;
  readonly installationAddressId: number | null;
  readonly planCode: string;
  readonly planName: string;
  readonly serviceTypeCode: string;
  readonly serviceTypeName: string;
  readonly status: string;
  readonly activationDate: string | null;
  readonly billingStartDate: string;
  readonly billingDay: number;
  readonly dueDay: number;
  readonly currentPlanPriceCentavos: number;
  readonly planCurrentPriceCentavos: number;
  readonly assignedCollectorId: number | null;
  readonly assignedCollectorName: string | null;
  readonly notes: string | null;
  readonly createdAt: Date;
}

export interface ServiceEventRow {
  readonly id: number;
  readonly eventType: string;
  readonly fromValue: string | null;
  readonly toValue: string | null;
  readonly effectiveDate: string;
  readonly reason: string | null;
  readonly actorUsername: string | null;
  readonly createdAt: Date;
}

/** The open-ended version of the same plan code. */
const currentPlanVersion = alias(schema.servicePlans, 'current_plan_version');

const listProjection = {
  id: schema.serviceAccounts.id,
  accountNumber: schema.serviceAccounts.accountNumber,
  subscriberId: schema.serviceAccounts.subscriberId,
  subscriberAccountNumber: schema.subscribers.accountNumber,
  subscriberName: schema.subscribers.displayName,
  servicePlanId: schema.serviceAccounts.servicePlanId,
  installationAddressId: schema.serviceAccounts.installationAddressId,
  planCode: schema.servicePlans.code,
  planName: schema.servicePlans.name,
  serviceTypeCode: schema.serviceTypes.code,
  serviceTypeName: schema.serviceTypes.name,
  status: schema.serviceAccounts.status,
  activationDate: schema.serviceAccounts.activationDate,
  billingStartDate: schema.serviceAccounts.billingStartDate,
  billingDay: schema.serviceAccounts.billingDay,
  dueDay: schema.serviceAccounts.dueDay,
  currentPlanPriceCentavos: schema.serviceAccounts.currentPlanPriceCentavos,
  // `coalesce` rather than a nullable column: a plan always has an open version
  // in practice, and if one somehow does not, reporting the account's own rate
  // reads as "no drift" instead of putting a null in a money column on screen.
  planCurrentPriceCentavos: sql<number>`coalesce(${currentPlanVersion.monthlyFeeCentavos}, ${schema.serviceAccounts.currentPlanPriceCentavos})`,
  assignedCollectorId: schema.serviceAccounts.assignedCollectorId,
  assignedCollectorName: schema.users.fullName,
  notes: schema.serviceAccounts.notes,
  createdAt: schema.serviceAccounts.createdAt,
} as const;

function buildFilters(query: ServiceAccountListQuery): SQL | undefined {
  const conditions: SQL[] = [];

  if (query.status !== undefined) conditions.push(eq(schema.serviceAccounts.status, query.status));

  if (query.subscriberId !== undefined) {
    conditions.push(eq(schema.serviceAccounts.subscriberId, query.subscriberId));
  }

  if (query.serviceType !== undefined) {
    conditions.push(eq(schema.serviceTypes.code, query.serviceType));
  }

  if (query.search !== undefined && query.search.length > 0) {
    const pattern = `%${query.search}%`;
    const search = or(
      ilike(schema.serviceAccounts.accountNumber, pattern),
      ilike(schema.subscribers.accountNumber, pattern),
      ilike(schema.subscribers.displayName, pattern),
    );
    if (search !== undefined) conditions.push(search);
  }

  if (conditions.length === 0) return undefined;
  return and(...conditions);
}

/** The joins are shared by the list and the single-row read. */
function baseQuery(db: Executor) {
  return db
    .select(listProjection)
    .from(schema.serviceAccounts)
    .innerJoin(schema.subscribers, eq(schema.serviceAccounts.subscriberId, schema.subscribers.id))
    .innerJoin(
      schema.servicePlans,
      eq(schema.serviceAccounts.servicePlanId, schema.servicePlans.id),
    )
    .innerJoin(schema.serviceTypes, eq(schema.servicePlans.serviceTypeId, schema.serviceTypes.id))
    .leftJoin(schema.users, eq(schema.serviceAccounts.assignedCollectorId, schema.users.id))
    .leftJoin(
      currentPlanVersion,
      and(
        eq(currentPlanVersion.code, schema.servicePlans.code),
        sql`${currentPlanVersion.effectiveTo} IS NULL`,
      ),
    );
}

export async function listServiceAccounts(
  db: Executor,
  query: ServiceAccountListQuery,
  offset: number,
): Promise<readonly ServiceAccountRow[]> {
  return baseQuery(db)
    .where(buildFilters(query))
    .orderBy(asc(schema.serviceAccounts.accountNumber))
    .limit(query.pageSize)
    .offset(offset);
}

export async function countServiceAccounts(
  db: Executor,
  query: ServiceAccountListQuery,
): Promise<number> {
  const rows = await db
    .select({ total: count() })
    .from(schema.serviceAccounts)
    .innerJoin(schema.subscribers, eq(schema.serviceAccounts.subscriberId, schema.subscribers.id))
    .innerJoin(
      schema.servicePlans,
      eq(schema.serviceAccounts.servicePlanId, schema.servicePlans.id),
    )
    .innerJoin(schema.serviceTypes, eq(schema.servicePlans.serviceTypeId, schema.serviceTypes.id))
    .where(buildFilters(query));

  return rows[0]?.total ?? 0;
}

export async function findServiceAccountRow(
  db: Executor,
  accountId: number,
): Promise<ServiceAccountRow | null> {
  const rows = await baseQuery(db).where(eq(schema.serviceAccounts.id, accountId)).limit(1);
  return rows[0] ?? null;
}

export async function listServiceEvents(
  db: Executor,
  accountId: number,
): Promise<readonly ServiceEventRow[]> {
  const rows = await db
    .select({
      id: schema.serviceEvents.id,
      eventType: schema.serviceEvents.eventType,
      fromValue: schema.serviceEvents.fromValue,
      toValue: schema.serviceEvents.toValue,
      effectiveDate: schema.serviceEvents.effectiveDate,
      reason: schema.serviceEvents.reason,
      actorUsername: schema.users.username,
      createdAt: schema.serviceEvents.createdAt,
    })
    .from(schema.serviceEvents)
    .leftJoin(schema.users, eq(schema.serviceEvents.actorUserId, schema.users.id))
    .where(eq(schema.serviceEvents.serviceAccountId, accountId))
    // Newest first: the question is almost always "what happened recently?".
    .orderBy(sql`${schema.serviceEvents.effectiveDate} DESC`, sql`${schema.serviceEvents.id} DESC`);

  return rows;
}

export async function countActiveAccounts(db: Executor, subscriberId: number): Promise<number> {
  const rows = await db
    .select({ total: count() })
    .from(schema.serviceAccounts)
    .where(
      and(
        eq(schema.serviceAccounts.subscriberId, subscriberId),
        eq(schema.serviceAccounts.status, 'ACTIVE'),
      ),
    );

  return rows[0]?.total ?? 0;
}

/** Whether an address belongs to a subscriber — checked before it is referenced. */
export async function addressBelongsToSubscriber(
  db: Executor,
  addressId: number,
  subscriberId: number,
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.subscriberAddresses.id })
    .from(schema.subscriberAddresses)
    .where(
      and(
        eq(schema.subscriberAddresses.id, addressId),
        eq(schema.subscriberAddresses.subscriberId, subscriberId),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

export interface InsertServiceAccountValues {
  readonly accountNumber: string;
  readonly subscriberId: number;
  readonly servicePlanId: number;
  readonly installationAddressId: number | null;
  readonly status: string;
  readonly activationDate: string | null;
  readonly billingStartDate: string;
  readonly billingDay: number;
  readonly dueDay: number;
  readonly currentPlanPriceCentavos: number;
  readonly assignedCollectorId: number | null;
  readonly notes: string | null;
  readonly createdBy: number | null;
}

export async function insertServiceAccount(
  tx: Tx,
  values: InsertServiceAccountValues,
): Promise<number> {
  const rows = await tx
    .insert(schema.serviceAccounts)
    .values({ ...values, updatedBy: values.createdBy })
    .returning({ id: schema.serviceAccounts.id });

  const id = rows[0]?.id;
  if (id === undefined) throw new Error('Inserting a service account returned no id.');
  return id;
}

export async function updateServiceAccountRow(
  tx: Tx,
  accountId: number,
  values: {
    readonly installationAddressId: number | null;
    readonly billingDay: number;
    readonly dueDay: number;
    readonly assignedCollectorId: number | null;
    readonly notes: string | null;
  },
  updatedBy: number | null,
): Promise<void> {
  await tx
    .update(schema.serviceAccounts)
    .set({ ...values, updatedAt: new Date(), updatedBy })
    .where(eq(schema.serviceAccounts.id, accountId));
}

/**
 * Change status.
 *
 * `activationDate` is only ever SET, never cleared: a check constraint requires
 * a non-pending account to have one, and a PENDING account to not.
 */
export async function setServiceAccountStatusRow(
  tx: Tx,
  accountId: number,
  status: string,
  activationDate: string | null,
  updatedBy: number | null,
): Promise<void> {
  const patch: Partial<typeof schema.serviceAccounts.$inferInsert> = {
    status,
    updatedAt: new Date(),
    updatedBy,
  };
  if (activationDate !== null) {
    patch.activationDate = activationDate;
  }

  await tx
    .update(schema.serviceAccounts)
    .set(patch)
    .where(eq(schema.serviceAccounts.id, accountId));
}

export async function updateServiceAccountRate(
  tx: Tx,
  accountId: number,
  monthlyFeeCentavos: number,
  updatedBy: number | null,
): Promise<void> {
  await tx
    .update(schema.serviceAccounts)
    .set({
      currentPlanPriceCentavos: monthlyFeeCentavos,
      updatedAt: new Date(),
      updatedBy,
    })
    .where(eq(schema.serviceAccounts.id, accountId));
}

export async function updateServiceAccountPlan(
  tx: Tx,
  accountId: number,
  servicePlanId: number,
  updatedBy: number | null,
): Promise<void> {
  await tx
    .update(schema.serviceAccounts)
    .set({ servicePlanId, updatedAt: new Date(), updatedBy })
    .where(eq(schema.serviceAccounts.id, accountId));
}

export interface InsertEventValues {
  readonly serviceAccountId: number;
  readonly eventType: string;
  readonly fromValue: string | null;
  readonly toValue: string | null;
  readonly effectiveDate: string;
  readonly reason: string | null;
  readonly actorUserId: number | null;
}

export async function insertServiceEvent(tx: Tx, values: InsertEventValues): Promise<void> {
  await tx.insert(schema.serviceEvents).values(values);
}

export interface AddressDetailRow {
  readonly id: number;
  readonly addressType: string;
  readonly label: string | null;
  readonly line1: string;
  readonly line2: string | null;
  readonly barangay: string | null;
  readonly cityMunicipality: string | null;
  readonly province: string | null;
  readonly postalCode: string | null;
}

export async function findAddressById(
  db: Executor,
  addressId: number,
): Promise<AddressDetailRow | null> {
  const rows = await db
    .select({
      id: schema.subscriberAddresses.id,
      addressType: schema.subscriberAddresses.addressType,
      label: schema.subscriberAddresses.label,
      line1: schema.subscriberAddresses.line1,
      line2: schema.subscriberAddresses.line2,
      barangay: schema.subscriberAddresses.barangay,
      cityMunicipality: schema.subscriberAddresses.cityMunicipality,
      province: schema.subscriberAddresses.province,
      postalCode: schema.subscriberAddresses.postalCode,
    })
    .from(schema.subscriberAddresses)
    .where(eq(schema.subscriberAddresses.id, addressId))
    .limit(1);

  return rows[0] ?? null;
}
