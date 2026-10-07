import { schema } from '@bcis/database';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';

import type { Executor, Tx } from '../../shared/database';
import type { PaymentListQuery } from '@bcis/validation';

/**
 * Payment queries.
 *
 * Drizzle only — the rules live in `@bcis/domain` and the transaction boundary
 * lives in the service. This file fetches and writes rows.
 */

export interface PaymentRow {
  readonly id: number;
  readonly receiptNumber: string | null;
  readonly subscriberId: number;
  readonly subscriberAccountNumber: string;
  readonly subscriberName: string;
  readonly serviceAccountId: number;
  readonly serviceAccountNumber: string;
  readonly paymentDate: Date;
  readonly paymentMethod: string;
  readonly amountCentavos: number;
  readonly appliedCentavos: number;
  readonly unappliedCentavos: number;
  readonly status: string;
  readonly referenceNumber: string | null;
  readonly senderName: string | null;
  readonly senderMobile: string | null;
  readonly receivedByUsername: string | null;
  readonly verifiedAt: Date | null;
  readonly rejectionReason: string | null;
  readonly postedAt: Date | null;
  readonly reversedAt: Date | null;
  readonly createdAt: Date;
}

export interface OpenInvoiceRow {
  readonly invoiceId: number;
  readonly invoiceNumber: string;
  readonly dueDate: string;
  readonly balanceCentavos: number;
}

export interface AllocationRow {
  readonly id: number;
  readonly invoiceId: number;
  readonly invoiceNumber: string;
  readonly amountCentavos: number;
  readonly isReversal: boolean;
}

const paymentProjection = {
  id: schema.payments.id,
  receiptNumber: schema.receipts.receiptNumber,
  subscriberId: schema.payments.subscriberId,
  subscriberAccountNumber: schema.subscribers.accountNumber,
  subscriberName: schema.subscribers.displayName,
  serviceAccountId: schema.payments.serviceAccountId,
  serviceAccountNumber: schema.serviceAccounts.accountNumber,
  paymentDate: schema.payments.paymentDate,
  paymentMethod: schema.payments.paymentMethod,
  amountCentavos: schema.payments.amountCentavos,
  appliedCentavos: schema.payments.appliedCentavos,
  unappliedCentavos: schema.payments.unappliedCentavos,
  status: schema.payments.status,
  referenceNumber: schema.payments.referenceNumber,
  senderName: schema.payments.senderName,
  senderMobile: schema.payments.senderMobile,
  receivedByUsername: schema.users.username,
  verifiedAt: schema.payments.verifiedAt,
  rejectionReason: schema.payments.rejectionReason,
  postedAt: schema.payments.postedAt,
  reversedAt: schema.payments.reversedAt,
  createdAt: schema.payments.createdAt,
} as const;

function basePaymentQuery(db: Executor) {
  return db
    .select(paymentProjection)
    .from(schema.payments)
    .innerJoin(schema.subscribers, eq(schema.payments.subscriberId, schema.subscribers.id))
    .innerJoin(
      schema.serviceAccounts,
      eq(schema.payments.serviceAccountId, schema.serviceAccounts.id),
    )
    .leftJoin(schema.receipts, eq(schema.receipts.paymentId, schema.payments.id))
    .leftJoin(schema.users, eq(schema.payments.receivedBy, schema.users.id));
}

function buildPaymentFilters(query: PaymentListQuery): SQL | undefined {
  const conditions: SQL[] = [];

  if (query.status !== undefined) conditions.push(eq(schema.payments.status, query.status));
  if (query.paymentMethod !== undefined) {
    conditions.push(eq(schema.payments.paymentMethod, query.paymentMethod));
  }
  if (query.subscriberId !== undefined) {
    conditions.push(eq(schema.payments.subscriberId, query.subscriberId));
  }
  if (query.serviceAccountId !== undefined) {
    conditions.push(eq(schema.payments.serviceAccountId, query.serviceAccountId));
  }
  if (query.from !== undefined)
    conditions.push(gte(schema.payments.paymentDate, sql`${query.from}::date`));
  if (query.to !== undefined)
    conditions.push(lte(schema.payments.paymentDate, sql`${query.to}::date`));
  if (query.search !== undefined && query.search.length > 0) {
    const pattern = `%${query.search}%`;
    const search = or(
      ilike(schema.subscribers.displayName, pattern),
      ilike(schema.subscribers.accountNumber, pattern),
      ilike(schema.payments.referenceNumber, pattern),
    );
    if (search !== undefined) conditions.push(search);
  }

  if (conditions.length === 0) return undefined;
  return and(...conditions);
}

export async function listPayments(
  db: Executor,
  query: PaymentListQuery,
  offset: number,
): Promise<readonly PaymentRow[]> {
  return basePaymentQuery(db)
    .where(buildPaymentFilters(query))
    .orderBy(desc(schema.payments.paymentDate), desc(schema.payments.id))
    .limit(query.pageSize)
    .offset(offset);
}

