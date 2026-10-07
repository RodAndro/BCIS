import { schema } from '@bcis/database';
import { and, asc, count, eq, sql, type SQL } from 'drizzle-orm';

import type { Executor, Tx } from '../../shared/database';
import type { ReceivableListQuery } from '@bcis/validation';

export interface ReceivableRow {
  readonly serviceAccountId: number;
  readonly accountNumber: string;
  readonly subscriberId: number;
  readonly subscriber: string;
  readonly servicePlanId: number;
  readonly plan: string;
  readonly serviceTypeCode: string;
  readonly area: string | null;
  readonly collector: string | null;
  readonly serviceStatus: string;
  readonly monthsUnpaid: number;
  readonly oldestUnpaidInvoice: string | null;
  readonly lastPayment: string | null;
  readonly totalArrearsCentavos: number;
  readonly agingBucket: string;
}

const outstandingBalance = sql`greatest(
  ${schema.invoices.totalCentavos} - coalesce((
    select sum(case when allocation.is_reversal then -allocation.amount_centavos else allocation.amount_centavos end)
    from payment_allocations allocation
    where allocation.invoice_id = ${schema.invoices.id}
  ), 0), 0
)`;

const balanceCondition = and(
  sql`${schema.invoices.status} <> 'VOID'`,
  sql`${outstandingBalance} > 0`,
);

function bucketCondition(bucket: string, today: string): SQL {
  const age = sql`(${today}::date - min(${schema.invoices.dueDate}))`;
  switch (bucket) {
    case 'CURRENT':
      return sql`${age} <= 0`;
    case '1_30':
      return sql`${age} BETWEEN 1 AND 30`;
    case '31_60':
      return sql`${age} BETWEEN 31 AND 60`;
    case '61_90':
      return sql`${age} BETWEEN 61 AND 90`;
    case '90_PLUS':
      return sql`${age} >= 91`;
    default:
      return sql`true`;
  }
}

function buildHaving(query: ReceivableListQuery, today: string): SQL | undefined {
  const conditions: SQL[] = [];
  if (query.overdueOnly) conditions.push(sql`min(${schema.invoices.dueDate}) < ${today}`);
  if (query.agingBucket !== undefined) conditions.push(bucketCondition(query.agingBucket, today));
  if (conditions.length === 0) return undefined;
  return and(...conditions);
}

