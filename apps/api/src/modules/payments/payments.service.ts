import {
  allocateAsDirected,
  allocateOldestFirst,
  type AllocatableInvoice,
} from '@bcis/domain';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  businessToday,
  centavos,
  paymentMethodCarriesReference,
  paymentMethodRequiresVerification,
  type BusinessDate,
} from '@bcis/shared';
import {
  offsetFor,
  type CreatePaymentInput,
  type PaymentDetail,
  type PaymentListQuery,
  type PaymentPreview,
  type PaymentSummary,
  type ReversePaymentInput,
  type VerifyPaymentInput,
} from '@bcis/validation';

import type { Db, Tx } from '../../shared/database';
import type { ActorContext } from '../../shared/request-context';
import { NUMBER_SCOPES, allocateDocumentNumber } from '../../shared/numbering';
import { AUDIT_ACTIONS, AUDIT_ENTITIES } from '../audit/audit.actions';
import { writeAudit } from '../audit/audit.service';
import { insertLedgerEntry } from '../ledger/ledger.repository';
import { findServiceAccountRow } from '../service-accounts/service-accounts.repository';
import { toPaymentDetail, toPaymentSummary } from './payments.mapper';
import * as repository from './payments.repository';

/**
 * Payments.
 *
 * ── THE ONE RULE ────────────────────────────────────────────────────────────
 * A posted payment is a transaction: allocations, invoice caches, the ledger
 * credit, the receipt, and the audit row all commit together, or none of them
 * do. A GCash or bank payment enters `PENDING_VERIFICATION` and is only posted
 * when a person approves it — the money is a claim until then, so nothing is
 * allocated and no receipt is issued.
 */

export interface PaymentPage {
  readonly payments: readonly PaymentSummary[];
  readonly total: number;
}

async function loadAllocatable(db: Db, serviceAccountId: number): Promise<readonly AllocatableInvoice[]> {
  const rows = await repository.listOpenInvoices(db, serviceAccountId);
  return rows.map((row) => ({
    invoiceId: row.invoiceId,
    invoiceNumber: row.invoiceNumber,
    dueDate: row.dueDate as BusinessDate,
    balance: centavos(row.balanceCentavos),
  }));
}

/** Compute an allocation for a payment without writing anything. */
async function planAllocation(
  db: Db,
  input: CreatePaymentInput,
): Promise<{ applied: number; unapplied: number; lines: readonly { invoiceId: number; amount: number }[] }> {
  const amount = centavos(input.amountCentavos);
  const invoices = await loadAllocatable(db, input.serviceAccountId);

  if (input.allocations !== undefined && input.allocations.length > 0) {
    const byId = new Map(invoices.map((invoice) => [invoice.invoiceId, invoice]));
    const directed = input.allocations.map((line) => {
      const invoice = byId.get(line.invoiceId);
      if (invoice === undefined) {
        throw new ValidationError('One or more invoices are not open for this account.', {
          field: 'allocations',
        });
      }
      return { invoice, amount: centavos(line.amountCentavos) };
    });

    try {
      const result = allocateAsDirected(amount, directed);
      return {
        applied: result.applied,
        unapplied: result.unapplied,
        lines: result.allocations.map((line) => ({ invoiceId: line.invoiceId, amount: line.amount })),
      };
    } catch (error) {
      throw new ValidationError(
        error instanceof Error ? error.message : 'The allocation is not valid.',
        { field: 'allocations' },
      );
    }
  }

  const result = allocateOldestFirst(amount, invoices);
  return {
    applied: result.applied,
    unapplied: result.unapplied,
    lines: result.allocations.map((line) => ({ invoiceId: line.invoiceId, amount: line.amount })),
  };
}

export async function listPayments(db: Db, query: PaymentListQuery): Promise<PaymentPage> {
  const offset = offsetFor(query.page, query.pageSize);

  const [rows, total] = await Promise.all([
    repository.listPayments(db, query, offset),
    repository.countPayments(db, query),
  ]);

  return { payments: rows.map((row) => toPaymentSummary(row)), total };
}

export async function getPayment(db: Db, paymentId: number): Promise<PaymentDetail> {
  const row = await repository.findPaymentRow(db, paymentId);
  if (row === null) {
    throw new NotFoundError('That payment does not exist.');
  }

  const allocations = await repository.listPaymentAllocations(db, paymentId);
  return toPaymentDetail(row, allocations);
}

export async function previewPayment(db: Db, input: CreatePaymentInput): Promise<PaymentPreview> {
  const account = await requireAccount(db, input);
  const planned = await planAllocation(db, input);

  const invoices = await loadAllocatable(db, account.id);
  const byId = new Map(invoices.map((invoice) => [invoice.invoiceId, invoice.invoiceNumber]));

  return {
    appliedCentavos: planned.applied,
    unappliedCentavos: planned.unapplied,
    allocations: planned.lines.map((line) => ({
      invoiceId: line.invoiceId,
      invoiceNumber: byId.get(line.invoiceId) ?? '',
      amountCentavos: line.amount,
    })),
  };
}

