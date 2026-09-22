import { isPenaltyDue } from '@bcis/domain';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  applyRateBasisPoints,
  businessToday,
  centavos,
  signedCentavos,
} from '@bcis/shared';
import {
  offsetFor,
  type ApplyPenaltiesInput,
  type CreateAdjustmentInput,
  type FinalizeInvoiceInput,
  type InvoiceDetail,
  type InvoiceListQuery,
  type InvoiceSummary,
  type VoidInvoiceInput,
} from '@bcis/validation';

import type { Db } from '../../shared/database';
import type { ActorContext } from '../../shared/request-context';
import { AUDIT_ACTIONS, AUDIT_ENTITIES } from '../audit/audit.actions';
import { writeAudit } from '../audit/audit.service';
import { insertLedgerEntry } from '../ledger/ledger.repository';
import { findSettingByKey } from '../settings/settings.repository';
import { toInvoiceDetail, toInvoiceSummary } from './billing.mapper';
import * as repository from './billing.repository';

/**
 * Invoice operations.
 *
 * ── THE THREE WAYS A POSTED INVOICE MAY CHANGE ──────────────────────────────
 * Nothing here edits a finalized invoice in place. Instead:
 *
 *   finalize   a draft becomes a posted document and writes its ledger debit
 *   adjust     a debit or credit raises or lowers the total, with a reason
 *   void       the invoice stops being owed, and its debit is reversed
 *
 * The database enforces the same boundary from underneath: a trigger rejects
 * any update to a finalized invoice's identity, dates or frozen components, and
 * rejects any change to its lines except adding an ADJUSTMENT or PENALTY line.
 * These functions are the supported path through that gate, not the gate itself.
 */

export interface InvoicePage {
  readonly invoices: readonly InvoiceSummary[];
  readonly total: number;
}

export async function listInvoices(db: Db, query: InvoiceListQuery): Promise<InvoicePage> {
  const today = businessToday();
  const offset = offsetFor(query.page, query.pageSize);

  const [rows, total] = await Promise.all([
    repository.listInvoices(db, query, today, offset),
    repository.countInvoices(db, query, today),
  ]);

  return { invoices: rows.map((row) => toInvoiceSummary(row, today)), total };
}

export async function getInvoice(db: Db, invoiceId: number): Promise<InvoiceDetail> {
  const row = await repository.findInvoiceRow(db, invoiceId);
  if (row === null) {
    throw new NotFoundError('That invoice does not exist.');
  }

  const [items, adjustments] = await Promise.all([
    repository.listInvoiceItems(db, invoiceId),
    repository.listInvoiceAdjustments(db, invoiceId),
  ]);

  return toInvoiceDetail(row, items, adjustments, businessToday());
}

/**
 * Post a draft invoice.
 *
 * The status change and the ledger debit happen together. An invoice that
 * existed without its entry would be a charge the ledger could not account for,
 * which is the one thing the ledger exists to prevent.
 */
export async function finalizeInvoice(
  db: Db,
  invoiceId: number,
  input: FinalizeInvoiceInput,
  actor: ActorContext,
): Promise<InvoiceDetail> {
  const row = await repository.findInvoiceRow(db, invoiceId);
  if (row === null) {
    throw new NotFoundError('That invoice does not exist.');
  }

  if (row.status !== 'DRAFT') {
    throw new ConflictError(
      row.status === 'VOID'
        ? 'That invoice has been voided.'
        : 'That invoice has already been posted.',
    );
  }

  const entryDate = input.entryDate ?? row.issueDate;

  await db.transaction(async (tx) => {
    await repository.finalizeInvoiceRow(tx, invoiceId, actor.userId);

    if (row.totalCentavos > 0) {
      await insertLedgerEntry(tx, {
        serviceAccountId: row.serviceAccountId,
        subscriberId: row.subscriberId,
        entryDate,
        entryType: 'INVOICE',
        sourceType: 'invoice',
        sourceId: invoiceId,
        referenceNo: row.invoiceNumber,
        description: `Invoice ${row.invoiceNumber}`,
        debitCentavos: row.totalCentavos,
        creditCentavos: 0,
        actorUserId: actor.userId,
      });
    }

    await writeAudit(tx, {
      action: AUDIT_ACTIONS.INVOICE_FINALIZED,
      entityType: AUDIT_ENTITIES.INVOICE,
      entityId: String(invoiceId),
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ip: actor.ip,
      newValues: { invoiceNumber: row.invoiceNumber, totalCentavos: row.totalCentavos, entryDate },
    });
  });

  return getInvoice(db, invoiceId);
}

