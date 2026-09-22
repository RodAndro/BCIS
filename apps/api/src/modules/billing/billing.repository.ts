import { schema } from '@bcis/database';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  ilike,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';

import type { Executor, Tx } from '../../shared/database';
import type { InvoiceListQuery } from '@bcis/validation';

/**
 * Billing queries.
 *
 * Drizzle only — the rules live in `@bcis/domain` and the transaction boundary
 * lives in the service. This file fetches and writes rows.
 */

export interface BillingCycleRow {
  readonly id: number;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly dueDate: string;
  readonly label: string;
  readonly status: string;
  readonly generatedAt: Date | null;
  readonly invoiceCount: number;
  readonly billedCentavos: number;
}

export interface BillableAccountRow {
  readonly id: number;
  readonly accountNumber: string;
  readonly subscriberId: number;
  readonly subscriberAccountNumber: string;
  readonly subscriberName: string;
  readonly servicePlanId: number;
  readonly planCode: string;
  readonly planName: string;
  readonly billingDay: number;
  readonly dueDay: number;
  readonly currentPlanPriceCentavos: number;
  readonly installationFeeCentavos: number;
  readonly reconnectionFeeCentavos: number;
  readonly installationFeeCharged: boolean;
}

export interface InvoiceRow {
  readonly id: number;
  readonly invoiceNumber: string;
  readonly subscriberId: number;
  readonly subscriberAccountNumber: string;
  readonly subscriberName: string;
  readonly serviceAccountId: number;
  readonly serviceAccountNumber: string;
  readonly servicePlanId: number;
  readonly planCode: string;
  readonly billingPeriodStart: string;
  readonly billingPeriodEnd: string;
  readonly issueDate: string;
  readonly dueDate: string;
  readonly subtotalCentavos: number;
  readonly discountCentavos: number;
  readonly penaltyCentavos: number;
  readonly adjustmentCentavos: number;
  readonly taxCentavos: number;
  readonly totalCentavos: number;
  readonly paidCentavos: number;
  readonly balanceCentavos: number;
  readonly status: string;
  readonly finalizedAt: Date | null;
  readonly voidedAt: Date | null;
  readonly voidReason: string | null;
  readonly createdAt: Date;
}

export interface InvoiceItemRow {
  readonly id: number;
  readonly itemType: string;
  readonly direction: string;
  readonly description: string;
  readonly quantity: number;
  readonly unitPriceCentavos: number;
  readonly amountCentavos: number;
}

export interface AdjustmentRow {
  readonly id: number;
  readonly adjustmentType: string;
  readonly reasonCode: string;
  readonly amountCentavos: number;
  readonly memo: string;
  readonly status: string;
  readonly createdAt: Date;
  readonly createdByUsername: string | null;
}

/* ────────────────────────────── Billing cycles ────────────────────────────── */

export async function findCycleByPeriodStart(
  db: Executor,
  periodStart: string,
): Promise<BillingCycleRow | null> {
  const rows = await cycleQuery(db)
    .where(eq(schema.billingCycles.periodStart, periodStart))
    .limit(1);
  return rows[0] ?? null;
}

export async function listCycles(db: Executor, limit: number): Promise<readonly BillingCycleRow[]> {
  return cycleQuery(db).orderBy(desc(schema.billingCycles.periodStart)).limit(limit);
}

/** Cycles with their invoice counts and billed totals, from live invoices only. */
function cycleQuery(db: Executor) {
  return db
    .select({
      id: schema.billingCycles.id,
      periodStart: schema.billingCycles.periodStart,
      periodEnd: schema.billingCycles.periodEnd,
      dueDate: schema.billingCycles.dueDate,
      label: schema.billingCycles.label,
      status: schema.billingCycles.status,
      generatedAt: schema.billingCycles.generatedAt,
      invoiceCount: sql<number>`(
        SELECT count(*)::int FROM invoices i
         WHERE i.billing_cycle_id = ${schema.billingCycles.id} AND i.status <> 'VOID'
      )`,
      billedCentavos: sql<number>`(
        SELECT COALESCE(SUM(i.total_centavos), 0)::bigint FROM invoices i
         WHERE i.billing_cycle_id = ${schema.billingCycles.id} AND i.status <> 'VOID'
      )`,
    })
    .from(schema.billingCycles);
}

