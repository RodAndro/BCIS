import { type BusinessDate, type Centavos, centavos, minCentavos } from '@bcis/shared';

/**
 * Payment allocation.
 *
 * This module is PURE: no database, no HTTP, no framework imports. That is
 * deliberate — allocation is the rule most likely to be questioned during a
 * defense, and it should be readable, and testable, in isolation.
 *
 * ── THE RULE (§10) ──────────────────────────────────────────────────────────
 * A payment settles the OLDEST UNPAID INVOICE FIRST. Any amount left after
 * every invoice is settled becomes unapplied credit on the service account
 * rather than being discarded or forced onto an arbitrary invoice.
 *
 * Worked example (AT-04):
 *   August invoice   ₱999.00
 *   September invoice ₱999.00
 *   Payment          ₱1,200.00
 *
 *   August settles in full      ₱999.00
 *   September receives          ₱201.00  -> balance ₱798.00
 *   Unapplied credit            ₱0.00
 *
 * ── WHY THE ORDER IS DETERMINISTIC ──────────────────────────────────────────
 * Invoices are ordered by due date, then by id. The id tiebreak matters: two
 * invoices sharing a due date would otherwise allocate in whatever order the
 * database happened to return rows, so the same payment could produce
 * different results on different runs. That is unacceptable in a ledger.
 */

export interface AllocatableInvoice {
  readonly invoiceId: number;
  readonly invoiceNumber: string;
  readonly dueDate: BusinessDate;
  /** Outstanding balance. A settled invoice has a balance of zero. */
  readonly balance: Centavos;
}

export interface AllocationLine {
  readonly invoiceId: number;
  readonly invoiceNumber: string;
  readonly amount: Centavos;
}

export interface AllocationResult {
  readonly allocations: readonly AllocationLine[];
  /** Total applied to invoices. */
  readonly applied: Centavos;
  /** Remainder held as unapplied credit on the account (ADR: advance payments). */
  readonly unapplied: Centavos;
}

export class AllocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AllocationError';
  }
}

/**
 * Oldest-first ordering. Exported so screens and reports can present invoices
 * in the same order the allocator will consume them.
 */
export function compareInvoicePriority(
  left: AllocatableInvoice,
  right: AllocatableInvoice,
): number {
  if (left.dueDate < right.dueDate) return -1;
  if (left.dueDate > right.dueDate) return 1;
  if (left.invoiceId < right.invoiceId) return -1;
  if (left.invoiceId > right.invoiceId) return 1;
  return 0;
}

/**
 * Allocate `paymentAmount` across `invoices`, oldest due date first.
 *
 * Never allocates more than an invoice's outstanding balance, and never
 * allocates more in total than the payment. Anything left over is returned as
 * `unapplied`.
 */
export function allocateOldestFirst(
  paymentAmount: Centavos,
  invoices: readonly AllocatableInvoice[],
): AllocationResult {
  const allocations: AllocationLine[] = [];
  let remaining = paymentAmount;

  for (const invoice of [...invoices].sort(compareInvoicePriority)) {
    if (remaining === 0) break;

    // A fully settled invoice is skipped rather than allocated a zero line, so
    // the allocation table records only real settlements.
    if (invoice.balance === 0) continue;

    const amount = minCentavos(remaining, invoice.balance);
    allocations.push({
      invoiceId: invoice.invoiceId,
      invoiceNumber: invoice.invoiceNumber,
      amount,
    });

    remaining = centavos(remaining - amount);
  }

  return {
    allocations,
    applied: centavos(paymentAmount - remaining),
    unapplied: remaining,
  };
}

/**
 * Allocate to explicitly chosen invoices, for the authorized manual allocation
 * workflow (§10). The caller supplies the order; this function enforces the
 * limits that cannot be waived.
 *
 * @throws AllocationError when a line exceeds its invoice balance, when an
 *         invoice appears twice, or when the lines exceed the payment.
 */
export function allocateAsDirected(
  paymentAmount: Centavos,
  lines: readonly { invoice: AllocatableInvoice; amount: Centavos }[],
): AllocationResult {
  const allocations: AllocationLine[] = [];
  const seen = new Set<number>();
  let remaining = paymentAmount;

  for (const line of lines) {
    const { invoice, amount } = line;

    if (amount === 0) continue;

    if (seen.has(invoice.invoiceId)) {
      throw new AllocationError(
        `Invoice ${invoice.invoiceNumber} appears more than once in this allocation.`,
      );
    }
    seen.add(invoice.invoiceId);

    if (amount > invoice.balance) {
      throw new AllocationError(
        `Cannot allocate more than the outstanding balance of ${invoice.invoiceNumber}.`,
      );
    }
    if (amount > remaining) {
      throw new AllocationError(
        `Allocation exceeds the payment amount. ${invoice.invoiceNumber} would overdraw it.`,
      );
    }

    allocations.push({
      invoiceId: invoice.invoiceId,
      invoiceNumber: invoice.invoiceNumber,
      amount,
    });
    remaining = centavos(remaining - amount);
  }

  return {
    allocations,
    applied: centavos(paymentAmount - remaining),
    unapplied: remaining,
  };
}

/**
 * Guard for the invariant that a set of allocations can never over-settle an
 * invoice. Called before writing allocation rows so a bug fails inside the
 * transaction rather than corrupting a balance.
 */
export function assertAllocationsWithinBalances(
  existingAllocated: ReadonlyMap<number, Centavos>,
  newLines: readonly AllocationLine[],
  balances: ReadonlyMap<number, Centavos>,
): void {
  const additions = new Map<number, Centavos>();

  for (const line of newLines) {
    additions.set(line.invoiceId, centavos((additions.get(line.invoiceId) ?? 0) + line.amount));
  }

  for (const [invoiceId, added] of additions) {
    const alreadyAllocated = existingAllocated.get(invoiceId) ?? centavos(0);
    const balance = balances.get(invoiceId);

    if (balance === undefined) {
      throw new AllocationError(
        `No invoice balance was supplied for invoice ${String(invoiceId)}.`,
      );
    }

    if (centavos(alreadyAllocated + added) > balance) {
      throw new AllocationError(
        `Allocating ${String(added)} centavos to invoice ${String(invoiceId)} would exceed its ` +
          `balance of ${String(balance)} centavos.`,
      );
    }
  }
}
