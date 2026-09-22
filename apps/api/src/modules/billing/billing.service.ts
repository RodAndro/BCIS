import {
  type BillingPeriod,
  type InvoiceLine,
  billingPeriodFor,
  chargeLine,
  computeInvoiceDates,
  computeInvoiceTotals,
  monthKeyOf,
  summariseLines,
} from '@bcis/domain';
import { ConflictError, ZERO, businessToday, centavos, isNegative } from '@bcis/shared';
import type {
  BillingDashboard,
  BillingPreview,
  BillingRunResult,
  BillingSkip,
  GenerateBillingInput,
} from '@bcis/validation';

import type { Db } from '../../shared/database';
import { NUMBER_SCOPES, allocateDocumentNumber } from '../../shared/numbering';
import type { ActorContext } from '../../shared/request-context';
import { AUDIT_ACTIONS, AUDIT_ENTITIES } from '../audit/audit.actions';
import { writeAudit } from '../audit/audit.service';
import { insertLedgerEntry } from '../ledger/ledger.repository';
import { skip, toCycleSummary, toPreviewLine } from './billing.mapper';
import * as repository from './billing.repository';
import type { BillableAccountRow } from './billing.repository';

/**
 * Billing generation.
 *
 * ── THE SHAPE OF A RUN ──────────────────────────────────────────────────────
 * Planning and writing are separate. `planBilling` answers "what would happen"
 * without touching anything; `generateBilling` performs it inside ONE
 * transaction. The preview an operator approves and the work that follows are
 * therefore the same computation, not two implementations that can disagree.
 *
 * ── WHY THE WHOLE RUN IS ONE TRANSACTION ────────────────────────────────────
 * A run that failed halfway would leave some accounts invoiced for a period and
 * others not, with no way to tell which without auditing the database by hand.
 * Because every insert — cycle, invoices, lines, ledger entries, the
 * installation-fee flags — shares one transaction, a failure anywhere leaves
 * the database exactly as it was. The test for this injects a conflicting
 * invoice and asserts that the accounts processed before it were rolled back
 * too.
 *
 * ── DUPLICATE BILLING, TWICE OVER ───────────────────────────────────────────
 * Planning skips accounts that already have a live invoice for the period, which
 * produces the readable "already invoiced" line in the preview. The database
 * enforces the same rule with a partial unique index, which is what makes it
 * true when two operators press Generate at the same moment.
 */

export interface PlannedInvoice {
  readonly account: BillableAccountRow;
  readonly lines: readonly InvoiceLine[];
  readonly issueDate: string;
  readonly dueDate: string;
  readonly totalCentavos: number;
  readonly billsInstallationFee: boolean;
}

export interface BillingPlan {
  readonly period: BillingPeriod;
  readonly planned: readonly PlannedInvoice[];
  readonly skipped: readonly BillingSkip[];
}

/** The lines one account should be billed for this period. */
function buildLines(
  account: BillableAccountRow,
  reconnectionOccurred: boolean,
  period: BillingPeriod,
): InvoiceLine[] {
  const lines: InvoiceLine[] = [
    chargeLine({
      itemType: 'SUBSCRIPTION',
      description: `${period.label} — ${account.planCode} ${account.planName}`,
      // The account's own snapshotted rate, not the plan's price today. A price
      // change since activation must not move what this customer is charged.
      unitPriceCentavos: centavos(account.currentPlanPriceCentavos),
    }),
  ];

  // Charged once, ever, even if the first invoice is generated late.
  if (!account.installationFeeCharged && account.installationFeeCentavos > 0) {
    lines.push(
      chargeLine({
        itemType: 'INSTALLATION',
        description: 'Installation fee (one-time)',
        unitPriceCentavos: centavos(account.installationFeeCentavos),
      }),
    );
  }

  // A reconnection recorded inside this period carries its fee on this period's
  // invoice. A reconnection in an already-billed period is handled by an
  // adjustment — the mechanism that exists for exactly that.
  if (reconnectionOccurred && account.reconnectionFeeCentavos > 0) {
    lines.push(
      chargeLine({
        itemType: 'RECONNECTION',
        description: 'Reconnection fee',
        unitPriceCentavos: centavos(account.reconnectionFeeCentavos),
      }),
    );
  }

  return lines;
}