export async function insertCycle(
  tx: Tx,
  values: {
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly dueDate: string;
    readonly label: string;
    readonly createdBy: number | null;
  },
): Promise<number> {
  const rows = await tx
    .insert(schema.billingCycles)
    .values({ ...values, updatedBy: values.createdBy })
    .returning({ id: schema.billingCycles.id });

  const id = rows[0]?.id;
  if (id === undefined) throw new Error('Inserting a billing cycle returned no id.');
  return id;
}

export async function setCycleStatus(
  tx: Tx,
  cycleId: number,
  status: string,
  actorUserId: number | null,
  generatedAt: Date | null,
): Promise<void> {
  await tx
    .update(schema.billingCycles)
    .set({
      status,
      updatedAt: new Date(),
      updatedBy: actorUserId,
      ...(generatedAt === null ? {} : { generatedAt, generatedBy: actorUserId }),
    })
    .where(eq(schema.billingCycles.id, cycleId));
}

/* ─────────────────────────── Accounts to be billed ────────────────────────── */

/**
 * Active accounts whose service had started by the end of the period.
 *
 * A SUSPENDED, DISCONNECTED or CLOSED account is NOT billed — that is the whole
 * point of a lifecycle. A PENDING account has never delivered service.
 */
export async function listBillableAccounts(
  db: Executor,
  input: {
    readonly periodEnd: string;
    readonly collectionAreaId?: number | undefined;
    readonly serviceAccountIds?: readonly number[] | undefined;
  },
): Promise<readonly BillableAccountRow[]> {
  const conditions: SQL[] = [
    eq(schema.serviceAccounts.status, 'ACTIVE'),
    lte(schema.serviceAccounts.billingStartDate, input.periodEnd),
  ];

  if (input.collectionAreaId !== undefined) {
    conditions.push(eq(schema.subscribers.collectionAreaId, input.collectionAreaId));
  }

  if (input.serviceAccountIds !== undefined && input.serviceAccountIds.length > 0) {
    conditions.push(inArray(schema.serviceAccounts.id, [...input.serviceAccountIds]));
  }

  return db
    .select({
      id: schema.serviceAccounts.id,
      accountNumber: schema.serviceAccounts.accountNumber,
      subscriberId: schema.serviceAccounts.subscriberId,
      subscriberAccountNumber: schema.subscribers.accountNumber,
      subscriberName: schema.subscribers.displayName,
      servicePlanId: schema.serviceAccounts.servicePlanId,
      planCode: schema.servicePlans.code,
      planName: schema.servicePlans.name,
      billingDay: schema.serviceAccounts.billingDay,
      dueDay: schema.serviceAccounts.dueDay,
      currentPlanPriceCentavos: schema.serviceAccounts.currentPlanPriceCentavos,
      installationFeeCentavos: schema.servicePlans.installationFeeCentavos,
      reconnectionFeeCentavos: schema.servicePlans.reconnectionFeeCentavos,
      installationFeeCharged: schema.serviceAccounts.installationFeeCharged,
    })
    .from(schema.serviceAccounts)
    .innerJoin(schema.subscribers, eq(schema.serviceAccounts.subscriberId, schema.subscribers.id))
    .innerJoin(
      schema.servicePlans,
      eq(schema.serviceAccounts.servicePlanId, schema.servicePlans.id),
    )
    .where(and(...conditions))
    .orderBy(asc(schema.serviceAccounts.accountNumber));
}

/** Accounts that already have a live invoice for this period. */
export async function findInvoicedAccountIds(
  db: Executor,
  periodStart: string,
): Promise<Set<number>> {
  const rows = await db
    .select({ accountId: schema.invoices.serviceAccountId })
    .from(schema.invoices)
    .where(
      and(
        eq(schema.invoices.billingPeriodStart, periodStart),
        sql`${schema.invoices.status} <> 'VOID'`,
      ),
    );

  return new Set(rows.map((row) => row.accountId));
}

