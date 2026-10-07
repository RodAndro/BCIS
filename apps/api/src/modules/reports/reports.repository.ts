import { schema } from '@bcis/database';
import { and, asc, desc, eq, sql, type SQL, type SQLWrapper } from 'drizzle-orm';

import type { Executor } from '../../shared/database';
import type { ReportQuery, ReportType } from '@bcis/validation';

export interface ReportData {
  readonly columns: readonly string[];
  readonly rows: readonly Record<string, unknown>[];
}

function dateRange(column: SQLWrapper, query: ReportQuery): SQL | undefined {
  const conditions: SQL[] = [];
  if (query.from !== undefined) conditions.push(sql`${column} >= ${query.from}`);
  if (query.to !== undefined) conditions.push(sql`${column} <= ${query.to}`);
  return conditions.length === 0 ? undefined : and(...conditions);
}

async function collectionRows(db: Executor, query: ReportQuery): Promise<ReportData> {
  const conditions: SQL[] = [];
  const range = dateRange(schema.collectionBatches.batchDate, query);
  if (range !== undefined) conditions.push(range);
  if (query.collectorId !== undefined)
    conditions.push(eq(schema.collectionBatches.collectorUserId, query.collectorId));
  if (query.collectionAreaId !== undefined)
    conditions.push(eq(schema.collectionBatches.collectionAreaId, query.collectionAreaId));
  const rows = await db
    .select({
      batchNumber: schema.collectionBatches.batchNumber,
      date: schema.collectionBatches.batchDate,
      collector: schema.users.fullName,
      area: schema.collectionAreas.name,
      expectedReceivableCentavos: schema.collectionBatches.expectedReceivableCentavos,
      cashCollectedCentavos: schema.collectionBatches.cashCollectedCentavos,
      nonCashCollectedCentavos: schema.collectionBatches.nonCashCollectedCentavos,
      uncollectedCentavos: schema.collectionBatches.uncollectedCentavos,
      remittedCashCentavos: schema.collectionBatches.remittedCashCentavos,
      shortageCentavos: schema.collectionBatches.shortageCentavos,
      overageCentavos: schema.collectionBatches.overageCentavos,
      status: schema.collectionBatches.status,
    })
    .from(schema.collectionBatches)
    .innerJoin(schema.users, eq(schema.collectionBatches.collectorUserId, schema.users.id))
    .innerJoin(
      schema.collectionAreas,
      eq(schema.collectionBatches.collectionAreaId, schema.collectionAreas.id),
    )
    .where(conditions.length === 0 ? undefined : and(...conditions))
    .orderBy(desc(schema.collectionBatches.batchDate), desc(schema.collectionBatches.id));
  return {
    columns: Object.keys(rows[0] ?? { batchNumber: '', date: '' }),
    rows: rows.map((row) => ({ ...row })),
  };
}

async function billingVsCollection(db: Executor, query: ReportQuery): Promise<ReportData> {
  const invoiceRange = dateRange(schema.invoices.issueDate, query);
  const paymentRange = dateRange(schema.payments.paymentDate, query);
  const [invoices, payments] = await Promise.all([
    db
      .select({ billedCentavos: sql<number>`coalesce(sum(${schema.invoices.totalCentavos}), 0)` })
      .from(schema.invoices)
      .where(and(sql`${schema.invoices.status} <> 'VOID'`, invoiceRange)),
    db
      .select({
        collectedCentavos: sql<number>`coalesce(sum(${schema.payments.amountCentavos}), 0)`,
      })
      .from(schema.payments)
      .where(and(eq(schema.payments.status, 'POSTED'), paymentRange)),
  ]);
  return {
    columns: ['billedCentavos', 'collectedCentavos'],
    rows: [
      {
        billedCentavos: Number(invoices[0]?.billedCentavos ?? 0),
        collectedCentavos: Number(payments[0]?.collectedCentavos ?? 0),
      },
    ],
  };
}