/**
 * Work out what a run would do, without writing anything.
 *
 * Used by the preview endpoint and by the generator, so the two cannot drift.
 */
export async function planBilling(db: Db, input: GenerateBillingInput): Promise<BillingPlan> {
  const period = billingPeriodFor(input.month);

  const [accounts, alreadyInvoiced, reconnected] = await Promise.all([
    repository.listBillableAccounts(db, {
      periodEnd: period.periodEnd,
      collectionAreaId: input.collectionAreaId,
      serviceAccountIds: input.serviceAccountIds,
    }),
    repository.findInvoicedAccountIds(db, period.periodStart),
    repository.findReconnectedAccountIds(db, period.periodStart, period.periodEnd),
  ]);

  const planned: PlannedInvoice[] = [];
  const skipped: BillingSkip[] = [];

  for (const account of accounts) {
    if (alreadyInvoiced.has(account.id)) {
      skipped.push(skip(account, 'Already invoiced for this period.'));
      continue;
    }

    const lines = buildLines(account, reconnected.has(account.id), period);
    const totals = computeInvoiceTotals({ ...summariseLines(lines), taxCentavos: ZERO });

    // Every line is a charge, so this cannot happen today. It is kept as a
    // guard because a future discount or credit line would make it reachable,
    // and silently billing a negative total is not an acceptable failure mode.
    if (isNegative(totals.totalCentavos)) {
      skipped.push(skip(account, 'The computed total would be negative.'));
      continue;
    }

    const dates = computeInvoiceDates({
      periodStart: period.periodStart,
      billingDay: account.billingDay,
      dueDay: account.dueDay,
    });

    planned.push({
      account,
      lines,
      issueDate: dates.issueDate,
      dueDate: dates.dueDate,
      totalCentavos: totals.totalCentavos,
      billsInstallationFee: lines.some((line) => line.itemType === 'INSTALLATION'),
    });
  }

  return { period, planned, skipped };
}

/** What the run would produce, for the confirmation screen. */
export async function previewBilling(db: Db, input: GenerateBillingInput): Promise<BillingPreview> {
  const plan = await planBilling(db, input);
  const cycle = await repository.findCycleByPeriodStart(db, plan.period.periodStart);

  const totalCentavos = plan.planned.reduce((sum, item) => sum + item.totalCentavos, 0);

  return {
    period: {
      periodStart: plan.period.periodStart,
      periodEnd: plan.period.periodEnd,
      label: plan.period.label,
    },
    cycle: cycle === null ? null : toCycleSummary(cycle),
    willInvoice: plan.planned.map((item) =>
      toPreviewLine(item.account, item.lines, item, item.totalCentavos),
    ),
    willSkip: [...plan.skipped],
    totalCentavos,
  };
}

/**
 * Run billing for a month.
 *
 * With `dryRun` set (the default in the schema), nothing is written and the
 * counts describe what would happen.
 */