/** Accounts reconnected during the period, so the reconnection fee applies. */
export async function findReconnectedAccountIds(
  db: Executor,
  periodStart: string,
  periodEnd: string,
): Promise<Set<number>> {
  const rows = await db
    .select({ accountId: schema.serviceEvents.serviceAccountId })
    .from(schema.serviceEvents)
    .where(
      and(
        eq(schema.serviceEvents.eventType, 'RECONNECTED'),
        gte(schema.serviceEvents.effectiveDate, periodStart),
        lte(schema.serviceEvents.effectiveDate, periodEnd),
      ),
    );

  return new Set(rows.map((row) => row.accountId));
}

export async function markInstallationFeeCharged(
  tx: Tx,
  accountIds: readonly number[],
  actorUserId: number | null,
): Promise<void> {
  if (accountIds.length === 0) return;

  await tx
    .update(schema.serviceAccounts)
    .set({ installationFeeCharged: true, updatedAt: new Date(), updatedBy: actorUserId })
    .where(inArray(schema.serviceAccounts.id, [...accountIds]));
}

/* ──────────────────────────────── Invoices ───────────────────────────────── */

export interface InsertInvoiceValues {
  readonly invoiceNumber: string;
  readonly subscriberId: number;
  readonly serviceAccountId: number;
  readonly billingCycleId: number;
  readonly billingPeriodStart: string;
  readonly billingPeriodEnd: string;
  readonly issueDate: string;
  readonly dueDate: string;
  readonly subtotalCentavos: number;
  readonly discountCentavos: number;
  readonly penaltyCentavos: number;
  readonly adjustmentCentavos: number;
  readonly taxCentavos: number;
  readonly totalCentavos: number;
  readonly balanceCentavos: number;
  readonly status: string;
  readonly finalizedAt: Date | null;
  readonly finalizedBy: number | null;
  readonly createdBy: number | null;
}

export async function insertInvoice(tx: Tx, values: InsertInvoiceValues): Promise<number> {
  const rows = await tx
    .insert(schema.invoices)
    .values({ ...values, updatedBy: values.createdBy })
    .returning({ id: schema.invoices.id });

  const id = rows[0]?.id;
  if (id === undefined) throw new Error('Inserting an invoice returned no id.');
  return id;
}

export async function insertInvoiceItem(
  tx: Tx,
  values: {
    readonly invoiceId: number;
    readonly itemType: string;
    readonly direction: string;
    readonly description: string;
    readonly quantity: number;
    readonly unitPriceCentavos: number;
    readonly amountCentavos: number;
    readonly servicePlanId: number | null;
    readonly serviceAccountId: number | null;
    readonly sortOrder: number;
    readonly createdBy: number | null;
  },
): Promise<number> {
  const rows = await tx
    .insert(schema.invoiceItems)
    .values(values)
    .returning({ id: schema.invoiceItems.id });

  const id = rows[0]?.id;
  if (id === undefined) throw new Error('Inserting an invoice item returned no id.');
  return id;
}

const invoiceProjection = {
  id: schema.invoices.id,
  invoiceNumber: schema.invoices.invoiceNumber,
  subscriberId: schema.invoices.subscriberId,
  subscriberAccountNumber: schema.subscribers.accountNumber,
  subscriberName: schema.subscribers.displayName,
  serviceAccountId: schema.invoices.serviceAccountId,
  serviceAccountNumber: schema.serviceAccounts.accountNumber,
  servicePlanId: schema.serviceAccounts.servicePlanId,
  planCode: schema.servicePlans.code,
  billingPeriodStart: schema.invoices.billingPeriodStart,
  billingPeriodEnd: schema.invoices.billingPeriodEnd,
  issueDate: schema.invoices.issueDate,
  dueDate: schema.invoices.dueDate,
  subtotalCentavos: schema.invoices.subtotalCentavos,
  discountCentavos: schema.invoices.discountCentavos,
  penaltyCentavos: schema.invoices.penaltyCentavos,
  adjustmentCentavos: schema.invoices.adjustmentCentavos,
  taxCentavos: schema.invoices.taxCentavos,
  totalCentavos: schema.invoices.totalCentavos,
  paidCentavos: schema.invoices.paidCentavos,
  balanceCentavos: schema.invoices.balanceCentavos,
  status: schema.invoices.status,
  finalizedAt: schema.invoices.finalizedAt,
  voidedAt: schema.invoices.voidedAt,
  voidReason: schema.invoices.voidReason,
  createdAt: schema.invoices.createdAt,
} as const;