async function subscriberMaster(db: Executor, query: ReportQuery): Promise<ReportData> {
  const conditions: SQL[] = [];
  if (query.collectionAreaId !== undefined)
    conditions.push(eq(schema.subscribers.collectionAreaId, query.collectionAreaId));
  const rows = await db
    .select({
      accountNumber: schema.subscribers.accountNumber,
      subscriber: schema.subscribers.displayName,
      subscriberType: schema.subscribers.subscriberType,
      status: schema.subscribers.status,
      area: schema.collectionAreas.name,
      createdAt: schema.subscribers.createdAt,
    })
    .from(schema.subscribers)
    .leftJoin(
      schema.collectionAreas,
      eq(schema.subscribers.collectionAreaId, schema.collectionAreas.id),
    )
    .where(conditions.length === 0 ? undefined : and(...conditions))
    .orderBy(asc(schema.subscribers.displayName));
  return {
    columns: Object.keys(rows[0] ?? { accountNumber: '', subscriber: '' }),
    rows: rows.map((row) => ({ ...row })),
  };
}

async function paymentAdjustments(db: Executor, query: ReportQuery): Promise<ReportData> {
  const range = dateRange(schema.paymentReversals.reversedAt, query);
  const reversals = await db
    .select({
      reversalId: schema.paymentReversals.id,
      paymentId: schema.paymentReversals.originalPaymentId,
      reasonCode: schema.paymentReversals.reasonCode,
      reason: schema.paymentReversals.reason,
      amountCentavos: schema.paymentReversals.amountCentavos,
      reversedAt: schema.paymentReversals.reversedAt,
    })
    .from(schema.paymentReversals)
    .where(range)
    .orderBy(desc(schema.paymentReversals.reversedAt));
  const adjustments = await db
    .select({
      adjustmentId: schema.adjustments.id,
      invoiceId: schema.adjustments.invoiceId,
      reasonCode: schema.adjustments.reasonCode,
      memo: schema.adjustments.memo,
      amountCentavos: schema.adjustments.amountCentavos,
      createdAt: schema.adjustments.createdAt,
    })
    .from(schema.adjustments)
    .where(dateRange(schema.adjustments.createdAt, query))
    .orderBy(desc(schema.adjustments.createdAt));
  const rows = [
    ...reversals.map((row) => ({ kind: 'PAYMENT_REVERSAL', ...row })),
    ...adjustments.map((row) => ({ kind: 'INVOICE_ADJUSTMENT', ...row })),
  ];
  return {
    columns: Object.keys(rows[0] ?? { kind: '', amountCentavos: 0 }),
    rows: rows.map((row) => ({ ...row })),
  };
}

/**
 * Posted payments grouped by method.
 *
 * Counts and sums only POSTED payments: a payment parked in verification or
 * reversed is not money the business has.
 */
async function paymentMethodSummary(db: Executor, query: ReportQuery): Promise<ReportData> {
  const conditions: SQL[] = [eq(schema.payments.status, 'POSTED')];
  const range = dateRange(schema.payments.paymentDate, query);
  if (range !== undefined) conditions.push(range);
  if (query.paymentMethod !== undefined)
    conditions.push(eq(schema.payments.paymentMethod, query.paymentMethod));
  if (query.collectorId !== undefined)
    conditions.push(eq(schema.payments.receivedBy, query.collectorId));

  const rows = await db
    .select({
      method: schema.payments.paymentMethod,
      payments: sql<number>`count(*)::int`,
      amountCentavos: sql<number>`coalesce(sum(${schema.payments.amountCentavos}), 0)::bigint`,
    })
    .from(schema.payments)
    .where(and(...conditions))
    .groupBy(schema.payments.paymentMethod)
    .orderBy(asc(schema.payments.paymentMethod));

  const mapped = rows.map((row) => ({
    method: row.method,
    payments: Number(row.payments),
    amountCentavos: Number(row.amountCentavos),
  }));
  return {
    columns: ['method', 'payments', 'amountCentavos'],
    rows: mapped,
  };
}

/**
 * Billed and collected revenue grouped by the plan snapshot on the invoice.
 *
 * Attribution uses `invoice_items.service_plan_id` — the plan the account was
 * billed at — rather than the account's current plan, so a later plan change
 * does not silently move past revenue. `collectedCentavos` is the net of
 * allocations against those invoices (reversals subtract).
 */
