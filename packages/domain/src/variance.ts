import { type Centavos, type SignedCentavos, centavos, subtractCentavos } from '@bcis/shared';

/**
 * Collector remittance variance.
 *
 * ── THE RULE (§12, AT-07, AT-08) ────────────────────────────────────────────
 * A collector collects cash on a route, then remits it to the office. The two
 * figures should match. When they do not, the system must record the
 * difference explicitly rather than treat the batch as balanced.
 *
 *   Cash collected  ₱20,000.00
 *   Cash remitted   ₱19,500.00
 *   Shortage           ₱500.00
 *
 * ── SIGN CONVENTION ─────────────────────────────────────────────────────────
 * `variance` is `cashCollected - cashRemitted`. A POSITIVE variance is a
 * SHORTAGE — the collector holds money the company has not received. A
 * negative variance is an OVERAGE. Getting this backwards would report every
 * honest shortage as an overage, so the convention is asserted by tests.
 *
 * ── WHY NON-CASH IS EXCLUDED ────────────────────────────────────────────────
 * `nonCashCollected` is tracked separately and excluded from this calculation.
 * A customer paying a collector by GCash means the money went directly to the
 * company account; the collector never held it, so including it would make
 * every such collector appear short.
 */

export type VarianceType = 'BALANCED' | 'SHORTAGE' | 'OVERAGE';

export interface RemittanceVariance {
  readonly cashCollected: Centavos;
  readonly cashRemitted: Centavos;
  /** `cashCollected - cashRemitted`. Positive means the collector owes the company. */
  readonly variance: SignedCentavos;
  readonly type: VarianceType;
}

export function computeRemittanceVariance(
  cashCollected: Centavos,
  cashRemitted: Centavos,
): RemittanceVariance {
  const variance = subtractCentavos(cashCollected, cashRemitted);

  return {
    cashCollected,
    cashRemitted,
    variance,
    type: variance === 0 ? 'BALANCED' : variance > 0 ? 'SHORTAGE' : 'OVERAGE',
  };
}

export interface BatchTotalsInput {
  readonly expectedReceivable: Centavos;
  readonly cashCollected: Centavos;
  readonly nonCashCollected: Centavos;
}

export interface BatchTotals {
  readonly expectedReceivable: Centavos;
  readonly cashCollected: Centavos;
  readonly nonCashCollected: Centavos;
  readonly totalCollected: Centavos;
  /**
   * Expected less actually collected, floored at zero.
   *
   * Floored because a negative "uncollected" is meaningless — collecting more
   * than expected is an overage on the remittance, not negative work on the
   * route, and the two should not be conflated in a report.
   */
  readonly uncollected: Centavos;
}

export function computeBatchTotals(input: BatchTotalsInput): BatchTotals {
  const totalCollected = centavos(input.cashCollected + input.nonCashCollected);
  const difference = input.expectedReceivable - totalCollected;

  return {
    expectedReceivable: input.expectedReceivable,
    cashCollected: input.cashCollected,
    nonCashCollected: input.nonCashCollected,
    totalCollected,
    uncollected: centavos(difference > 0 ? difference : 0),
  };
}

/**
 * Whether a batch may be closed.
 *
 * A batch with a variance cannot be closed silently: §12 requires a recorded
 * reason and an approver. This returns what is missing so the API can answer
 * with a precise error instead of a generic rejection.
 */
export function remittanceCloseBlockers(variance: RemittanceVariance): readonly string[] {
  const blockers: string[] = [];

  if (variance.type !== 'BALANCED') {
    blockers.push(
      `Remittance has a ${variance.type.toLowerCase()} that must be resolved or approved.`,
    );
  }

  return blockers;
}