function baseInvoiceQuery(db: Executor) {
  return db
    .select(invoiceProjection)
    .from(schema.invoices)
    .innerJoin(schema.subscribers, eq(schema.invoices.subscriberId, schema.subscribers.id))
    .innerJoin(
      schema.serviceAccounts,
      eq(schema.invoices.serviceAccountId, schema.serviceAccounts.id),
    )
    .innerJoin(
      schema.servicePlans,
      eq(schema.serviceAccounts.servicePlanId, schema.servicePlans.id),
    );
}

function buildInvoiceFilters(query: InvoiceListQuery, today: string): SQL | undefined {
  const conditions: SQL[] = [];

  if (query.status !== undefined) {
    conditions.push(eq(schema.invoices.status, query.status));
  }

  if (query.month !== undefined) {
    conditions.push(eq(schema.invoices.billingPeriodStart, `${query.month}-01`));
  }

  if (query.subscriberId !== undefined) {
    conditions.push(eq(schema.invoices.subscriberId, query.subscriberId));
  }

  if (query.serviceAccountId !== undefined) {
    conditions.push(eq(schema.invoices.serviceAccountId, query.serviceAccountId));
  }

  if (query.displayStatus === 'OVERDUE') {
    // The derived state, expressed as the condition that produces it.
    conditions.push(sql`${schema.invoices.status} IN ('UNPAID', 'PARTIALLY_PAID')`);
    conditions.push(sql`${schema.invoices.balanceCentavos} > 0`);
    conditions.push(sql`${schema.invoices.dueDate} < ${today}`);
  } else if (query.displayStatus !== undefined) {
    conditions.push(eq(schema.invoices.status, query.displayStatus));
  }

  if (query.search !== undefined && query.search.length > 0) {
    const pattern = `%${query.search}%`;
    const search = or(
      ilike(schema.invoices.invoiceNumber, pattern),
      ilike(schema.subscribers.accountNumber, pattern),
      ilike(schema.subscribers.displayName, pattern),
      ilike(schema.serviceAccounts.accountNumber, pattern),
    );
    if (search !== undefined) conditions.push(search);
  }

  if (conditions.length === 0) return undefined;
  return and(...conditions);
}

export async function listInvoices(
  db: Executor,
  query: InvoiceListQuery,
  today: string,
  offset: number,
): Promise<readonly InvoiceRow[]> {
  return baseInvoiceQuery(db)
    .where(buildInvoiceFilters(query, today))
    .orderBy(desc(schema.invoices.issueDate), desc(schema.invoices.id))
    .limit(query.pageSize)
    .offset(offset);
}

export async function countInvoices(
  db: Executor,
  query: InvoiceListQuery,
  today: string,
): Promise<number> {
  const rows = await db
    .select({ total: count() })
    .from(schema.invoices)
    .innerJoin(schema.subscribers, eq(schema.invoices.subscriberId, schema.subscribers.id))
    .innerJoin(
      schema.serviceAccounts,
      eq(schema.invoices.serviceAccountId, schema.serviceAccounts.id),
    )
    .where(buildInvoiceFilters(query, today));

  return rows[0]?.total ?? 0;
}

export async function findInvoiceRow(db: Executor, invoiceId: number): Promise<InvoiceRow | null> {
  const rows = await baseInvoiceQuery(db).where(eq(schema.invoices.id, invoiceId)).limit(1);
  return rows[0] ?? null;
}

export async function listInvoiceItems(
  db: Executor,
  invoiceId: number,
): Promise<readonly InvoiceItemRow[]> {
  return db
    .select({
      id: schema.invoiceItems.id,
      itemType: schema.invoiceItems.itemType,
      direction: schema.invoiceItems.direction,
      description: schema.invoiceItems.description,
      quantity: schema.invoiceItems.quantity,
      unitPriceCentavos: schema.invoiceItems.unitPriceCentavos,
      amountCentavos: schema.invoiceItems.amountCentavos,
    })
    .from(schema.invoiceItems)
    .where(eq(schema.invoiceItems.invoiceId, invoiceId))
    .orderBy(asc(schema.invoiceItems.sortOrder), asc(schema.invoiceItems.id));
}

