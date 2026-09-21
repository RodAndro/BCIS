import { type BusinessDate, centavos } from '@bcis/shared';
import { describe, expect, it } from 'vitest';

import {
  type AllocatableInvoice,
  AllocationError,
  allocateAsDirected,
  allocateOldestFirst,
  assertAllocationsWithinBalances,
  compareInvoicePriority,
} from './allocation';

function invoice(
  invoiceId: number,
  invoiceNumber: string,
  dueDate: BusinessDate,
  balance: number,
): AllocatableInvoice {
  return { invoiceId, invoiceNumber, dueDate, balance: centavos(balance) };
}

describe('allocation: oldest first (AT-04)', () => {
  it('settles August in full and partially settles September', () => {
    const august = invoice(1, 'INV-1001', '2026-08-31', 99_900);
    const september = invoice(2, 'INV-1002', '2026-09-30', 99_900);

    const result = allocateOldestFirst(centavos(120_000), [september, august]);

    expect(result.allocations).toEqual([
      { invoiceId: 1, invoiceNumber: 'INV-1001', amount: 99_900 },
      { invoiceId: 2, invoiceNumber: 'INV-1002', amount: 20_100 },
    ]);
    expect(result.applied).toBe(120_000);
    expect(result.unapplied).toBe(0);

    // September's remaining balance is the figure the specification names.
    expect(september.balance - result.allocations[1]!.amount).toBe(79_800);
  });

  it('ignores the order the caller supplies', () => {
    const oldest = invoice(1, 'INV-1', '2026-01-31', 10_000);
    const newest = invoice(2, 'INV-2', '2026-02-28', 10_000);

    const forwards = allocateOldestFirst(centavos(15_000), [oldest, newest]);
    const backwards = allocateOldestFirst(centavos(15_000), [newest, oldest]);

    expect(forwards.allocations).toEqual(backwards.allocations);
  });

  it('breaks a due-date tie by invoice id so results are reproducible', () => {
    const first = invoice(10, 'INV-A', '2026-09-30', 5_000);
    const second = invoice(11, 'INV-B', '2026-09-30', 5_000);

    const result = allocateOldestFirst(centavos(7_000), [second, first]);

    expect(result.allocations.map((line) => line.invoiceId)).toEqual([10, 11]);
    expect(result.allocations[1]!.amount).toBe(2_000);
  });

  it('skips invoices that are already settled', () => {
    const settled = invoice(1, 'INV-1', '2026-01-31', 0);
    const open = invoice(2, 'INV-2', '2026-02-28', 5_000);

    const result = allocateOldestFirst(centavos(5_000), [settled, open]);

    expect(result.allocations).toEqual([{ invoiceId: 2, invoiceNumber: 'INV-2', amount: 5_000 }]);
  });

  it('allocates nothing when there are no open invoices', () => {
    const result = allocateOldestFirst(centavos(5_000), []);

    expect(result.allocations).toEqual([]);
    expect(result.applied).toBe(0);
    expect(result.unapplied).toBe(5_000);
  });
});

describe('allocation: advance payment (AT-03)', () => {
  it('keeps the excess as unapplied credit rather than forcing it onto an invoice', () => {
    const september = invoice(1, 'INV-1001', '2026-09-30', 100_000);

    const result = allocateOldestFirst(centavos(300_000), [september]);

    expect(result.applied).toBe(100_000);
    expect(result.unapplied).toBe(200_000);
    expect(result.allocations).toHaveLength(1);
  });
});

describe('allocation: exact and partial payment', () => {
  it('settles to exactly zero on an exact payment (AT-01)', () => {
    const target = invoice(1, 'INV-1001', '2026-09-30', 99_900);

    const result = allocateOldestFirst(centavos(99_900), [target]);

    expect(result.allocations[0]!.amount).toBe(99_900);
    expect(result.unapplied).toBe(0);
    expect(target.balance - result.applied).toBe(0);
  });

  it('leaves the remainder on a partial payment (AT-02)', () => {
    const target = invoice(1, 'INV-1001', '2026-09-30', 99_900);

    const result = allocateOldestFirst(centavos(50_000), [target]);

    expect(result.applied).toBe(50_000);
    expect(result.unapplied).toBe(0);
    expect(target.balance - result.applied).toBe(49_900);
  });

  it('never allocates more in total than the payment', () => {
    const invoices = [
      invoice(1, 'INV-1', '2026-01-31', 10_000),
      invoice(2, 'INV-2', '2026-02-28', 10_000),
      invoice(3, 'INV-3', '2026-03-31', 10_000),
    ];

    for (const amount of [0, 1, 9_999, 10_000, 15_000, 30_000, 45_000]) {
      const result = allocateOldestFirst(centavos(amount), invoices);
      const total = result.allocations.reduce((sum, line) => sum + line.amount, 0);

      expect(total).toBe(result.applied);
      expect(result.applied + result.unapplied).toBe(amount);
      expect(total).toBeLessThanOrEqual(amount);
    }
  });

  it('never allocates more than an individual invoice balance', () => {
    const invoices = [invoice(1, 'INV-1', '2026-01-31', 5_000)];
    const result = allocateOldestFirst(centavos(1_000_000), invoices);

    expect(result.allocations[0]!.amount).toBe(5_000);
    expect(result.unapplied).toBe(995_000);
  });
});

