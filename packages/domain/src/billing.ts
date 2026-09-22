import {
  type BusinessDate,
  type Centavos,
  type DisplayInvoiceStatus,
  type SignedCentavos,
  type StoredInvoiceStatus,
  DISPLAY_INVOICE_STATUSES,
  STORED_INVOICE_STATUSES,
  ZERO,
  addBusinessDays,
  addBusinessMonths,
  businessMonthPeriod,
  centavos,
  formatBusinessMonthLabel,
  signedCentavos,
} from '@bcis/shared';

/**
 * Billing rules.
 *
 * ── WHY THIS IS A PURE MODULE ───────────────────────────────────────────────
 * These are the calculations a defense will be asked to justify: what period an
 * invoice covers, when it is issued and due, what it adds up to. None of it
 * needs a database, a framework, or a `Date.now()`, so all of it is unit-tested
 * directly and none of it can hide inside a React component or a SQL string.
 *
 * The API's billing service and the demo seed both call these functions, so the
 * invoices the seed writes and the invoices the generator writes are computed
 * the same way. Two implementations of "what does this month cost" is exactly
 * how a demo dataset and a production run come to disagree.
 *
 * Every amount is an integer number of centavos. `Centavos` is non-negative;
 * `SignedCentavos` is used only where a value may legitimately be negative (the
 * net of debit and credit adjustments).
 */

export class BillingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BillingError';
  }
}

export interface BillingPeriod {
  readonly periodStart: BusinessDate;
  readonly periodEnd: BusinessDate;
  /** Human label, e.g. `September 2026`. */
  readonly label: string;
}

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * The calendar month a `YYYY-MM` string names.
 *
 * ── DECISION A2 ─────────────────────────────────────────────────────────────
 * A billing period is a CALENDAR MONTH. The subscriber's `billing_day` and
 * `due_day` position the document within that month; they do not move the
 * period. This is the roadmap's working assumption, and it is what makes the
 * duplicate-billing key `(service_account_id, billing_period_start)` trivially
 * correct rather than dependent on where a cycle happens to have started.
 */
export function billingPeriodFor(month: string): BillingPeriod {
  if (!MONTH_PATTERN.test(month)) {
    throw new BillingError(`"${month}" is not a billing month in YYYY-MM form.`);
  }

  const firstDay = `${month}-01`;
  const { periodStart, periodEnd } = businessMonthPeriod(firstDay);

  return { periodStart, periodEnd, label: formatBusinessMonthLabel(firstDay) };
}

/** The `YYYY-MM` a business date falls in. */
export function monthKeyOf(date: BusinessDate): string {
  return date.slice(0, 7);
}

/** `2026-09-01` + day 8 → `2026-09-08`. Days are 1–28, so they always exist. */
function dayWithinMonth(monthStart: BusinessDate, day: number): BusinessDate {
  const [year, month] = monthStart.split('-');
  if (year === undefined || month === undefined) {
    throw new BillingError(`"${monthStart}" is not a date in YYYY-MM-DD form.`);
  }
  return `${year}-${month}-${String(day).padStart(2, '0')}`;
}

export interface InvoiceDates {
  readonly issueDate: BusinessDate;
  readonly dueDate: BusinessDate;
}

/**
 * When an invoice for `periodStart`'s month is issued and due.
 *
 * ── THE ROLL-FORWARD GUARD ──────────────────────────────────────────────────
 * Both days come from the service account and are constrained to 1–28. Nothing
 * stops an account from having `billing_day = 25` and `due_day = 10`, and taking
 * those literally would produce an invoice due eleven days BEFORE it was issued.
 * When that happens the due date moves into the following month, which is what
 * the customer would actually be told.
 */
export function computeInvoiceDates(input: {
  readonly periodStart: BusinessDate;
  readonly billingDay: number;
  readonly dueDay: number;
}): InvoiceDates {
  const issueDate = dayWithinMonth(input.periodStart, input.billingDay);
  let dueDate = dayWithinMonth(input.periodStart, input.dueDay);

  if (dueDate < issueDate) {
    dueDate = dayWithinMonth(addBusinessMonths(input.periodStart, 1), input.dueDay);
  }

  return { issueDate, dueDate };
}

