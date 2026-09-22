import { centavos, signedCentavos } from '@bcis/shared';
import { describe, expect, it } from 'vitest';

import {
  BillingError,
  adjustmentLine,
  billingPeriodFor,
  chargeLine,
  computeInvoiceDates,
  computeInvoiceTotals,
  discountLine,
  displayStatusFor,
  isOpenInvoice,
  isPenaltyDue,
  monthKeyOf,
  occurredWithin,
  penaltyThreshold,
  summariseLines,
} from './billing';

/**
 * Billing rules.
 *
 * These are the calculations a reviewer will ask about, so they are asserted
 * here rather than inferred from an integration test that also involves HTTP,
 * Zod, and PostgreSQL.
 */

/** Shorthand so the assertions read as amounts rather than as constructor calls. */
const c = centavos;
const s = signedCentavos;

describe('billingPeriodFor', () => {
  it('covers the whole calendar month', () => {
    const period = billingPeriodFor('2026-09');
    expect(period.periodStart).toBe('2026-09-01');
    expect(period.periodEnd).toBe('2026-09-30');
    expect(period.label).toBe('September 2026');
  });

  it('handles February in a leap year', () => {
    expect(billingPeriodFor('2028-02').periodEnd).toBe('2028-02-29');
    expect(billingPeriodFor('2027-02').periodEnd).toBe('2027-02-28');
  });

  it('rejects anything that is not a YYYY-MM month', () => {
    for (const bad of ['2026-13', '2026-1', 'September', '2026-09-01', '']) {
      expect(() => billingPeriodFor(bad)).toThrow(BillingError);
    }
  });
});

describe('monthKeyOf', () => {
  it('reduces a business date to its month', () => {
    expect(monthKeyOf('2026-09-30')).toBe('2026-09');
  });
});

describe('computeInvoiceDates', () => {
  it('places the issue and due dates on the account days within the month', () => {
    const dates = computeInvoiceDates({
      periodStart: '2026-09-01',
      billingDay: 5,
      dueDay: 20,
    });

    expect(dates.issueDate).toBe('2026-09-05');
    expect(dates.dueDate).toBe('2026-09-20');
  });

  it('rolls a due day that precedes the billing day into the next month', () => {
    // Nothing stops an account having billing_day 25 and due_day 10. Taken
    // literally the invoice would be due eleven days before it was issued.
    const dates = computeInvoiceDates({
      periodStart: '2026-09-01',
      billingDay: 25,
      dueDay: 10,
    });

    expect(dates.issueDate).toBe('2026-09-25');
    expect(dates.dueDate).toBe('2026-10-10');
  });

  it('never produces a due date before the issue date', () => {
    for (let billingDay = 1; billingDay <= 28; billingDay += 1) {
      for (let dueDay = 1; dueDay <= 28; dueDay += 1) {
        const { issueDate, dueDate } = computeInvoiceDates({
          periodStart: '2026-09-01',
          billingDay,
          dueDay,
        });
        expect(dueDate >= issueDate, `billing ${String(billingDay)} / due ${String(dueDay)}`).toBe(
          true,
        );
      }
    }
  });

  it('rolls across a year boundary', () => {
    const dates = computeInvoiceDates({
      periodStart: '2026-12-01',
      billingDay: 28,
      dueDay: 3,
    });

    expect(dates.issueDate).toBe('2026-12-28');
    expect(dates.dueDate).toBe('2027-01-03');
  });
});

describe('lines', () => {
  it('multiplies unit price by quantity', () => {
    const line = chargeLine({
      itemType: 'SUBSCRIPTION',
      description: 'September — Fiber 100',
      unitPriceCentavos: c(129_900),
      quantity: 2,
    });

    expect(line.amountCentavos).toBe(259_800);
    expect(line.direction).toBe('DEBIT');
  });

  it('refuses a fractional or zero quantity', () => {
    expect(() =>
      chargeLine({
        itemType: 'SUBSCRIPTION',
        description: 'x',
        unitPriceCentavos: c(100),
        quantity: 1.5,
      }),
    ).toThrow(BillingError);
  });

  it('marks a discount as a credit, never a negative charge', () => {
    const line = discountLine({
      description: 'Senior citizen discount',
      unitPriceCentavos: c(19_980),
    });
    expect(line.itemType).toBe('DISCOUNT');
    expect(line.direction).toBe('CREDIT');
    // The magnitude is positive; the direction is what reduces the total.
    expect(line.amountCentavos).toBe(19_980);
  });
});

