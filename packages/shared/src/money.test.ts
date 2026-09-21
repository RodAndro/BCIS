import { describe, expect, it } from 'vitest';

import {
  MAX_CENTAVOS,
  MoneyError,
  addCentavos,
  applyRateBasisPoints,
  centavos,
  formatCentavos,
  formatCentavosPlain,
  isValidAmountInput,
  parseCentavos,
  signedCentavos,
  subtractCentavos,
  sumCentavos,
} from './money';

describe('money: construction', () => {
  it('accepts whole numbers of centavos', () => {
    expect(centavos(0)).toBe(0);
    expect(centavos(99_900)).toBe(99_900);
  });

  it('rejects fractional centavos', () => {
    expect(() => centavos(99_900.5)).toThrow(MoneyError);
  });

  it('rejects negative amounts, pointing the caller at signedCentavos', () => {
    expect(() => centavos(-1)).toThrow(/must not be negative/i);
  });

  it('rejects NaN and Infinity', () => {
    expect(() => centavos(Number.NaN)).toThrow(MoneyError);
    expect(() => centavos(Number.POSITIVE_INFINITY)).toThrow(MoneyError);
  });

  it('rejects amounts beyond the supported maximum', () => {
    expect(() => centavos(MAX_CENTAVOS + 1)).toThrow(/exceeds the maximum/i);
  });
});

describe('money: exact arithmetic', () => {
  it('keeps the specification example exact: 999.00 + 500.00', () => {
    const total = addCentavos(centavos(99_900), centavos(50_000));
    expect(total).toBe(149_900);
    expect(formatCentavos(total)).toBe('\u20B11,499.00');
  });

  // This is the reason the whole money module exists. The same arithmetic is
  // wrong in floating point and right in centavos.
  it('succeeds where floating point fails', () => {
    const naiveSum = 1 / 10 + 2 / 10;
    expect(naiveSum).not.toBe(3 / 10);

    const exactSum = addCentavos(centavos(10), centavos(20));
    expect(exactSum).toBe(30);
  });

  it('settles an invoice to exactly zero in any payment order', () => {
    const total = centavos(99_900);
    const afterPartial = subtractCentavos(total, centavos(50_000));
    const afterFinal = subtractCentavos(centavos(49_900), centavos(49_900));

    expect(afterPartial).toBe(49_900);
    expect(afterFinal).toBe(0);
    expect(addCentavos(centavos(50_000), centavos(49_900))).toBe(total);
  });

  it('returns a signed result when a payment exceeds the remaining balance', () => {
    const difference = subtractCentavos(centavos(99_900), centavos(120_000));
    expect(difference).toBe(-20_100);
  });

  it('sums a list of amounts', () => {
    expect(sumCentavos([centavos(99_900), centavos(99_900), centavos(1)])).toBe(199_801);
  });

  it('sums an empty list to zero', () => {
    expect(sumCentavos([])).toBe(0);
  });
});

describe('money: oldest-first allocation arithmetic (AT-04)', () => {
  it('allocates 1200.00 across August and September', () => {
    // August 999.00 and September 999.00, paying 1,200.00 oldest first.
    const augustBalance = centavos(99_900);
    const septemberBalance = centavos(99_900);
    const payment = centavos(120_000);

    const toAugust = augustBalance;
    const remainingAfterAugust = subtractCentavos(payment, toAugust);
    const toSeptember = centavos(remainingAfterAugust);

    expect(toAugust).toBe(99_900);
    expect(toSeptember).toBe(20_100);
    expect(subtractCentavos(septemberBalance, toSeptember)).toBe(79_800);
    expect(formatCentavos(subtractCentavos(septemberBalance, toSeptember))).toBe('\u20B1798.00');
  });

  it('leaves the full excess as unapplied credit for an advance payment (AT-03)', () => {
    const monthlyCharge = centavos(100_000);
    const payment = centavos(300_000);

    const applied = monthlyCharge;
    const unapplied = subtractCentavos(payment, applied);

    expect(applied).toBe(100_000);
    expect(unapplied).toBe(200_000);
  });
});

describe('money: basis-point rates', () => {
  it('computes a 20% statutory discount exactly', () => {
    expect(applyRateBasisPoints(centavos(99_900), 2000)).toBe(19_980);
  });

  it('computes 12% VAT exactly', () => {
    expect(applyRateBasisPoints(centavos(99_900), 1200)).toBe(11_988);
  });

  it('rounds half up on an odd amount', () => {
    // 3.33 at 20% is 0.666, which must land on 0.67 rather than truncate.
    expect(applyRateBasisPoints(centavos(333), 2000)).toBe(67);
  });

  it('rejects a non-integer rate', () => {
    expect(() => applyRateBasisPoints(centavos(99_900), 20.5)).toThrow(/basis points/i);
  });

  it('rejects an absurd rate rather than producing a nonsense discount', () => {
    expect(() => applyRateBasisPoints(centavos(99_900), 500_000)).toThrow(/exceeds 1000%/i);
  });
});

describe('money: formatting', () => {
  it('formats whole pesos with two decimal places', () => {
    expect(formatCentavos(centavos(99_900))).toBe('\u20B1999.00');
    expect(formatCentavos(centavos(0))).toBe('\u20B10.00');
    expect(formatCentavos(centavos(1))).toBe('\u20B10.01');
  });

  it('groups thousands', () => {
    expect(formatCentavosPlain(centavos(123_456_789))).toBe('1,234,567.89');
    expect(formatCentavos(centavos(100_000_000))).toBe('\u20B11,000,000.00');
  });

  it('formats the maximum amount without precision loss', () => {
    expect(formatCentavosPlain(centavos(MAX_CENTAVOS))).toBe('9,999,999,999.99');
  });

  it('formats negative signed values with a leading minus', () => {
    expect(formatCentavosPlain(signedCentavos(-20_100))).toBe('-201.00');
  });
});

describe('money: parsing user input', () => {
  it('parses plain and formatted peso strings', () => {
    expect(parseCentavos('999')).toBe(99_900);
    expect(parseCentavos('999.00')).toBe(99_900);
    expect(parseCentavos('999.5')).toBe(99_950);
    expect(parseCentavos('1,234.56')).toBe(123_456);
    expect(parseCentavos('  \u20B11,234.56 ')).toBe(123_456);
  });

  it('rejects more than two decimal places instead of silently truncating', () => {
    expect(() => parseCentavos('12.345')).toThrow(MoneyError);
    expect(isValidAmountInput('12.345')).toBe(false);
  });

  it('rejects malformed input', () => {
    for (const input of ['', 'abc', '.', '12.', '-5', '1.2.3', '1e3']) {
      expect(() => parseCentavos(input)).toThrow(MoneyError);
    }
  });

  it('round-trips through parse and format', () => {
    const parsed = parseCentavos('1,234.56');
    expect(formatCentavos(parsed)).toBe('\u20B11,234.56');
  });
});