export type InvoiceItemType =
  'SUBSCRIPTION' | 'INSTALLATION' | 'RECONNECTION' | 'DISCOUNT' | 'PENALTY' | 'ADJUSTMENT';

/** Which side of the total a line sits on. */
export type InvoiceItemDirection = 'DEBIT' | 'CREDIT';

/**
 * A prospective invoice line.
 *
 * ── WHY `direction` IS SEPARATE FROM THE TYPE ───────────────────────────────
 * `amountCentavos` is always a POSITIVE magnitude and the direction says which
 * way it moves the total. That keeps one rule — "amounts are never negative" —
 * true for every line, so a credit cannot be smuggled in as a negative charge
 * and a sum of lines is always a sum of the same kind of thing.
 *
 * A DISCOUNT is a CREDIT; a subscription charge is a DEBIT; an ADJUSTMENT is
 * either, which is the only type where the direction is genuinely open.
 */
export interface InvoiceLine {
  readonly itemType: InvoiceItemType;
  readonly direction: InvoiceItemDirection;
  readonly description: string;
  readonly quantity: number;
  readonly unitPriceCentavos: Centavos;
  /** `unitPriceCentavos * quantity`, as a positive magnitude. */
  readonly amountCentavos: Centavos;
}

function buildLine(
  itemType: InvoiceItemType,
  direction: InvoiceItemDirection,
  description: string,
  unitPriceCentavos: Centavos,
  quantity: number,
): InvoiceLine {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new BillingError(
      `Quantity must be a whole number of at least 1, received ${String(quantity)}.`,
    );
  }

  return {
    itemType,
    direction,
    description,
    quantity,
    unitPriceCentavos,
    amountCentavos: centavos(unitPriceCentavos * quantity),
  };
}

/** A charge that increases what is owed. */
export function chargeLine(input: {
  readonly itemType: Exclude<InvoiceItemType, 'DISCOUNT' | 'ADJUSTMENT'>;
  readonly description: string;
  readonly unitPriceCentavos: Centavos;
  readonly quantity?: number;
}): InvoiceLine {
  return buildLine(
    input.itemType,
    'DEBIT',
    input.description,
    input.unitPriceCentavos,
    input.quantity ?? 1,
  );
}

/** A discount, which reduces what is owed. */
export function discountLine(input: {
  readonly description: string;
  readonly unitPriceCentavos: Centavos;
  readonly quantity?: number;
}): InvoiceLine {
  return buildLine(
    'DISCOUNT',
    'CREDIT',
    input.description,
    input.unitPriceCentavos,
    input.quantity ?? 1,
  );
}

/** An adjustment, on whichever side the caller names. */
export function adjustmentLine(input: {
  readonly direction: InvoiceItemDirection;
  readonly description: string;
  readonly unitPriceCentavos: Centavos;
}): InvoiceLine {
  return buildLine('ADJUSTMENT', input.direction, input.description, input.unitPriceCentavos, 1);
}

export interface LineTotals {
  readonly subtotalCentavos: Centavos;
  readonly discountCentavos: Centavos;
  readonly penaltyCentavos: Centavos;
  /** DEBIT adjustments less CREDIT adjustments. May be negative. */
  readonly adjustmentCentavos: SignedCentavos;
}

/**
 * Fold a set of lines into the invoice's component totals.
 *
 * SUBSCRIPTION, INSTALLATION and RECONNECTION together are the *subtotal* —
 * they are the service being sold. PENALTY and DISCOUNT are reported separately
 * because a statement shows them separately, and because a report that cannot
 * tell a penalty from a subscription is not useful.
 */
export function summariseLines(lines: readonly InvoiceLine[]): LineTotals {
  let subtotal = 0;
  let discount = 0;
  let penalty = 0;
  let adjustment = 0;

  for (const line of lines) {
    switch (line.itemType) {
      case 'SUBSCRIPTION':
      case 'INSTALLATION':
      case 'RECONNECTION':
        subtotal += line.amountCentavos;
        break;
      case 'DISCOUNT':
        discount += line.amountCentavos;
        break;
      case 'PENALTY':
        penalty += line.amountCentavos;
        break;
      case 'ADJUSTMENT':
        adjustment += line.direction === 'DEBIT' ? line.amountCentavos : -line.amountCentavos;
        break;
    }
  }

  return {
    subtotalCentavos: centavos(subtotal),
    discountCentavos: centavos(discount),
    penaltyCentavos: centavos(penalty),
    adjustmentCentavos: signedCentavos(adjustment),
  };
}