export async function generateBilling(
  db: Db,
  input: GenerateBillingInput,
  actor: ActorContext,
): Promise<BillingRunResult> {
  const plan = await planBilling(db, input);
  const totalCentavos = plan.planned.reduce((sum, item) => sum + item.totalCentavos, 0);

  const period = {
    periodStart: plan.period.periodStart,
    periodEnd: plan.period.periodEnd,
    label: plan.period.label,
  };

  if (input.dryRun) {
    return {
      dryRun: true,
      asDraft: input.asDraft,
      period,
      invoicesCreated: plan.planned.length,
      accountsSkipped: plan.skipped.length,
      totalCentavos,
      invoiceNumbers: [],
      skipped: [...plan.skipped],
    };
  }

  const existingCycle = await repository.findCycleByPeriodStart(db, plan.period.periodStart);
  if (
    existingCycle !== null &&
    (existingCycle.status === 'CLOSED' || existingCycle.status === 'LOCKED')
  ) {
    throw new ConflictError(
      `The billing cycle for ${plan.period.label} is ${existingCycle.status.toLowerCase()} and cannot be generated.`,
    );
  }

  if (plan.planned.length === 0) {
    return {
      dryRun: false,
      asDraft: input.asDraft,
      period,
      invoicesCreated: 0,
      accountsSkipped: plan.skipped.length,
      totalCentavos: 0,
      invoiceNumbers: [],
      skipped: [...plan.skipped],
    };
  }

  const periodYear = Number(plan.period.periodStart.slice(0, 4));

  let written: { readonly invoiceNumbers: string[] };
  try {
    written = await db.transaction(async (tx) => {
      const cycleId =
        existingCycle?.id ??
        (await repository.insertCycle(tx, {
          periodStart: plan.period.periodStart,
          periodEnd: plan.period.periodEnd,
          dueDate: plan.period.periodEnd,
          label: plan.period.label,
          createdBy: actor.userId,
        }));

      await repository.setCycleStatus(tx, cycleId, 'GENERATING', actor.userId, null);

      const invoiceNumbers: string[] = [];
      const installationAccountIds: number[] = [];

      for (const item of plan.planned) {
        const totals = computeInvoiceTotals({ ...summariseLines(item.lines), taxCentavos: ZERO });

        // Allocated inside the transaction, so a rollback does not consume a
        // number and two concurrent runs cannot share one.
        const invoiceNumber = await allocateDocumentNumber(tx, {
          ...NUMBER_SCOPES.INVOICE,
          periodYear,
        });

        // ── INSERTED AS A DRAFT, THEN POSTED ─────────────────────────────────
        // The order is not cosmetic. The trigger on `invoice_items` refuses to add
        // a charge line to an invoice that is already finalized — that rule is
        // what stops a posted invoice being rewritten. So the invoice is created
        // unposted, its lines are attached, and only then is it posted, at which
        // point the invoice trigger verifies every component against those lines.
        // Creating it finalized first would have the database reject the very
        // lines that justify it.
        const invoiceId = await repository.insertInvoice(tx, {
          invoiceNumber,
          subscriberId: item.account.subscriberId,
          serviceAccountId: item.account.id,
          billingCycleId: cycleId,
          billingPeriodStart: plan.period.periodStart,
          billingPeriodEnd: plan.period.periodEnd,
          issueDate: item.issueDate,
          dueDate: item.dueDate,
          subtotalCentavos: totals.subtotalCentavos,
          discountCentavos: totals.discountCentavos,
          penaltyCentavos: totals.penaltyCentavos,
          adjustmentCentavos: totals.adjustmentCentavos,
          taxCentavos: totals.taxCentavos,
          totalCentavos: totals.totalCentavos,
          balanceCentavos: totals.totalCentavos,
          status: 'DRAFT',
          finalizedAt: null,
          finalizedBy: null,
          createdBy: actor.userId,
        });

        let sortOrder = 0;
        for (const line of item.lines) {
          await repository.insertInvoiceItem(tx, {
            invoiceId,
            itemType: line.itemType,
            direction: line.direction,
            description: line.description,
            quantity: line.quantity,
            unitPriceCentavos: line.unitPriceCentavos,
            amountCentavos: line.amountCentavos,
            servicePlanId: item.account.servicePlanId,
            serviceAccountId: item.account.id,
            sortOrder,
            createdBy: actor.userId,
          });
          sortOrder += 1;
        }

        if (!input.asDraft) {
          await repository.finalizeInvoiceRow(tx, invoiceId, actor.userId);

          // The debit side of the ledger. A draft is not yet a posted document, so
          // it writes nothing until it is finalized — and a zero-total invoice has
          // no entry to write, because a ledger row must move a balance.
          if (item.totalCentavos > 0) {
            await insertLedgerEntry(tx, {
              serviceAccountId: item.account.id,
              subscriberId: item.account.subscriberId,
              entryDate: item.issueDate,
              entryType: 'INVOICE',
              sourceType: 'invoice',
              sourceId: invoiceId,
              referenceNo: invoiceNumber,
              description: `${plan.period.label} — ${item.account.planCode} ${item.account.planName}`,
              debitCentavos: item.totalCentavos,
              creditCentavos: 0,
              actorUserId: actor.userId,
            });
          }
        }

        if (item.billsInstallationFee) {
          installationAccountIds.push(item.account.id);
        }

        invoiceNumbers.push(invoiceNumber);
      }

      // Marked charged in the same transaction that billed it, so the fee is
      // charged exactly once even if this run is retried.
      await repository.markInstallationFeeCharged(tx, installationAccountIds, actor.userId);
      await repository.setCycleStatus(tx, cycleId, 'GENERATED', actor.userId, new Date());

      await writeAudit(tx, {
        action: AUDIT_ACTIONS.BILLING_GENERATED,
        entityType: AUDIT_ENTITIES.BILLING_CYCLE,
        entityId: String(cycleId),
        actorUserId: actor.userId,
        sessionId: actor.sessionId,
        ip: actor.ip,
        newValues: {
          month: input.month,
          invoicesCreated: invoiceNumbers.length,
          accountsSkipped: plan.skipped.length,
          totalCentavos,
          asDraft: input.asDraft,
        },
      });

      return { invoiceNumbers };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Another generator committed the same period while this request was
      // planning. Re-read the committed state and return an idempotent result.
      return generateBilling(db, input, actor);
    }
    throw error;
  }

  return {
    dryRun: false,
    asDraft: input.asDraft,
    period,
    invoicesCreated: written.invoiceNumbers.length,
    accountsSkipped: plan.skipped.length,
    totalCentavos,
    invoiceNumbers: written.invoiceNumbers,
    skipped: [...plan.skipped],
  };
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as {
    code?: unknown;
    cause?: unknown;
    message?: unknown;
    constraint?: unknown;
  };
  const constraint = typeof candidate.constraint === 'string' ? candidate.constraint : '';
  const message = typeof candidate.message === 'string' ? candidate.message : '';
  if (
    candidate.code === '23505' &&
    /uq_billing_cycles_period|uq_invoices_account_period/.test(constraint)
  ) {
    return true;
  }
  if (/uq_billing_cycles_period|uq_invoices_account_period/.test(message)) {
    return true;
  }
  return isUniqueViolation(candidate.cause);
}

/** Recent cycles, newest first. */
export async function listBillingCycles(db: Db, limit = 12) {
  const rows = await repository.listCycles(db, limit);
  return rows.map(toCycleSummary);
}

/**
 * The billing dashboard's figures.
 *
 * ── WHAT THIS IS NOT ────────────────────────────────────────────────────────
 * There is no aging here. AR aging buckets (current / 1–30 / 31–60 / 61–90 /
 * 90+) are a receivables concern and arrive in Phase 7; putting a half-built
 * version on a dashboard now would produce a number nobody could reconcile.
 */
export async function getBillingDashboard(db: Db): Promise<BillingDashboard> {
  const today = businessToday();
  const period = billingPeriodFor(monthKeyOf(today));

  const [aggregates, cycles] = await Promise.all([
    repository.billingAggregates(db, period.periodStart, today),
    repository.listCycles(db, 6),
  ]);

  return {
    currentPeriod: {
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      label: period.label,
    },
    invoicesThisPeriod: aggregates.invoicesThisPeriod,
    billedThisPeriodCentavos: aggregates.billedThisPeriodCentavos,
    openInvoices: aggregates.openInvoices,
    outstandingCentavos: aggregates.outstandingCentavos,
    overdueInvoices: aggregates.overdueInvoices,
    overdueCentavos: aggregates.overdueCentavos,
    draftInvoices: aggregates.draftInvoices,
    lastCycles: cycles.map(toCycleSummary),
  };
}