export async function listInvoiceAdjustments(
  db: Executor,
  invoiceId: number,
): Promise<readonly AdjustmentRow[]> {
  return db
    .select({
      id: schema.adjustments.id,
      adjustmentType: schema.adjustments.adjustmentType,
      reasonCode: schema.adjustments.reasonCode,
      amountCentavos: schema.adjustments.amountCentavos,
      memo: schema.adjustments.memo,
      status: schema.adjustments.status,
      createdAt: schema.adjustments.createdAt,
      createdByUsername: schema.users.username,
    })
    .from(schema.adjustments)
    .leftJoin(schema.users, eq(schema.adjustments.createdBy, schema.users.id))
    .where(eq(schema.adjustments.invoiceId, invoiceId))
    .orderBy(asc(schema.adjustments.id));
}

/**
 * Post a draft.
 *
 * Writes the invoice's debit at the same moment. The two are one transaction:
 * an invoice that exists without its ledger entry would be a charge the ledger
 * cannot account for.
 */
export async function finalizeInvoiceRow(
  tx: Tx,
  invoiceId: number,
  actorUserId: number,
): Promise<void> {
  await tx
    .update(schema.invoices)
    .set({
      status: 'UNPAID',
      finalizedAt: new Date(),
      finalizedBy: actorUserId,
      updatedAt: new Date(),
      updatedBy: actorUserId,
    })
    .where(eq(schema.invoices.id, invoiceId));
}

/**
 * Void an invoice.
 *
 * Nothing is deleted. The status moves to VOID and the reason is recorded, which
 * frees the `(account, period)` slot for a corrected invoice while leaving the
 * original number reserved and readable.
 */
export async function voidInvoiceRow(
  tx: Tx,
  invoiceId: number,
  reason: string,
  actorUserId: number,
): Promise<void> {
  await tx
    .update(schema.invoices)
    .set({
      status: 'VOID',
      voidedAt: new Date(),
      voidedBy: actorUserId,
      voidReason: reason,
      updatedAt: new Date(),
      updatedBy: actorUserId,
    })
    .where(eq(schema.invoices.id, invoiceId));
}

/**
 * Refresh an invoice's components after an adjustment.
 *
 * The trigger on `invoices` verifies these numbers against the lines actually
 * attached to the invoice, so calling this with anything the items do not
 * support fails rather than quietly skewing the total.
 */
export async function updateInvoiceComponents(
  tx: Tx,
  invoiceId: number,
  values: {
    readonly subtotalCentavos: number;
    readonly discountCentavos: number;
    readonly penaltyCentavos: number;
    readonly adjustmentCentavos: number;
    readonly totalCentavos: number;
    readonly balanceCentavos: number;
  },
  actorUserId: number,
): Promise<void> {
  await tx
    .update(schema.invoices)
    .set({ ...values, updatedAt: new Date(), updatedBy: actorUserId })
    .where(eq(schema.invoices.id, invoiceId));
}

export interface InsertAdjustmentValues {
  readonly invoiceId: number;
  readonly adjustmentType: string;
  readonly reasonCode: string;
  readonly amountCentavos: number;
  readonly memo: string;
  readonly invoiceItemId: number | null;
  readonly postedAt: Date;
  readonly approvedBy: number | null;
  readonly createdBy: number;
}

export async function insertAdjustment(tx: Tx, values: InsertAdjustmentValues): Promise<number> {
  const rows = await tx
    .insert(schema.adjustments)
    .values({ ...values, updatedBy: values.createdBy })
    .returning({ id: schema.adjustments.id });

  const id = rows[0]?.id;
  if (id === undefined) throw new Error('Inserting an adjustment returned no id.');
  return id;
}