/**
 * Void an invoice.
 *
 * ── WHAT VOIDING DOES NOT DO ────────────────────────────────────────────────
 * It does not delete the invoice, and it does not delete its lines. The number
 * stays reserved, the original charges stay readable, and the ledger is brought
 * back to zero by a REVERSAL credit. `uq_invoices_account_period` excludes VOID
 * rows, so the account-period slot becomes available for a corrected invoice —
 * which is the only reason a void is useful rather than merely tidy.
 */
export async function voidInvoice(
  db: Db,
  invoiceId: number,
  input: VoidInvoiceInput,
  actor: ActorContext,
): Promise<InvoiceDetail> {
  const row = await repository.findInvoiceRow(db, invoiceId);
  if (row === null) {
    throw new NotFoundError('That invoice does not exist.');
  }

  if (row.status === 'VOID') {
    throw new ConflictError('That invoice has already been voided.');
  }

  // Voiding does not erase money that was received. A payment must be reversed
  // first (Phase 5), or the ledger would show a credit with nothing behind it.
  if (row.paidCentavos > 0) {
    throw new ConflictError(
      'That invoice has payments applied. Reverse the payments before voiding it.',
    );
  }

  const reversalDate = businessToday();

  await db.transaction(async (tx) => {
    // Reverse the debit that finalization posted, rather than removing it.
    if (row.finalizedAt !== null && row.totalCentavos > 0) {
      await insertLedgerEntry(tx, {
        serviceAccountId: row.serviceAccountId,
        subscriberId: row.subscriberId,
        entryDate: reversalDate,
        entryType: 'REVERSAL',
        sourceType: 'invoice',
        sourceId: invoiceId,
        referenceNo: row.invoiceNumber,
        description: `Voided invoice ${row.invoiceNumber}`,
        debitCentavos: 0,
        creditCentavos: row.totalCentavos,
        actorUserId: actor.userId,
      });
    }

    await repository.voidInvoiceRow(tx, invoiceId, input.reason, actor.userId);

    await writeAudit(tx, {
      action: AUDIT_ACTIONS.INVOICE_VOIDED,
      entityType: AUDIT_ENTITIES.INVOICE,
      entityId: String(invoiceId),
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ip: actor.ip,
      reason: input.reason,
      oldValues: { status: row.status, totalCentavos: row.totalCentavos },
      newValues: { status: 'VOID', reversalDate },
    });
  });

  return getInvoice(db, invoiceId);
}

/**
 * Post an adjustment against an invoice.
 *
 * ── WHY THE ORDER INSIDE THE TRANSACTION MATTERS ────────────────────────────
 * The invoice line is written FIRST, then the invoice's components are
 * refreshed. The trigger on `invoices` compares those components against the
 * lines attached to the invoice, so writing the total before the line that
 * justifies it would fail — which is the correct behaviour, and the reason the
 * order is spelled out here.
 */