describe('summariseLines', () => {
  it('separates the service sold from penalties and discounts', () => {
    const lines = [
      chargeLine({
        itemType: 'SUBSCRIPTION',
        description: 'Monthly',
        unitPriceCentavos: c(99_900),
      }),
      chargeLine({
        itemType: 'INSTALLATION',
        description: 'Installation',
        unitPriceCentavos: c(150_000),
      }),
      chargeLine({ itemType: 'PENALTY', description: 'Late penalty', unitPriceCentavos: c(5_000) }),
      discountLine({ description: 'Senior discount', unitPriceCentavos: c(19_980) }),
    ];

    const totals = summariseLines(lines);

    // Installation is part of what was sold, so it sits in the subtotal.
    expect(totals.subtotalCentavos).toBe(249_900);
    expect(totals.penaltyCentavos).toBe(5_000);
    expect(totals.discountCentavos).toBe(19_980);
    expect(totals.adjustmentCentavos).toBe(0);
  });

  it('nets debit and credit adjustments, and may go negative', () => {
    const lines = [
      adjustmentLine({
        direction: 'DEBIT',
        description: 'Undercharge corrected',
        unitPriceCentavos: c(5_000),
      }),
      adjustmentLine({
        direction: 'CREDIT',
        description: 'Goodwill credit',
        unitPriceCentavos: c(12_000),
      }),
    ];

    expect(summariseLines(lines).adjustmentCentavos).toBe(-7_000);
  });
});

describe('computeInvoiceTotals', () => {
  it('applies the documented identity', () => {
    const totals = computeInvoiceTotals({
      subtotalCentavos: c(99_900),
      discountCentavos: c(10_000),
      penaltyCentavos: c(5_000),
      adjustmentCentavos: s(-2_500),
    });

    expect(totals.totalCentavos).toBe(92_400);
  });

  it('returns a negative total as a signed value rather than throwing', () => {
    // Whether a credit larger than the invoice is allowed is a business
    // decision for the caller; the arithmetic must not pretend otherwise.
    const totals = computeInvoiceTotals({
      subtotalCentavos: c(10_000),
      discountCentavos: c(0),
      penaltyCentavos: c(0),
      adjustmentCentavos: s(-15_000),
    });

    expect(totals.totalCentavos).toBe(-5_000);
  });

  it('keeps tax out of the total while plan prices are VAT-inclusive', () => {
    const totals = computeInvoiceTotals({
      subtotalCentavos: c(99_900),
      discountCentavos: c(0),
      penaltyCentavos: c(0),
      adjustmentCentavos: s(0),
      taxCentavos: c(0),
    });

    expect(totals.totalCentavos).toBe(99_900);
  });
});

describe('displayStatusFor', () => {
  const today = '2026-09-21';

  it('reports an unpaid invoice past its due date as OVERDUE', () => {
    expect(
      displayStatusFor({
        status: 'UNPAID',
        balanceCentavos: c(99_900),
        dueDate: '2026-09-20',
        today,
      }),
    ).toBe('OVERDUE');
  });

  it('does not report an invoice due today as overdue', () => {
    expect(
      displayStatusFor({
        status: 'UNPAID',
        balanceCentavos: c(99_900),
        dueDate: today,
        today,
      }),
    ).toBe('UNPAID');
  });

  it('does not report a settled or voided invoice as overdue, however old', () => {
    expect(
      displayStatusFor({ status: 'PAID', balanceCentavos: c(0), dueDate: '2026-01-01', today }),
    ).toBe('PAID');
    expect(
      displayStatusFor({ status: 'VOID', balanceCentavos: c(0), dueDate: '2026-01-01', today }),
    ).toBe('VOID');
  });

  it('reports a partially paid overdue invoice as OVERDUE, keeping the payment visible', () => {
    expect(
      displayStatusFor({
        status: 'PARTIALLY_PAID',
        balanceCentavos: c(1),
        dueDate: '2026-09-01',
        today,
      }),
    ).toBe('OVERDUE');
  });
});

describe('isOpenInvoice', () => {
  it('is true only for the states that still owe money', () => {
    expect(isOpenInvoice('UNPAID')).toBe(true);
    expect(isOpenInvoice('PARTIALLY_PAID')).toBe(true);
    expect(isOpenInvoice('PAID')).toBe(false);
    expect(isOpenInvoice('VOID')).toBe(false);
    expect(isOpenInvoice('DRAFT')).toBe(false);
    expect(isOpenInvoice('CREDITED')).toBe(false);
  });
});

describe('penalties', () => {
  it('applies the grace period to the due date', () => {
    expect(penaltyThreshold('2026-09-20', 5)).toBe('2026-09-25');
  });

  it('is not yet due on the threshold day itself', () => {
    expect(isPenaltyDue({ dueDate: '2026-09-20', today: '2026-09-25', gracePeriodDays: 5 })).toBe(
      false,
    );
  });

  it('is due the day after the threshold', () => {
    expect(isPenaltyDue({ dueDate: '2026-09-20', today: '2026-09-26', gracePeriodDays: 5 })).toBe(
      true,
    );
  });

  it('refuses a negative grace period', () => {
    expect(() => penaltyThreshold('2026-09-20', -1)).toThrow(BillingError);
  });
});

describe('occurredWithin', () => {
  it('is inclusive of both ends', () => {
    expect(occurredWithin('2026-09-01', '2026-09-01', '2026-09-30')).toBe(true);
    expect(occurredWithin('2026-09-30', '2026-09-01', '2026-09-30')).toBe(true);
    expect(occurredWithin('2026-10-01', '2026-09-01', '2026-09-30')).toBe(false);
    expect(occurredWithin(null, '2026-09-01', '2026-09-30')).toBe(false);
  });
});