/** Invoices past their grace period, for the penalty run. */
export async function listPenaltyCandidates(
  db: Executor,
  asOf: string,
): Promise<
  readonly {
    id: number;
    invoiceNumber: string;
    serviceAccountId: number;
    subscriberId: number;
    balanceCentavos: number;
    dueDate: string;
    status: string;
  }[]
> {
  const rows = await db
    .select({
      id: schema.invoices.id,
      invoiceNumber: schema.invoices.invoiceNumber,
      serviceAccountId: schema.invoices.serviceAccountId,
      subscriberId: schema.invoices.subscriberId,
      balanceCentavos: schema.invoices.balanceCentavos,
      dueDate: schema.invoices.dueDate,
      status: schema.invoices.status,
    })
    .from(schema.invoices)
    .where(
      and(
        inArray(schema.invoices.status, ['UNPAID', 'PARTIALLY_PAID']),
        sql`${schema.invoices.balanceCentavos} > 0`,
        lte(schema.invoices.dueDate, asOf),
      ),
    )
    .orderBy(asc(schema.invoices.dueDate));

  return rows;
}

/** Whether a penalty line already exists for this invoice. */
export async function hasPenaltyLine(db: Executor, invoiceId: number): Promise<boolean> {
  const rows = await db
    .select({ id: schema.invoiceItems.id })
    .from(schema.invoiceItems)
    .where(
      and(
        eq(schema.invoiceItems.invoiceId, invoiceId),
        eq(schema.invoiceItems.itemType, 'PENALTY'),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

/* ────────────────────────────── Dashboard aggregates ──────────────────────── */

export interface BillingAggregates {
  readonly invoicesThisPeriod: number;
  readonly billedThisPeriodCentavos: number;
  readonly openInvoices: number;
  readonly outstandingCentavos: number;
  readonly overdueInvoices: number;
  readonly overdueCentavos: number;
  readonly draftInvoices: number;
}

export async function billingAggregates(
  db: Executor,
  periodStart: string,
  today: string,
): Promise<BillingAggregates> {
  const rows = await db
    .select({
      invoicesThisPeriod: sql<number>`count(*) FILTER (
        WHERE ${schema.invoices.billingPeriodStart} = ${periodStart}
          AND ${schema.invoices.status} <> 'VOID')::int`,
      billedThisPeriod: sql<number>`COALESCE(SUM(${schema.invoices.totalCentavos}) FILTER (
        WHERE ${schema.invoices.billingPeriodStart} = ${periodStart}
          AND ${schema.invoices.status} <> 'VOID'), 0)::bigint`,
      openInvoices: sql<number>`count(*) FILTER (
        WHERE ${schema.invoices.status} IN ('UNPAID', 'PARTIALLY_PAID'))::int`,
      outstanding: sql<number>`COALESCE(SUM(${schema.invoices.balanceCentavos}) FILTER (
        WHERE ${schema.invoices.status} IN ('UNPAID', 'PARTIALLY_PAID')), 0)::bigint`,
      overdueInvoices: sql<number>`count(*) FILTER (
        WHERE ${schema.invoices.status} IN ('UNPAID', 'PARTIALLY_PAID')
          AND ${schema.invoices.balanceCentavos} > 0
          AND ${schema.invoices.dueDate} < ${today})::int`,
      overdue: sql<number>`COALESCE(SUM(${schema.invoices.balanceCentavos}) FILTER (
        WHERE ${schema.invoices.status} IN ('UNPAID', 'PARTIALLY_PAID')
          AND ${schema.invoices.balanceCentavos} > 0
          AND ${schema.invoices.dueDate} < ${today}), 0)::bigint`,
      drafts: sql<number>`count(*) FILTER (WHERE ${schema.invoices.status} = 'DRAFT')::int`,
    })
    .from(schema.invoices);

  const row = rows[0];

  return {
    invoicesThisPeriod: row?.invoicesThisPeriod ?? 0,
    billedThisPeriodCentavos: Number(row?.billedThisPeriod ?? 0),
    openInvoices: row?.openInvoices ?? 0,
    outstandingCentavos: Number(row?.outstanding ?? 0),
    overdueInvoices: row?.overdueInvoices ?? 0,
    overdueCentavos: Number(row?.overdue ?? 0),
    draftInvoices: row?.drafts ?? 0,
  };
}
