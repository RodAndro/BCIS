/**
 * Money primitives for the BCIS billing system.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 * Every monetary value in this system is an INTEGER NUMBER OF CENTAVOS.
 * Never a peso amount, never a floating-point number, never `toFixed`.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 * IEEE-754 binary floating point cannot represent most decimal fractions
 * exactly. `1 / 10 + 2 / 10` is not `3 / 10`. In a billing system that
 * error compounds across allocation, aging, and remittance, and it surfaces
 * as a balance that is off by a centavo and cannot be reconciled.
 *
 * Integers are closed under addition and subtraction, so a ledger built from
 * integer centavos always sums to exactly zero when everything is paid.
 *
 * ── WHY TWO TYPES ───────────────────────────────────────────────────────────
 * `Centavos`        — a non-negative amount. Invoice totals, payment amounts,
 *                     allocation amounts, fees. A negative value here is a bug,
 *                     so the constructor rejects it.
 * `SignedCentavos`  — a value that may legitimately be negative. Account
 *                     balances (a customer in credit has a negative balance),
 *                     differences, and variances.
 *
 * Keeping these distinct means the compiler stops you from assigning an
 * account balance into an invoice total.
 *
 * ── POSTGRES ────────────────────────────────────────────────────────────────
 * These map to `BIGINT` columns named `*_centavos`, read through Drizzle with
 * `bigint({ mode: 'number' })`. `MAX_CENTAVOS` is roughly ₱10 billion, which is
 * far beyond any realistic BCIS figure and comfortably inside the JavaScript
 * safe-integer range (2^53 - 1).
 */

declare const CENTAVOS_BRAND: unique symbol;
declare const SIGNED_CENTAVOS_BRAND: unique symbol;

/** A non-negative monetary amount, in centavos. */
export type Centavos = number & { readonly [CENTAVOS_BRAND]: 'Centavos' };

/** A monetary amount, in centavos, that may be negative. */
export type SignedCentavos = number & { readonly [SIGNED_CENTAVOS_BRAND]: 'SignedCentavos' };

/** The Philippine peso sign, written as an escape so the source stays ASCII. */
export const PESO_SIGN = '\u20B1';

/** Centavos per peso. */
export const CENTAVOS_PER_PESO = 100;

/**
 * Largest representable amount: ₱9,999,999,999.99.
 * Chosen so that `amount * basisPoints` still lands inside Number.MAX_SAFE_INTEGER
 * for the basis-point rates we use (checkRateInput guards the rest).
 */
export const MAX_CENTAVOS = 999_999_999_999;

/** Thrown when a value violates a money invariant. */
export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

function assertSafeAmount(value: number, label: string): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new MoneyError(
      `${label} must be an integer number of centavos, received ${String(value)}. ` +
        'Use parseCentavos() to convert user input instead of parseFloat().',
    );
  }
  if (Math.abs(value) > MAX_CENTAVOS) {
    throw new MoneyError(
      `${label} of ${String(value)} centavos exceeds the maximum supported amount ` +
        `(${String(MAX_CENTAVOS)} centavos).`,
    );
  }
}

/** Construct a non-negative amount. Rejects negatives, fractions, NaN, Infinity. */
export function centavos(value: number): Centavos {
  assertSafeAmount(value, 'Amount');
  if (value < 0) {
    throw new MoneyError(
      `Amount must not be negative, received ${String(value)}. ` +
        'Use signedCentavos() for balances and variances, which may be negative.',
    );
  }
  return value as Centavos;
}

/** Construct an amount that may be negative. Used for balances and variances. */
export function signedCentavos(value: number): SignedCentavos {
  assertSafeAmount(value, 'Signed amount');
  return value as SignedCentavos;
}

/** The non-negative zero amount. */
export const ZERO: Centavos = 0 as Centavos;

/** The signed zero, which is only distinct from ZERO at the type level. */
export const SIGNED_ZERO: SignedCentavos = 0 as SignedCentavos;

export function isZero(amount: SignedCentavos | Centavos): boolean {
  return amount === 0;
}

export function isPositive(amount: SignedCentavos | Centavos): boolean {
  return amount > 0;
}

export function isNegative(amount: SignedCentavos): boolean {
  return amount < 0;
}