export interface InvoiceTotals extends LineTotals {
  readonly taxCentavos: Centavos;
  /**
   * The signed sum. A well-formed invoice is non-negative; the caller decides
   * what to do when it is not, because "this credit exceeds the invoice" is a
   * business answer, not an arithmetic one.
   */
  readonly totalCentavos: SignedCentavos;
}

/**
 * The invoice total, from its parts.
 *
 * ── DECISION A1 ─────────────────────────────────────────────────────────────
 * Plan prices are treated as VAT-INCLUSIVE, so `taxCentavos` is a breakdown
 * figure that does not change the total. It is passed in as 0 until the VAT
 * treatment is confirmed; the column exists so confirming it is a service
 * change rather than a migration.
 *
 * The database asserts this same identity as a CHECK constraint, so a row whose
 * total disagrees with its parts cannot be written even by a buggy caller.
 */
export function computeInvoiceTotals(parts: {
  readonly subtotalCentavos: Centavos;
  readonly discountCentavos: Centavos;
  readonly penaltyCentavos: Centavos;
  readonly adjustmentCentavos: SignedCentavos;
  readonly taxCentavos?: Centavos;
}): InvoiceTotals {
  const taxCentavos = parts.taxCentavos ?? ZERO;

  return {
    subtotalCentavos: parts.subtotalCentavos,
    discountCentavos: parts.discountCentavos,
    penaltyCentavos: parts.penaltyCentavos,
    adjustmentCentavos: parts.adjustmentCentavos,
    taxCentavos,
    totalCentavos: signedCentavos(
      parts.subtotalCentavos -
        parts.discountCentavos +
        parts.penaltyCentavos +
        parts.adjustmentCentavos +
        taxCentavos,
    ),
  };
}

/**
 * The stored lifecycle and its derived extension.
 *
 * Defined in `@bcis/shared` because the Zod schemas and the SQL CHECK
 * constraint are written against the same list; re-exported here so a caller
 * working in the billing rules does not need a second import.
 */
export { DISPLAY_INVOICE_STATUSES, STORED_INVOICE_STATUSES };
export type { DisplayInvoiceStatus, StoredInvoiceStatus };

export function displayStatusFor(input: {
  readonly status: StoredInvoiceStatus;
  readonly balanceCentavos: Centavos | SignedCentavos;
  readonly dueDate: BusinessDate;
  readonly today: BusinessDate;
}): DisplayInvoiceStatus {
  const open = input.status === 'UNPAID' || input.status === 'PARTIALLY_PAID';
  if (!open) return input.status;

  if (input.balanceCentavos > 0 && input.dueDate < input.today) return 'OVERDUE';
  return input.status;
}

/** Whether an invoice is open — has a balance and has not been voided. */
export function isOpenInvoice(status: StoredInvoiceStatus): boolean {
  return status === 'UNPAID' || status === 'PARTIALLY_PAID';
}

/** Whether a date falls inside a billing period, inclusive. */
export function occurredWithin(
  date: BusinessDate | null,
  periodStart: BusinessDate,
  periodEnd: BusinessDate,
): boolean {
  if (date === null) return false;
  return date >= periodStart && date <= periodEnd;
}

/**
 * The day a penalty may first be applied: the due date plus the grace period.
 *
 * The grace period is a setting, not a constant, because it is a commercial
 * decision. A penalty is applied once at this threshold and never compounds
 * (decision A4) — compounding penalties turn a billing system into a debt
 * collector, which is not what this is.
 */
export function penaltyThreshold(dueDate: BusinessDate, gracePeriodDays: number): BusinessDate {
  if (!Number.isInteger(gracePeriodDays) || gracePeriodDays < 0) {
    throw new BillingError(`Grace period must be a whole, non-negative number of days.`);
  }
  return addBusinessDays(dueDate, gracePeriodDays);
}

/** A penalty is due once the threshold has passed and the invoice is still open. */
export function isPenaltyDue(input: {
  readonly dueDate: BusinessDate;
  readonly today: BusinessDate;
  readonly gracePeriodDays: number;
}): boolean {
  return input.today > penaltyThreshold(input.dueDate, input.gracePeriodDays);
}
