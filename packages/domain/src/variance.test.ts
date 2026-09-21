import { centavos } from '@bcis/shared';
import { describe, expect, it } from 'vitest';

import { computeBatchTotals, computeRemittanceVariance, remittanceCloseBlockers } from './variance';

describe('remittance variance (AT-07, AT-08)', () => {
  it('reports a balanced remittance as zero', () => {
    const result = computeRemittanceVariance(centavos(2_000_000), centavos(2_000_000));

    expect(result.variance).toBe(0);
    expect(result.type).toBe('BALANCED');
    expect(remittanceCloseBlockers(result)).toEqual([]);
  });

  it('reports a shortage as a positive variance', () => {
    // ₱20,000 collected, ₱19,500 remitted, ₱500 short.
    const result = computeRemittanceVariance(centavos(2_000_000), centavos(1_950_000));

    expect(result.variance).toBe(50_000);
    expect(result.type).toBe('SHORTAGE');
    expect(remittanceCloseBlockers(result)).toHaveLength(1);
  });

  it('reports an overage as a negative variance', () => {
    const result = computeRemittanceVariance(centavos(1_950_000), centavos(2_000_000));

    expect(result.variance).toBe(-50_000);
    expect(result.type).toBe('OVERAGE');
    expect(remittanceCloseBlockers(result)).toHaveLength(1);
  });

  it('treats a one-centavo difference as a real variance, not a rounding artifact', () => {
    const result = computeRemittanceVariance(centavos(2_000_000), centavos(1_999_999));

    expect(result.type).toBe('SHORTAGE');
    expect(result.variance).toBe(1);
  });

  it('blocks closing a batch that has a shortage', () => {
    const result = computeRemittanceVariance(centavos(2_000_000), centavos(1_950_000));
    const blockers = remittanceCloseBlockers(result);

    expect(blockers[0]).toMatch(/shortage/i);
  });
});

describe('batch totals', () => {
  it('keeps non-cash out of the cash figure', () => {
    const totals = computeBatchTotals({
      expectedReceivable: centavos(2_000_000),
      cashCollected: centavos(1_500_000),
      nonCashCollected: centavos(300_000),
    });

    expect(totals.totalCollected).toBe(1_800_000);
    expect(totals.uncollected).toBe(200_000);
  });

  it('floors uncollected at zero when the route collected more than expected', () => {
    const totals = computeBatchTotals({
      expectedReceivable: centavos(1_000_000),
      cashCollected: centavos(1_200_000),
      nonCashCollected: centavos(0),
    });

    expect(totals.uncollected).toBe(0);
  });

  it('reports the full expected amount as uncollected for an untouched route', () => {
    const totals = computeBatchTotals({
      expectedReceivable: centavos(500_000),
      cashCollected: centavos(0),
      nonCashCollected: centavos(0),
    });

    expect(totals.uncollected).toBe(500_000);
  });
});