async function revenueByPlan(db: Executor, query: ReportQuery): Promise<ReportData> {
  const billedConditions: SQL[] = [
    sql`${schema.invoices.status} <> 'VOID'`,
    sql`${schema.invoiceItems.itemType} = 'SUBSCRIPTION'`,
  ];
  const issueRange = dateRange(schema.invoices.issueDate, query);
  if (issueRange !== undefined) billedConditions.push(issueRange);
  if (query.servicePlanId !== undefined)
    billedConditions.push(eq(schema.invoiceItems.servicePlanId, query.servicePlanId));
  if (query.serviceTypeCode !== undefined)
    billedConditions.push(eq(schema.serviceTypes.code, query.serviceTypeCode));

  const collectedConditions: SQL[] = [sql`${schema.invoices.status} <> 'VOID'`];
  const paymentRange = dateRange(schema.payments.paymentDate, query);
  if (paymentRange !== undefined) collectedConditions.push(paymentRange);
  if (query.servicePlanId !== undefined)
    collectedConditions.push(eq(schema.invoiceItems.servicePlanId, query.servicePlanId));
  if (query.serviceTypeCode !== undefined)
    collectedConditions.push(eq(schema.serviceTypes.code, query.serviceTypeCode));

  // Two grouped reads rather than one correlated subquery: a grouped query
  // cannot reference an ungrouped invoice id, and splitting keeps billed (by
  // issue date) and collected (by payment date) honest about their own dates.
  const [billedRows, collectedRows] = await Promise.all([
    db
      .select({
        plan: schema.servicePlans.name,
        serviceType: schema.serviceTypes.code,
        invoices: sql<number>`count(distinct ${schema.invoices.id})::int`,
        billedCentavos: sql<number>`coalesce(sum(${schema.invoiceItems.amountCentavos}), 0)::bigint`,
      })
      .from(schema.invoiceItems)
      .innerJoin(schema.invoices, eq(schema.invoiceItems.invoiceId, schema.invoices.id))
      .innerJoin(schema.servicePlans, eq(schema.invoiceItems.servicePlanId, schema.servicePlans.id))
      .innerJoin(schema.serviceTypes, eq(schema.servicePlans.serviceTypeId, schema.serviceTypes.id))
      .where(and(...billedConditions))
      .groupBy(schema.servicePlans.name, schema.serviceTypes.code)
      .orderBy(asc(schema.servicePlans.name)),
    db
      .select({
        plan: schema.servicePlans.name,
        serviceType: schema.serviceTypes.code,
        collectedCentavos: sql<number>`coalesce(sum(case when ${schema.paymentAllocations.isReversal} then -${schema.paymentAllocations.amountCentavos} else ${schema.paymentAllocations.amountCentavos} end), 0)::bigint`,
      })
      .from(schema.paymentAllocations)
      .innerJoin(schema.payments, eq(schema.paymentAllocations.paymentId, schema.payments.id))
      .innerJoin(schema.invoices, eq(schema.paymentAllocations.invoiceId, schema.invoices.id))
      .innerJoin(
        schema.invoiceItems,
        and(
          eq(schema.invoiceItems.invoiceId, schema.invoices.id),
          sql`${schema.invoiceItems.itemType} = 'SUBSCRIPTION'`,
        ),
      )
      .innerJoin(schema.servicePlans, eq(schema.invoiceItems.servicePlanId, schema.servicePlans.id))
      .innerJoin(schema.serviceTypes, eq(schema.servicePlans.serviceTypeId, schema.serviceTypes.id))
      .where(and(...collectedConditions))
      .groupBy(schema.servicePlans.name, schema.serviceTypes.code),
  ]);

  const planKey = (plan: string, serviceType: string): string => `${plan}::${serviceType}`;
  const collectedByPlan = new Map(
    collectedRows.map((row) => [planKey(row.plan, row.serviceType), Number(row.collectedCentavos)]),
  );

  const mapped = billedRows.map((row) => {
    const billed = Number(row.billedCentavos);
    const collected = collectedByPlan.get(planKey(row.plan, row.serviceType)) ?? 0;
    return {
      plan: row.plan,
      serviceType: row.serviceType,
      invoices: Number(row.invoices),
      billedCentavos: billed,
      collectedCentavos: collected,
      outstandingCentavos: billed - collected,
    };
  });

  return {
    columns: [
      'plan',
      'serviceType',
      'invoices',
      'billedCentavos',
      'collectedCentavos',
      'outstandingCentavos',
    ],
    rows: mapped,
  };
}