function fromQuery(db: Executor, query: ReceivableListQuery, today: string) {
  const where: SQL[] = [balanceCondition as SQL];
  if (query.collectionAreaId !== undefined) {
    where.push(eq(schema.subscribers.collectionAreaId, query.collectionAreaId));
  }
  if (query.collectorId !== undefined) {
    where.push(eq(schema.serviceAccounts.assignedCollectorId, query.collectorId));
  }
  if (query.servicePlanId !== undefined) {
    where.push(eq(schema.serviceAccounts.servicePlanId, query.servicePlanId));
  }
  if (query.serviceTypeCode !== undefined) {
    where.push(eq(schema.serviceTypes.code, query.serviceTypeCode));
  }

  const age = sql`(${today}::date - min(${schema.invoices.dueDate}))`;
  const agingBucket = sql<string>`case
    when ${age} <= 0 then 'CURRENT'
    when ${age} between 1 and 30 then '1_30'
    when ${age} between 31 and 60 then '31_60'
    when ${age} between 61 and 90 then '61_90'
    else '90_PLUS'
  end`;

  return db
    .select({
      serviceAccountId: schema.serviceAccounts.id,
      accountNumber: schema.serviceAccounts.accountNumber,
      subscriberId: schema.subscribers.id,
      subscriber: schema.subscribers.displayName,
      servicePlanId: schema.servicePlans.id,
      plan: schema.servicePlans.name,
      serviceTypeCode: schema.serviceTypes.code,
      area: schema.collectionAreas.name,
      collector: schema.users.fullName,
      serviceStatus: schema.serviceAccounts.status,
      monthsUnpaid: sql<number>`count(*)::int`,
      oldestUnpaidInvoice: sql<string | null>`min(${schema.invoices.dueDate})`,
      /*
       * ── WHY THIS IS FORMATTED IN SQL, NOT CONVERTED IN JS ────────────────
       * A raw `sql` timestamp expression does NOT arrive as a Date the way a
       * schema column does: it arrives as Postgres's own text form
       * ("2026-09-22 21:00:01.229203+08"), which is not ISO-8601 and carries no
       * toISOString(). Emitting the instant as ISO-8601 text here keeps the
       * DTO's `z.string()` truthful and independent of how the driver happens
       * to render a timestamptz.
       */
      lastPayment: sql<string | null>`to_char(max((
        select p.payment_date
        from payments p
        where p.service_account_id = ${schema.serviceAccounts.id}
          and p.status in ('POSTED', 'REVERSED')
      )) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
      totalArrearsCentavos: sql<number>`sum(${outstandingBalance})`,
      agingBucket,
    })
    .from(schema.invoices)
    .innerJoin(
      schema.serviceAccounts,
      eq(schema.invoices.serviceAccountId, schema.serviceAccounts.id),
    )
    .innerJoin(schema.subscribers, eq(schema.invoices.subscriberId, schema.subscribers.id))
    .innerJoin(
      schema.servicePlans,
      eq(schema.serviceAccounts.servicePlanId, schema.servicePlans.id),
    )
    .innerJoin(schema.serviceTypes, eq(schema.servicePlans.serviceTypeId, schema.serviceTypes.id))
    .leftJoin(
      schema.collectionAreas,
      eq(schema.subscribers.collectionAreaId, schema.collectionAreas.id),
    )
    .leftJoin(schema.users, eq(schema.serviceAccounts.assignedCollectorId, schema.users.id))
    .where(and(...where))
    .groupBy(
      schema.serviceAccounts.id,
      schema.serviceAccounts.accountNumber,
      schema.subscribers.id,
      schema.subscribers.displayName,
      schema.servicePlans.id,
      schema.servicePlans.name,
      schema.serviceTypes.code,
      schema.collectionAreas.name,
      schema.users.fullName,
    )
    .having(buildHaving(query, today));
}

export async function listReceivables(
  db: Executor,
  query: ReceivableListQuery,
  today: string,
  offset: number,
): Promise<readonly ReceivableRow[]> {
  const rows = await fromQuery(db, query, today)
    .orderBy(asc(sql`min(${schema.invoices.dueDate})`), asc(schema.serviceAccounts.id))
    .limit(query.pageSize)
    .offset(offset);

  return rows.map((row) => ({
    ...row,
    monthsUnpaid: Number(row.monthsUnpaid),
    totalArrearsCentavos: Number(row.totalArrearsCentavos),
  }));
}

export async function countReceivables(
  db: Executor,
  query: ReceivableListQuery,
  today: string,
): Promise<number> {
  const rows = await db
    .select({ total: count() })
    .from(fromQuery(db, query, today).as('receivables_page'));
  return Number(rows[0]?.total ?? 0);
}

export async function agingSummary(db: Executor, today: string) {
  const rows = await db
    .select({
      currentCentavos: sql<number>`coalesce(sum(case when ${schema.invoices.dueDate} >= ${today} and ${outstandingBalance} > 0 then ${outstandingBalance} else 0 end), 0)`,
      bucket1To30Centavos: sql<number>`coalesce(sum(case when ${schema.invoices.dueDate} < ${today} and ${schema.invoices.dueDate} >= (${today}::date - 30) and ${outstandingBalance} > 0 then ${outstandingBalance} else 0 end), 0)`,
      bucket31To60Centavos: sql<number>`coalesce(sum(case when ${schema.invoices.dueDate} < (${today}::date - 30) and ${schema.invoices.dueDate} >= (${today}::date - 60) and ${outstandingBalance} > 0 then ${outstandingBalance} else 0 end), 0)`,
      bucket61To90Centavos: sql<number>`coalesce(sum(case when ${schema.invoices.dueDate} < (${today}::date - 60) and ${schema.invoices.dueDate} >= (${today}::date - 90) and ${outstandingBalance} > 0 then ${outstandingBalance} else 0 end), 0)`,
      bucket90PlusCentavos: sql<number>`coalesce(sum(case when ${schema.invoices.dueDate} < (${today}::date - 90) and ${outstandingBalance} > 0 then ${outstandingBalance} else 0 end), 0)`,
      totalOutstandingCentavos: sql<number>`coalesce(sum(case when ${outstandingBalance} > 0 then ${outstandingBalance} else 0 end), 0)`,
    })
    .from(schema.invoices)
    .where(sql`${schema.invoices.status} <> 'VOID'`);
  const row = rows[0];
  return {
    currentCentavos: Number(row?.currentCentavos ?? 0),
    bucket1To30Centavos: Number(row?.bucket1To30Centavos ?? 0),
    bucket31To60Centavos: Number(row?.bucket31To60Centavos ?? 0),
    bucket61To90Centavos: Number(row?.bucket61To90Centavos ?? 0),
    bucket90PlusCentavos: Number(row?.bucket90PlusCentavos ?? 0),
    totalOutstandingCentavos: Number(row?.totalOutstandingCentavos ?? 0),
  };
}

export async function findPaymentForAccount(
  db: Executor,
  paymentId: number,
  serviceAccountId: number,
) {
  const rows = await db
    .select({
      id: schema.payments.id,
      amountCentavos: schema.payments.amountCentavos,
      status: schema.payments.status,
    })
    .from(schema.payments)
    .where(
      and(
        eq(schema.payments.id, paymentId),
        eq(schema.payments.serviceAccountId, serviceAccountId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function insertSuspension(
  tx: Tx,
  values: typeof schema.suspensionRecords.$inferInsert,
) {
  const rows = await tx
    .insert(schema.suspensionRecords)
    .values(values)
    .returning({ id: schema.suspensionRecords.id });
  return (
    rows[0]?.id ??
    (() => {
      throw new Error('Inserting suspension returned no id.');
    })()
  );
}

export async function insertReconnection(
  tx: Tx,
  values: typeof schema.reconnectionRecords.$inferInsert,
) {
  const rows = await tx
    .insert(schema.reconnectionRecords)
    .values(values)
    .returning({ id: schema.reconnectionRecords.id });
  return (
    rows[0]?.id ??
    (() => {
      throw new Error('Inserting reconnection returned no id.');
    })()
  );
}

export async function findReconnection(db: Executor, id: number) {
  const rows = await db
    .select()
    .from(schema.reconnectionRecords)
    .where(eq(schema.reconnectionRecords.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateReconnection(
  tx: Tx,
  id: number,
  values: Partial<typeof schema.reconnectionRecords.$inferInsert>,
) {
  await tx
    .update(schema.reconnectionRecords)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(schema.reconnectionRecords.id, id));
}