/** -1, 0, or 1. Safe to pass to Array.prototype.sort. */
export function compareCentavos(
  left: SignedCentavos | Centavos,
  right: SignedCentavos | Centavos,
): -1 | 0 | 1 {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function equalsCentavos(
  left: SignedCentavos | Centavos,
  right: SignedCentavos | Centavos,
): boolean {
  return left === right;
}

export function addCentavos(left: Centavos, right: Centavos): Centavos {
  return centavos(left + right);
}

export function addSignedCentavos(left: SignedCentavos, right: SignedCentavos): SignedCentavos {
  return signedCentavos(left + right);
}

/**
 * Subtract `right` from `left`, returning a signed result.
 *
 * This deliberately returns `SignedCentavos`: paying more than is owed, or
 * comparing a paid amount against a total, legitimately produces a negative
 * value. Callers that require a non-negative result must say so explicitly
 * with `nonNegative()`.
 */
export function subtractCentavos(left: Centavos, right: Centavos): SignedCentavos {
  return signedCentavos(left - right);
}

/** Flip the sign of a non-negative amount. */
export function negateCentavos(amount: Centavos): SignedCentavos {
  return signedCentavos(-amount);
}

/**
 * Clamp a possibly-negative value up to zero.
 *
 * Re-runs the constructor rather than casting: the check above already proves
 * the value is non-negative, so `centavos()` cannot throw, and it keeps the
 * "every Centavos was validated" property true without an escape hatch.
 */
export function nonNegative(amount: SignedCentavos): Centavos {
  return amount < 0 ? ZERO : centavos(amount);
}

/** Clamp a possibly-negative value down to zero. */
export function nonPositive(amount: SignedCentavos): SignedCentavos {
  return amount > 0 ? SIGNED_ZERO : amount;
}

/** The smaller of two amounts. */
export function minCentavos(left: Centavos, right: Centavos): Centavos {
  return left <= right ? left : right;
}

/** The larger of two amounts. */
export function maxCentavos(left: Centavos, right: Centavos): Centavos {
  return left >= right ? left : right;
}

/** Total a list of non-negative amounts. */
export function sumCentavos(values: readonly Centavos[]): Centavos {
  let total = 0;
  for (const value of values) {
    total += value;
    assertSafeAmount(total, 'Running total');
  }
  return centavos(total);
}

/** Total a list of signed amounts. */
export function sumSignedCentavos(values: readonly SignedCentavos[]): SignedCentavos {
  let total = 0;
  for (const value of values) {
    total += value;
    assertSafeAmount(total, 'Running total');
  }
  return signedCentavos(total);
}

/**
 * Apply a rate expressed in BASIS POINTS, rounding half-up to the nearest centavo.
 *
 * Basis points avoid the classic trap of writing a percentage as a float.
 * 20%  -> 2000 bps
 * 12%  -> 1200 bps
 * 0.5% ->   50 bps
 *
 * Rounding is half-up, matching how Philippine statutory discounts are
 * presented on a receipt. Note that the rounding delta must still be recorded
 * on the invoice line so the invoice re-adds to its own total; see
 * packages/domain for the discount calculation that does this.
 */
export function applyRateBasisPoints(amount: Centavos, basisPoints: number): Centavos {
  if (!Number.isSafeInteger(basisPoints)) {
    throw new MoneyError(
      `Rate must be an integer number of basis points, received ${String(basisPoints)}.`,
    );
  }
  if (basisPoints < 0) {
    throw new MoneyError(`Rate must not be negative, received ${String(basisPoints)}.`);
  }
  if (basisPoints > 100_000) {
    throw new MoneyError(
      `Rate of ${String(basisPoints)} basis points exceeds 1000%. Check the caller.`,
    );
  }

  const product = amount * basisPoints;
  if (!Number.isSafeInteger(product)) {
    throw new MoneyError(
      `Applying ${String(basisPoints)} basis points to ${String(amount)} centavos overflows ` +
        'the safe integer range. Split the calculation.',
    );
  }

  // Math.round is half-up for non-negative values, which is what we want.
  return centavos(Math.round(product / 10_000));
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Format as a plain decimal string with grouped thousands, e.g. `1,234.56`.
 *
 * Implemented with integer arithmetic rather than `Number.toFixed`, because
 * `toFixed` rounds the binary float value and can produce a value that differs
 * from the stored centavos.
 */
export function formatCentavosPlain(amount: Centavos | SignedCentavos): string {
  const negative = amount < 0;
  const absolute = Math.abs(amount);
  const whole = Math.floor(absolute / CENTAVOS_PER_PESO);
  const fraction = absolute % CENTAVOS_PER_PESO;

  const body = `${groupThousands(String(whole))}.${String(fraction).padStart(2, '0')}`;
  return negative ? `-${body}` : body;
}

/**
 * Format with the peso sign, e.g. `\u20B1999.00`.
 *
 * Uses integer arithmetic only, and deliberately does not go through
 * `Intl.NumberFormat`: the output must be byte-identical on all three office
 * workstations regardless of their installed locale data, and on a receipt
 * that certainty matters more than locale-aware grouping.
 *
 * There is intentionally no function that converts `Centavos` back to a peso
 * `number` — exposing one would invite float money back into the codebase.
 * Screens format to a string; arithmetic stays in centavos.
 */
export function formatCentavos(amount: Centavos | SignedCentavos): string {
  return `${PESO_SIGN}${formatCentavosPlain(amount)}`;
}

/**
 * Parse a user-entered peso string into centavos.
 *
 * Accepts: `999`, `999.00`, `1,234.56`, `\u20B11,234.56`, with surrounding whitespace.
 * Rejects: more than two decimal places, a bare decimal point, signs, and any
 * other malformed input. Rejecting is deliberate — silently truncating a
 * mis-typed amount is how a cashier records the wrong figure.
 */
export function parseCentavos(input: string): Centavos {
  if (typeof input !== 'string') {
    throw new MoneyError('Amount must be entered as text.');
  }

  const cleaned = input
    .replace(/[\s\u00A0]/g, '')
    .replaceAll(',', '')
    .replace(PESO_SIGN, '');

  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (match === null) {
    throw new MoneyError(
      `"${input}" is not a valid amount. Enter pesos and centavos, for example 999.00.`,
    );
  }

  const wholePart = match[1] ?? '0';
  const fractionPart = (match[2] ?? '').padEnd(2, '0');

  const whole = Number(wholePart);
  const fraction = Number(fractionPart);

  if (!Number.isSafeInteger(whole) || !Number.isSafeInteger(fraction)) {
    throw new MoneyError(`"${input}" is too large to be a valid amount.`);
  }

  return centavos(whole * CENTAVOS_PER_PESO + fraction);
}

/** True when the string parses as a valid amount. Useful for form validation. */
export function isValidAmountInput(input: string): boolean {
  try {
    parseCentavos(input);
    return true;
  } catch {
    return false;
  }
}

/** Serialise an amount for transport/storage as a string, e.g. `99900`. */
export function serializeCentavos(amount: Centavos | SignedCentavos): string {
  return String(amount);
}

/** Parse an amount received from storage/transport. */
export function deserializeCentavos(value: string | number): Centavos {
  const numeric = typeof value === 'number' ? value : Number(value);
  return centavos(numeric);
}