async function requireAccount(
  db: Db,
  input: CreatePaymentInput,
): Promise<{ id: number; subscriberId: number; accountNumber: string }> {
  const account = await findServiceAccountRow(db, input.serviceAccountId);
  if (account === null) {
    throw new NotFoundError('That service account does not exist.');
  }
  if (account.subscriberId !== input.subscriberId) {
    throw new ValidationError('That account does not belong to the selected subscriber.', {
      field: 'serviceAccountId',
    });
  }
  return { id: account.id, subscriberId: account.subscriberId, accountNumber: account.accountNumber };
}

function assertMethodRules(input: CreatePaymentInput): void {
  if (paymentMethodCarriesReference(input.paymentMethod)) {
    if (input.referenceNumber === undefined || input.referenceNumber.trim().length === 0) {
      throw new ValidationError('Enter the reference number for this payment method.', {
        field: 'referenceNumber',
      });
    }
  }
}

export async function capturePayment(
  db: Db,
  input: CreatePaymentInput,
  actor: ActorContext,
): Promise<PaymentDetail> {
  const account = await requireAccount(db, input);
  assertMethodRules(input);

  if (
    input.paymentMethod === 'GCASH' &&
    input.referenceNumber !== undefined &&
    (await repository.gcashReferenceExists(db, input.referenceNumber))
  ) {
    throw new ConflictError('That GCash reference has already been used.');
  }

  const requiresVerification = paymentMethodRequiresVerification(input.paymentMethod);

  if (!requiresVerification) {
    const planned = await planAllocation(db, input);

    const paymentId = await db.transaction(async (tx) => {
      const id = await repository.insertPayment(tx, {
        subscriberId: account.subscriberId,
        serviceAccountId: account.id,
        paymentDate: new Date(),
        paymentMethod: input.paymentMethod,
        amountCentavos: input.amountCentavos,
        appliedCentavos: planned.applied,
        unappliedCentavos: planned.unapplied,
        status: 'POSTED',
        referenceNumber: input.referenceNumber ?? null,
        senderName: input.senderName ?? null,
        senderMobile: input.senderMobile ?? null,
        notes: input.notes ?? null,
        receivedBy: actor.userId,
        postedAt: new Date(),
        createdBy: actor.userId,
      });

      await postAllocation(tx, id, planned.lines, actor.userId, account);

      await writeAudit(tx, {
        action: AUDIT_ACTIONS.PAYMENT_POSTED,
        entityType: AUDIT_ENTITIES.PAYMENT,
        entityId: String(id),
        actorUserId: actor.userId,
        sessionId: actor.sessionId,
        ip: actor.ip,
        newValues: {
          amountCentavos: input.amountCentavos,
          paymentMethod: input.paymentMethod,
          appliedCentavos: planned.applied,
          unappliedCentavos: planned.unapplied,
        },
      });

      return id;
    });

    return getPayment(db, paymentId);
  }

  const paymentId = await db.transaction(async (tx) => {
    const id = await repository.insertPayment(tx, {
      subscriberId: account.subscriberId,
      serviceAccountId: account.id,
      paymentDate: new Date(),
      paymentMethod: input.paymentMethod,
      amountCentavos: input.amountCentavos,
      appliedCentavos: 0,
      unappliedCentavos: 0,
      status: 'PENDING_VERIFICATION',
      referenceNumber: input.referenceNumber ?? null,
      senderName: input.senderName ?? null,
      senderMobile: input.senderMobile ?? null,
      notes: input.notes ?? null,
      receivedBy: actor.userId,
      postedAt: null,
      createdBy: actor.userId,
    });

    await writeAudit(tx, {
      action: AUDIT_ACTIONS.PAYMENT_CAPTURED,
      entityType: AUDIT_ENTITIES.PAYMENT,
      entityId: String(id),
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ip: actor.ip,
      newValues: { amountCentavos: input.amountCentavos, paymentMethod: input.paymentMethod },
    });

    return id;
  });

  return getPayment(db, paymentId);
}

/**
 * Write the allocations, the invoice cache updates, the ledger credit, and the
 * receipt for a freshly posted payment — inside the caller's transaction.
 */
async function postAllocation(
  tx: Tx,
  paymentId: number,
  lines: readonly { invoiceId: number; amount: number }[],
  actorUserId: number,
  account: { id: number; subscriberId: number; accountNumber: string },
): Promise<void> {
  const postedAt = new Date();
  const entryDate = businessToday();

  for (const line of lines) {
    await repository.insertAllocation(tx, {
      paymentId,
      invoiceId: line.invoiceId,
      amountCentavos: line.amount,
      isReversal: false,
      reversesAllocationId: null,
      isManual: false,
      allocatedBy: actorUserId,
    });
    await repository.applyAllocationToInvoice(tx, line.invoiceId, line.amount, actorUserId);
  }

  await insertLedgerEntry(tx, {
    serviceAccountId: account.id,
    subscriberId: account.subscriberId,
    entryDate,
    entryType: 'PAYMENT',
    sourceType: 'payment',
    sourceId: paymentId,
    referenceNo: null,
    description: `Payment received`,
    debitCentavos: 0,
    creditCentavos: lines.reduce((sum, line) => sum + line.amount, 0),
    actorUserId,
  });

  const receiptNumber = await allocateDocumentNumber(tx, {
    ...NUMBER_SCOPES.RECEIPT,
    periodYear: Number(entryDate.slice(0, 4)),
  });
  await repository.insertReceipt(tx, {
    receiptNumber,
    paymentId,
    issuedAt: postedAt,
    createdBy: actorUserId,
  });
}