export async function postAdjustment(
  db: Db,
  invoiceId: number,
  input: CreateAdjustmentInput,
  actor: ActorContext,
): Promise<InvoiceDetail> {
  const row = await repository.findInvoiceRow(db, invoiceId);
  if (row === null) {
    throw new NotFoundError('That invoice does not exist.');
  }

  if (row.status === 'VOID') {
    throw new ConflictError('A voided invoice cannot be adjusted.');
  }

  if (row.status === 'DRAFT') {
    throw new ConflictError(
      'Post the invoice before adjusting it. A draft has not been billed yet.',
    );
  }

  const signedDelta =
    input.adjustmentType === 'DEBIT' ? input.amountCentavos : -input.amountCentavos;

  const nextAdjustment = signedCentavos(row.adjustmentCentavos + signedDelta);
  const nextTotal = signedCentavos(
    row.subtotalCentavos -
      row.discountCentavos +
      row.penaltyCentavos +
      nextAdjustment +
      row.taxCentavos,
  );

  // A credit that outgrows the invoice is not silently clamped: the excess is
  // real money and belongs on the account as credit, which is a Phase 5
  // concept. Refusing is the honest answer until that exists.
  if (nextTotal < 0) {
    throw new ValidationError(
      'That credit is larger than the invoice total. Reduce the amount, or raise it as account credit.',
      { field: 'amountCentavos', currentTotalCentavos: row.totalCentavos },
    );
  }

  const nextBalance = signedCentavos(nextTotal - row.paidCentavos);

  await db.transaction(async (tx) => {
    const invoiceItemId = await repository.insertInvoiceItem(tx, {
      invoiceId,
      itemType: 'ADJUSTMENT',
      direction: input.adjustmentType,
      description: `${input.adjustmentType === 'DEBIT' ? 'Debit' : 'Credit'} adjustment — ${input.reasonCode}`,
      quantity: 1,
      unitPriceCentavos: input.amountCentavos,
      amountCentavos: input.amountCentavos,
      servicePlanId: null,
      serviceAccountId: row.serviceAccountId,
      sortOrder: 1000,
      createdBy: actor.userId,
    });

    const adjustmentId = await repository.insertAdjustment(tx, {
      invoiceId,
      adjustmentType: input.adjustmentType,
      reasonCode: input.reasonCode,
      amountCentavos: input.amountCentavos,
      memo: input.memo,
      invoiceItemId,
      postedAt: new Date(),
      approvedBy: actor.userId,
      createdBy: actor.userId,
    });

    await repository.updateInvoiceComponents(
      tx,
      invoiceId,
      {
        subtotalCentavos: row.subtotalCentavos,
        discountCentavos: row.discountCentavos,
        penaltyCentavos: row.penaltyCentavos,
        adjustmentCentavos: nextAdjustment,
        totalCentavos: nextTotal,
        balanceCentavos: nextBalance,
      },
      actor.userId,
    );

    await insertLedgerEntry(tx, {
      serviceAccountId: row.serviceAccountId,
      subscriberId: row.subscriberId,
      entryDate: businessToday(),
      entryType: 'ADJUSTMENT',
      sourceType: 'adjustment',
      sourceId: adjustmentId,
      referenceNo: row.invoiceNumber,
      description: `${input.reasonCode} adjustment on ${row.invoiceNumber}`,
      debitCentavos: input.adjustmentType === 'DEBIT' ? input.amountCentavos : 0,
      creditCentavos: input.adjustmentType === 'CREDIT' ? input.amountCentavos : 0,
      actorUserId: actor.userId,
    });

    await writeAudit(tx, {
      action: AUDIT_ACTIONS.INVOICE_ADJUSTMENT_POSTED,
      entityType: AUDIT_ENTITIES.ADJUSTMENT,
      entityId: String(adjustmentId),
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ip: actor.ip,
      reason: input.memo,
      oldValues: { totalCentavos: row.totalCentavos, adjustmentCentavos: row.adjustmentCentavos },
      newValues: {
        totalCentavos: nextTotal,
        adjustmentCentavos: nextAdjustment,
        adjustmentType: input.adjustmentType,
        amountCentavos: input.amountCentavos,
      },
    });
  });

  return getInvoice(db, invoiceId);
}

export interface PenaltyRunResult {
  readonly enabled: boolean;
  readonly dryRun: boolean;
  readonly asOf: string;
  readonly basisPoints: number;
  readonly gracePeriodDays: number;
  readonly applied: readonly {
    invoiceNumber: string;
    balanceCentavos: number;
    penaltyCentavos: number;
  }[];
  readonly totalPenaltyCentavos: number;
}

/**
 * Apply late penalties to invoices past their grace period.
 *
 * ── OFF BY DEFAULT, AND APPLIED ONCE (decision A4) ──────────────────────────
 * `billing.penalty_enabled` is false in the seeded settings and
 * `billing.penalty_rate_basis_points` is 0, so this does nothing until an Owner
 * makes a commercial decision. When it runs it skips any invoice that already
 * carries a penalty line, because a penalty that compounds monthly turns a
 * billing system into a debt collector.
 *
 * The penalty is computed on the outstanding BALANCE, in basis points, with
 * half-up rounding on centavos — the same rounding the discount calculation
 * uses, so a statement never shows a figure that cannot be re-derived.
 */