export async function countPayments(db: Executor, query: PaymentListQuery): Promise<number> {
  const rows = await db
    .select({ total: count() })
    .from(schema.payments)
    .innerJoin(schema.subscribers, eq(schema.payments.subscriberId, schema.subscribers.id))
    .innerJoin(
      schema.serviceAccounts,
      eq(schema.payments.serviceAccountId, schema.serviceAccounts.id),
    )
    .where(buildPaymentFilters(query));

  return rows[0]?.total ?? 0;
}

export async function findPaymentRow(db: Executor, paymentId: number): Promise<PaymentRow | null> {
  const rows = await basePaymentQuery(db).where(eq(schema.payments.id, paymentId)).limit(1);
  return rows[0] ?? null;
}

/** Open invoices for one service account, oldest first, for allocation. */
export async function listOpenInvoices(
  db: Executor,
  serviceAccountId: number,
): Promise<readonly OpenInvoiceRow[]> {
  return db
    .select({
      invoiceId: schema.invoices.id,
      invoiceNumber: schema.invoices.invoiceNumber,
      dueDate: schema.invoices.dueDate,
      balanceCentavos: schema.invoices.balanceCentavos,
    })
    .from(schema.invoices)
    .where(
      and(
        eq(schema.invoices.serviceAccountId, serviceAccountId),
        inArray(schema.invoices.status, ['UNPAID', 'PARTIALLY_PAID']),
        sql`${schema.invoices.balanceCentavos} > 0`,
      ),
    )
    .orderBy(asc(schema.invoices.dueDate), asc(schema.invoices.id));
}

export async function listPaymentAllocations(
  db: Executor,
  paymentId: number,
): Promise<readonly AllocationRow[]> {
  return db
    .select({
      id: schema.paymentAllocations.id,
      invoiceId: schema.paymentAllocations.invoiceId,
      invoiceNumber: schema.invoices.invoiceNumber,
      amountCentavos: schema.paymentAllocations.amountCentavos,
      isReversal: schema.paymentAllocations.isReversal,
    })
    .from(schema.paymentAllocations)
    .innerJoin(schema.invoices, eq(schema.paymentAllocations.invoiceId, schema.invoices.id))
    .where(eq(schema.paymentAllocations.paymentId, paymentId))
    .orderBy(asc(schema.paymentAllocations.id));
}

export interface InsertPaymentValues {
  readonly subscriberId: number;
  readonly serviceAccountId: number;
  readonly paymentDate: Date;
  readonly paymentMethod: string;
  readonly amountCentavos: number;
  readonly appliedCentavos: number;
  readonly unappliedCentavos: number;
  readonly status: string;
  readonly referenceNumber: string | null;
  readonly senderName: string | null;
  readonly senderMobile: string | null;
  readonly notes: string | null;
  readonly receivedBy: number | null;
  readonly postedAt: Date | null;
  readonly createdBy: number | null;
}

export async function insertPayment(tx: Tx, values: InsertPaymentValues): Promise<number> {
  const rows = await tx
    .insert(schema.payments)
    .values({ ...values, updatedBy: values.createdBy })
    .returning({ id: schema.payments.id });

  const id = rows[0]?.id;
  if (id === undefined) throw new Error('Inserting a payment returned no id.');
  return id;
}

export async function insertAllocation(
  tx: Tx,
  values: {
    readonly paymentId: number;
    readonly invoiceId: number;
    readonly amountCentavos: number;
    readonly isReversal: boolean;
    readonly reversesAllocationId: number | null;
    readonly isManual: boolean;
    readonly allocatedBy: number | null;
  },
): Promise<void> {
  await tx.insert(schema.paymentAllocations).values(values);
}

export async function insertReceipt(
  tx: Tx,
  values: {
    readonly receiptNumber: string;
    readonly paymentId: number;
    readonly issuedAt: Date;
    readonly createdBy: number | null;
  },
): Promise<void> {
  await tx.insert(schema.receipts).values(values);
}

/**
 * Void the receipt issued for a payment.
 *
 * This is the only permitted change to an issued receipt (see the
 * `enforce_receipt_immutability` trigger): the number stays reserved and is
 * never reissued, and the reason is the one supplied by the reversal. Returns
 * the voided receipt id, or `null` when the payment never produced one.
 */
export async function voidReceiptForPayment(
  tx: Tx,
  paymentId: number,
  reason: string,
  actorId: number,
): Promise<number | null> {
  const rows = await tx
    .update(schema.receipts)
    .set({
      status: 'VOID',
      voidedAt: new Date(),
      voidedBy: actorId,
      voidReason: reason,
      updatedAt: new Date(),
      updatedBy: actorId,
    })
    .where(and(eq(schema.receipts.paymentId, paymentId), eq(schema.receipts.status, 'ISSUED')))
    .returning({ id: schema.receipts.id });

  return rows[0]?.id ?? null;
}