export async function verifyPayment(
  db: Db,
  paymentId: number,
  input: VerifyPaymentInput,
  actor: ActorContext,
): Promise<PaymentDetail> {
  const payment = await repository.findPaymentRow(db, paymentId);
  if (payment === null) {
    throw new NotFoundError('That payment does not exist.');
  }
  if (payment.status !== 'PENDING_VERIFICATION') {
    throw new ConflictError('Only a payment awaiting verification can be approved or rejected.');
  }

  if (!input.approve) {
    await db.transaction(async (tx) => {
      await repository.rejectPayment(tx, paymentId, {
        rejectionReason: input.rejectionReason ?? '',
        verifiedBy: actor.userId,
        updatedBy: actor.userId,
      });
      await writeAudit(tx, {
        action: AUDIT_ACTIONS.PAYMENT_REJECTED,
        entityType: AUDIT_ENTITIES.PAYMENT,
        entityId: String(paymentId),
        actorUserId: actor.userId,
        sessionId: actor.sessionId,
        ip: actor.ip,
        reason: input.rejectionReason ?? null,
        newValues: { status: 'REJECTED' },
      });
    });
    return getPayment(db, paymentId);
  }

  const planned = await planAllocation(db, {
    subscriberId: payment.subscriberId,
    serviceAccountId: payment.serviceAccountId,
    paymentMethod: payment.paymentMethod as CreatePaymentInput['paymentMethod'],
    amountCentavos: payment.amountCentavos,
  });

  await db.transaction(async (tx) => {
    await repository.postPayment(tx, paymentId, {
      appliedCentavos: planned.applied,
      unappliedCentavos: planned.unapplied,
      postedAt: new Date(),
      verifiedBy: actor.userId,
      updatedBy: actor.userId,
    });

    await postAllocation(tx, paymentId, planned.lines, actor.userId, {
      id: payment.serviceAccountId,
      subscriberId: payment.subscriberId,
      accountNumber: payment.serviceAccountNumber,
    });

    await writeAudit(tx, {
      action: AUDIT_ACTIONS.PAYMENT_VERIFIED,
      entityType: AUDIT_ENTITIES.PAYMENT,
      entityId: String(paymentId),
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ip: actor.ip,
      newValues: { status: 'POSTED', appliedCentavos: planned.applied },
    });
  });

  return getPayment(db, paymentId);
}

export async function reversePayment(
  db: Db,
  paymentId: number,
  input: ReversePaymentInput,
  actor: ActorContext,
): Promise<PaymentDetail> {
  const payment = await repository.findPaymentRow(db, paymentId);
  if (payment === null) {
    throw new NotFoundError('That payment does not exist.');
  }
  if (payment.status !== 'POSTED') {
    throw new ConflictError('Only a posted payment can be reversed.');
  }

  const allocations = await repository.listPaymentAllocations(db, paymentId);
  const forward = allocations.filter((allocation) => !allocation.isReversal);

  await db.transaction(async (tx) => {
    await repository.insertReversal(tx, {
      originalPaymentId: paymentId,
      reasonCode: input.reasonCode,
      reason: input.reason,
      amountCentavos: payment.amountCentavos,
      reversedBy: actor.userId,
      reversedAt: new Date(),
    });

    for (const allocation of forward) {
      await repository.insertAllocation(tx, {
        paymentId,
        invoiceId: allocation.invoiceId,
        amountCentavos: allocation.amountCentavos,
        isReversal: true,
        reversesAllocationId: allocation.id,
        isManual: false,
        allocatedBy: actor.userId,
      });
      await repository.releaseAllocationFromInvoice(
        tx,
        allocation.invoiceId,
        allocation.amountCentavos,
        actor.userId,
      );
    }

    await insertLedgerEntry(tx, {
      serviceAccountId: payment.serviceAccountId,
      subscriberId: payment.subscriberId,
      entryDate: businessToday(),
      entryType: 'REVERSAL',
      sourceType: 'payment',
      sourceId: paymentId,
      referenceNo: payment.receiptNumber,
      description: `Reversed payment ${payment.receiptNumber ?? String(paymentId)}`,
      debitCentavos: payment.amountCentavos,
      creditCentavos: 0,
      actorUserId: actor.userId,
    });

    await repository.markPaymentReversed(tx, paymentId, actor.userId);

    await writeAudit(tx, {
      action: AUDIT_ACTIONS.PAYMENT_REVERSED,
      entityType: AUDIT_ENTITIES.PAYMENT,
      entityId: String(paymentId),
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ip: actor.ip,
      reason: input.reason,
      newValues: { status: 'REVERSED', reasonCode: input.reasonCode },
    });
  });

  return getPayment(db, paymentId);
}