async function voidedReceipts(db: Executor, query: ReportQuery): Promise<ReportData> {
  const range = dateRange(schema.receipts.voidedAt, query);
  const rows = await db
    .select({
      receiptNumber: schema.receipts.receiptNumber,
      paymentId: schema.receipts.paymentId,
      voidedAt: schema.receipts.voidedAt,
      voidReason: schema.receipts.voidReason,
      voidedBy: schema.users.fullName,
    })
    .from(schema.receipts)
    .leftJoin(schema.users, eq(schema.receipts.voidedBy, schema.users.id))
    .where(and(eq(schema.receipts.status, 'VOID'), range))
    .orderBy(desc(schema.receipts.voidedAt));
  return {
    columns: Object.keys(rows[0] ?? { receiptNumber: '', paymentId: '' }),
    rows: rows.map((row) => ({ ...row })),
  };
}

async function userActivity(db: Executor, query: ReportQuery): Promise<ReportData> {
  const range = dateRange(schema.auditLogs.createdAt, query);
  const rows = await db
    .select({
      createdAt: schema.auditLogs.createdAt,
      username: schema.users.username,
      action: schema.auditLogs.action,
      entityType: schema.auditLogs.entityType,
      entityId: schema.auditLogs.entityId,
      reason: schema.auditLogs.reason,
    })
    .from(schema.auditLogs)
    .leftJoin(schema.users, eq(schema.auditLogs.actorUserId, schema.users.id))
    .where(range)
    .orderBy(desc(schema.auditLogs.createdAt))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);
  return {
    columns: Object.keys(rows[0] ?? { createdAt: '', action: '' }),
    rows: rows.map((row) => ({ ...row })),
  };
}

export async function reportRows(
  db: Executor,
  type: ReportType,
  query: ReportQuery,
): Promise<ReportData> {
  switch (type) {
    case 'DAILY_COLLECTION':
    case 'WEEKLY_COLLECTION':
    case 'MONTHLY_COLLECTION':
    case 'ANNUAL_COLLECTION':
    case 'COLLECTOR_COLLECTION':
    case 'COLLECTOR_REMITTANCE':
    case 'COLLECTOR_VARIANCE':
    case 'COLLECTOR_PERFORMANCE':
      return collectionRows(db, query);
    case 'BILLING_VS_COLLECTION':
      return billingVsCollection(db, query);
    case 'SUBSCRIBER_MASTER':
      return subscriberMaster(db, query);
    case 'PAYMENT_METHOD_SUMMARY':
      return paymentMethodSummary(db, query);
    case 'REVENUE_BY_PLAN':
      return revenueByPlan(db, query);
    case 'PAYMENT_ADJUSTMENTS':
      return paymentAdjustments(db, query);
    case 'VOIDED_RECEIPTS':
      return voidedReceipts(db, query);
    case 'USER_ACTIVITY':
      return userActivity(db, query);
    case 'AR_AGING':
    case 'OVERDUE_SUBSCRIBERS':
    case 'SUBSCRIBER_LEDGER':
    case 'STATEMENT_OF_ACCOUNT':
      return { columns: [], rows: [] };
  }
}

export async function receiptPrintData(db: Executor, receiptId: number) {
  const rows = await db
    .select({
      receiptNumber: schema.receipts.receiptNumber,
      issuedAt: schema.receipts.issuedAt,
      amountCentavos: schema.payments.amountCentavos,
      paymentMethod: schema.payments.paymentMethod,
      referenceNumber: schema.payments.referenceNumber,
      subscriber: schema.subscribers.displayName,
      subscriberAccountNumber: schema.subscribers.accountNumber,
      serviceAccountNumber: schema.serviceAccounts.accountNumber,
    })
    .from(schema.receipts)
    .innerJoin(schema.payments, eq(schema.receipts.paymentId, schema.payments.id))
    .innerJoin(schema.subscribers, eq(schema.payments.subscriberId, schema.subscribers.id))
    .innerJoin(
      schema.serviceAccounts,
      eq(schema.payments.serviceAccountId, schema.serviceAccounts.id),
    )
    .where(eq(schema.receipts.id, receiptId))
    .limit(1);
  return rows[0] ?? null;
}
