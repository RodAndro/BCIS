import { MAX_CENTAVOS, MoneyError, isBusinessDate, parseCentavos } from '@bcis/shared';
import { z } from 'zod';

/**
 * Shared Zod primitives.
 *
 * Every value crossing a trust boundary is validated with one of these: HTTP
 * body, query string, route params, and IPC payloads from the renderer. The
 * renderer is not trusted — it runs on a workstation a user can inspect.
 */

/** A database identifier. Rejects floats, zero, and negatives before they reach SQL. */
export const idSchema = z.number().int().positive();

/** Accepts an identifier from a URL path segment. */
export const idParamSchema = z.coerce.number().int().positive();

/**
 * A calendar date in the business timezone, `YYYY-MM-DD`.
 *
 * Deliberately not `z.string().date()`, which validates a moment rather than a
 * calendar day, and has moved between Zod majors. This checks real calendar
 * validity, so `2026-02-31` is rejected.
 */
export const businessDateSchema = z
  .string()
  .trim()
  .refine(isBusinessDate, { message: 'Enter a valid date in YYYY-MM-DD form.' });

/**
 * A monetary amount already expressed as integer centavos.
 * Use this for values arriving from another system component.
 */
export const centavosSchema = z
  .number()
  .int('Amounts must be whole centavos.')
  .nonnegative('Amounts must not be negative.')
  .max(MAX_CENTAVOS, 'Amount exceeds the maximum supported value.');

/** A monetary amount that may be negative. Balances, variances, differences. */
export const signedCentavosSchema = z
  .number()
  .int('Amounts must be whole centavos.')
  .min(-MAX_CENTAVOS, 'Amount is below the minimum supported value.')
  .max(MAX_CENTAVOS, 'Amount exceeds the maximum supported value.');

/**
 * A monetary amount typed by a person, e.g. "1,234.56".
 *
 * Transforms to centavos on parse. The client never sends a peso float, and
 * the server never accepts one.
 */
export const pesoInputSchema = z
  .string()
  .trim()
  .min(1, 'Enter an amount.')
  .transform((value, ctx) => {
    try {
      return parseCentavos(value);
    } catch (error) {
      ctx.addIssue({
        code: 'custom',
        message:
          error instanceof MoneyError ? error.message : 'Enter a valid amount, for example 999.00.',
      });
      return z.NEVER;
    }
  });

/** A short human-readable label. */
export const shortTextSchema = z.string().trim().min(1).max(120);

/** A longer free-text note. */
export const noteSchema = z.string().trim().max(2000);

/** A reason attached to a financial action. Required wherever an audit entry needs one. */
export const reasonSchema = z
  .string()
  .trim()
  .min(10, 'Give a reason of at least 10 characters. This is recorded in the audit log.')
  .max(500);

/** A quantity of service units. Whole units only — no half-months of service. */
export const quantitySchema = z.number().int().positive().max(1000);