/**
 * Apply a payment allocation to an invoice's maintained caches.
 *
 * The cache columns (`paid_centavos`, `balance_centavos`) and the lifecycle
 * status move together, inside the payment transaction. `balance` and `paid`
 * in the SET expressions read the pre-update values, so no separate SELECT is
 * needed.
 */
export async function applyAllocationToInvoice(
  tx: Tx,
  invoiceId: number,
  amountCentavos: number,
  actorUserId: number | null,
): Promise<void> {
  await tx.execute(sql`
    UPDATE invoices
    SET paid_centavos = paid_centavos + ${amountCentavos},
        balance_centavos = balance_centavos - ${amountCentavos},
        status = CASE
          WHEN balance_centavos - ${amountCentavos} <= 0 THEN 'PAID'
          ELSE 'PARTIALLY_PAID'
        END,
        updated_at = now(),
        updated_by = ${actorUserId}
    WHERE id = ${invoiceId}
  `);
}

/** Undo an allocation during a reversal. */
export async function releaseAllocationFromInvoice(
  tx: Tx,
  invoiceId: number,
  amountCentavos: number,
  actorUserId: number | null,
): Promise<void> {
  await tx.execute(sql`
    UPDATE invoices
    SET paid_centavos = paid_centavos - ${amountCentavos},
        balance_centavos = balance_centavos + ${amountCentavos},
        status = CASE
          WHEN balance_centavos + ${amountCentavos} >= total_centavos THEN 'UNPAID'
          ELSE 'PARTIALLY_PAID'
        END,
        updated_at = now(),
        updated_by = ${actorUserId}
    WHERE id = ${invoiceId}
  `);
}

/** Mark a pending payment posted, together with its split and timestamps. */
export async function postPayment(
  tx: Tx,
  paymentId: number,
  values: {
    readonly appliedCentavos: number;
    readonly unappliedCentavos: number;
    readonly postedAt: Date;
    readonly verifiedBy: number | null;
    readonly updatedBy: number | null;
  },
): Promise<void> {
  await tx
    .update(schema.payments)
    .set({
      status: 'POSTED',
      appliedCentavos: values.appliedCentavos,
      unappliedCentavos: values.unappliedCentavos,
      postedAt: values.postedAt,
      verifiedBy: values.verifiedBy,
      verifiedAt: values.postedAt,
      updatedAt: new Date(),
      updatedBy: values.updatedBy,
    })
    .where(eq(schema.payments.id, paymentId));
}

/** Reject a pending payment. Nothing is allocated, nothing is posted. */
export async function rejectPayment(
  tx: Tx,
  paymentId: number,
  values: {
    readonly rejectionReason: string;
    readonly verifiedBy: number | null;
    readonly updatedBy: number | null;
  },
): Promise<void> {
  await tx
    .update(schema.payments)
    .set({
      status: 'REJECTED',
      rejectionReason: values.rejectionReason,
      verifiedBy: values.verifiedBy,
      verifiedAt: new Date(),
      updatedAt: new Date(),
      updatedBy: values.updatedBy,
    })
    .where(eq(schema.payments.id, paymentId));
}

export async function markPaymentReversed(
  tx: Tx,
  paymentId: number,
  actorUserId: number | null,
): Promise<void> {
  await tx
    .update(schema.payments)
    .set({
      status: 'REVERSED',
      reversedAt: new Date(),
      updatedAt: new Date(),
      updatedBy: actorUserId,
    })
    .where(eq(schema.payments.id, paymentId));
}

export interface InsertReversalValues {
  readonly originalPaymentId: number;
  readonly reasonCode: string;
  readonly reason: string;
  readonly amountCentavos: number;
  readonly reversedBy: number | null;
  readonly reversedAt: Date;
}

export async function insertReversal(tx: Tx, values: InsertReversalValues): Promise<void> {
  await tx.insert(schema.paymentReversals).values(values);
}

export async function listPendingVerification(db: Executor): Promise<readonly PaymentRow[]> {
  return basePaymentQuery(db)
    .where(eq(schema.payments.status, 'PENDING_VERIFICATION'))
    .orderBy(asc(schema.payments.paymentDate), asc(schema.payments.id));
}

export async function gcashReferenceExists(
  db: Executor,
  referenceNumber: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.payments.id })
    .from(schema.payments)
    .where(
      and(
        eq(schema.payments.paymentMethod, 'GCASH'),
        sql`upper(btrim(${schema.payments.referenceNumber})) = upper(btrim(${referenceNumber}))`,
        sql`${schema.payments.status} NOT IN ('REJECTED', 'REVERSED')`,
      ),
    )
    .limit(1);

  return rows.length > 0;
}