export async function applyPenalties(
  db: Db,
  input: ApplyPenaltiesInput,
  actor: ActorContext,
): Promise<PenaltyRunResult> {
  const asOf = input.asOf ?? businessToday();

  const [enabledSetting, rateSetting, graceSetting] = await Promise.all([
    findSettingByKey(db, 'billing.penalty_enabled'),
    findSettingByKey(db, 'billing.penalty_rate_basis_points'),
    findSettingByKey(db, 'billing.grace_period_days'),
  ]);

  const enabled = enabledSetting?.value === 'true';
  const basisPoints = Number(rateSetting?.value ?? '0');
  const gracePeriodDays = Number(graceSetting?.value ?? '0');

  if (!enabled || basisPoints <= 0) {
    return {
      enabled: false,
      dryRun: input.dryRun,
      asOf,
      basisPoints,
      gracePeriodDays,
      applied: [],
      totalPenaltyCentavos: 0,
    };
  }

  const candidates = await repository.listPenaltyCandidates(db, asOf);
  const planned: {
    invoice: (typeof candidates)[number];
    penaltyCentavos: number;
  }[] = [];

  for (const invoice of candidates) {
    if (!isPenaltyDue({ dueDate: invoice.dueDate, today: asOf, gracePeriodDays })) continue;
    if (await repository.hasPenaltyLine(db, invoice.id)) continue;

    const penalty = applyRateBasisPoints(centavos(invoice.balanceCentavos), basisPoints);
    if (penalty === 0) continue;

    planned.push({ invoice, penaltyCentavos: penalty });
  }

  if (input.dryRun || planned.length === 0) {
    return {
      enabled: true,
      dryRun: input.dryRun,
      asOf,
      basisPoints,
      gracePeriodDays,
      applied: planned.map((item) => ({
        invoiceNumber: item.invoice.invoiceNumber,
        balanceCentavos: item.invoice.balanceCentavos,
        penaltyCentavos: item.penaltyCentavos,
      })),
      totalPenaltyCentavos: planned.reduce((sum, item) => sum + item.penaltyCentavos, 0),
    };
  }

  await db.transaction(async (tx) => {
    for (const item of planned) {
      const { invoice, penaltyCentavos } = item;

      const invoiceItemId = await repository.insertInvoiceItem(tx, {
        invoiceId: invoice.id,
        itemType: 'PENALTY',
        direction: 'DEBIT',
        description: `Late payment penalty (${String(basisPoints / 100)}%)`,
        quantity: 1,
        unitPriceCentavos: penaltyCentavos,
        amountCentavos: penaltyCentavos,
        servicePlanId: null,
        serviceAccountId: invoice.serviceAccountId,
        sortOrder: 2000,
        createdBy: actor.userId,
      });

      // The document that justifies the change, so a penalty is as auditable
      // as a hand-entered adjustment.
      const adjustmentId = await repository.insertAdjustment(tx, {
        invoiceId: invoice.id,
        adjustmentType: 'DEBIT',
        reasonCode: 'LATE_FEE',
        amountCentavos: penaltyCentavos,
        memo: `Late payment penalty applied on ${asOf}.`,
        invoiceItemId,
        postedAt: new Date(),
        approvedBy: actor.userId,
        createdBy: actor.userId,
      });

      const row = await repository.findInvoiceRow(tx, invoice.id);
      if (row === null) continue;

      const nextPenalty = centavos(row.penaltyCentavos + penaltyCentavos);
      const nextTotal = signedCentavos(row.totalCentavos + penaltyCentavos);

      await repository.updateInvoiceComponents(
        tx,
        invoice.id,
        {
          subtotalCentavos: row.subtotalCentavos,
          discountCentavos: row.discountCentavos,
          penaltyCentavos: nextPenalty,
          adjustmentCentavos: signedCentavos(row.adjustmentCentavos),
          totalCentavos: nextTotal,
          balanceCentavos: signedCentavos(nextTotal - row.paidCentavos),
        },
        actor.userId,
      );

      await insertLedgerEntry(tx, {
        serviceAccountId: invoice.serviceAccountId,
        subscriberId: invoice.subscriberId,
        entryDate: asOf,
        entryType: 'ADJUSTMENT',
        sourceType: 'adjustment',
        sourceId: adjustmentId,
        referenceNo: invoice.invoiceNumber,
        description: `Late payment penalty on ${invoice.invoiceNumber}`,
        debitCentavos: penaltyCentavos,
        creditCentavos: 0,
        actorUserId: actor.userId,
      });

      await writeAudit(tx, {
        action: AUDIT_ACTIONS.INVOICE_PENALTY_APPLIED,
        entityType: AUDIT_ENTITIES.INVOICE,
        entityId: String(invoice.id),
        actorUserId: actor.userId,
        sessionId: actor.sessionId,
        ip: actor.ip,
        newValues: {
          invoiceNumber: invoice.invoiceNumber,
          penaltyCentavos,
          basisPoints,
          asOf,
        },
      });
    }
  });

  return {
    enabled: true,
    dryRun: false,
    asOf,
    basisPoints,
    gracePeriodDays,
    applied: planned.map((item) => ({
      invoiceNumber: item.invoice.invoiceNumber,
      balanceCentavos: item.invoice.balanceCentavos,
      penaltyCentavos: item.penaltyCentavos,
    })),
    totalPenaltyCentavos: planned.reduce((sum, item) => sum + item.penaltyCentavos, 0),
  };
}