describe('allocation: manual (authorized) allocation', () => {
  it('honours the caller-supplied order', () => {
    const january = invoice(1, 'INV-1', '2026-01-31', 10_000);
    const february = invoice(2, 'INV-2', '2026-02-28', 10_000);

    const result = allocateAsDirected(centavos(10_000), [
      { invoice: february, amount: centavos(10_000) },
    ]);

    expect(result.allocations).toEqual([{ invoiceId: 2, invoiceNumber: 'INV-2', amount: 10_000 }]);
    expect(result.unapplied).toBe(0);
    expect(january.balance).toBe(10_000);
  });

  it('rejects allocation beyond an invoice balance', () => {
    const target = invoice(1, 'INV-1', '2026-01-31', 5_000);

    expect(() =>
      allocateAsDirected(centavos(10_000), [{ invoice: target, amount: centavos(6_000) }]),
    ).toThrow(AllocationError);
  });

  it('rejects the same invoice twice', () => {
    const target = invoice(1, 'INV-1', '2026-01-31', 10_000);

    expect(() =>
      allocateAsDirected(centavos(10_000), [
        { invoice: target, amount: centavos(5_000) },
        { invoice: target, amount: centavos(5_000) },
      ]),
    ).toThrow(/more than once/i);
  });

  it('rejects a total that exceeds the payment', () => {
    const first = invoice(1, 'INV-1', '2026-01-31', 10_000);
    const second = invoice(2, 'INV-2', '2026-02-28', 10_000);

    expect(() =>
      allocateAsDirected(centavos(5_000), [
        { invoice: first, amount: centavos(5_000) },
        { invoice: second, amount: centavos(1) },
      ]),
    ).toThrow(/exceeds the payment/i);
  });
});

describe('allocation: over-settlement guard', () => {
  it('allows allocating up to the balance when nothing is allocated yet', () => {
    expect(() =>
      assertAllocationsWithinBalances(
        new Map(),
        [{ invoiceId: 1, invoiceNumber: 'INV-1', amount: centavos(5_000) }],
        new Map([[1, centavos(5_000)]]),
      ),
    ).not.toThrow();
  });

  it('rejects a total that would exceed the balance across several allocations', () => {
    expect(() =>
      assertAllocationsWithinBalances(
        new Map([[1, centavos(4_000)]]),
        [{ invoiceId: 1, invoiceNumber: 'INV-1', amount: centavos(1_001) }],
        new Map([[1, centavos(5_000)]]),
      ),
    ).toThrow(/exceed its balance/i);
  });

  it('detects two lines on one invoice that individually pass but together overshoot', () => {
    expect(() =>
      assertAllocationsWithinBalances(
        new Map(),
        [
          { invoiceId: 1, invoiceNumber: 'INV-1', amount: centavos(3_000) },
          { invoiceId: 1, invoiceNumber: 'INV-1', amount: centavos(3_000) },
        ],
        new Map([[1, centavos(5_000)]]),
      ),
    ).toThrow(/exceed its balance/i);
  });
});

describe('allocation: priority ordering', () => {
  it('orders by due date then id', () => {
    const invoices = [
      invoice(3, 'C', '2026-03-31', 1),
      invoice(1, 'A', '2026-01-31', 1),
      invoice(2, 'B', '2026-01-31', 1),
    ];

    const ordered = [...invoices].sort(compareInvoicePriority);

    expect(ordered.map((item) => item.invoiceNumber)).toEqual(['A', 'B', 'C']);
  });
});
