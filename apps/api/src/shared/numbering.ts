import { schema } from '@bcis/database';
import { sql } from 'drizzle-orm';

import type { Tx } from './database';

/**
 * Document numbering.
 *
 * ── WHY THE ALLOCATION IS AN UPSERT ─────────────────────────────────────────
 * `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` takes a row lock on the
 * counter for the duration of the transaction. Two concurrent registrations
 * therefore serialise on one short row lock rather than reading the same value
 * and racing to use it — which is what makes duplicate account numbers
 * impossible rather than merely unlikely.
 *
 * Because the increment is part of the transaction, it rolls back with it: a
 * failed registration does not burn a number.
 *
 * ── NO GAPS, ON PURPOSE ─────────────────────────────────────────────────────
 * A Postgres `SEQUENCE` would be faster and would leave gaps on rollback. For
 * subscriber numbers that would be harmless; for receipts it is not (§11
 * requires voided receipt numbers to be reserved and never reused). One
 * mechanism for both, chosen for the stricter case.
 */

export interface NumberRequest {
  /** Counter name, e.g. `SUBSCRIBER` or `SERVICE_ACCOUNT`. */
  readonly scope: string;
  /** Rendered as the prefix, e.g. `SUB` → `SUB-000123`. */
  readonly prefix: string;
  /**
   * 0 for scopes that are not year-scoped (subscribers, service accounts).
   * Invoices and receipts use the business year, so a number reads
   * `INV-2026-000123` and the year is part of the promise that numbering does
   * not repeat.
   */
  readonly periodYear: number;
  /** Zero-padding width. Defaults to 6. */
  readonly width?: number;
  /** Include the period year between the prefix and the counter. */
  readonly includeYear?: boolean;
}

const DEFAULT_WIDTH = 6;

/**
 * Allocate the next number in `scope`.
 *
 * Must be called inside the transaction that creates the document, so the
 * number and the row it belongs to commit together.
 */
export async function allocateDocumentNumber(tx: Tx, request: NumberRequest): Promise<string> {
  const rows = await tx
    .insert(schema.documentSequences)
    .values({
      scope: request.scope,
      periodYear: request.periodYear,
      prefix: request.prefix,
      currentValue: 1,
    })
    .onConflictDoUpdate({
      target: [schema.documentSequences.scope, schema.documentSequences.periodYear],
      set: {
        currentValue: sql`${schema.documentSequences.currentValue} + 1`,
        prefix: request.prefix,
        updatedAt: sql`now()`,
      },
    })
    .returning({
      currentValue: schema.documentSequences.currentValue,
      prefix: schema.documentSequences.prefix,
    });

  const row = rows[0];
  if (row === undefined) {
    throw new Error(`Allocating a ${request.scope} number returned no row.`);
  }

  const width = request.width ?? DEFAULT_WIDTH;
  const counter = String(row.currentValue).padStart(width, '0');

  return request.includeYear === true
    ? `${row.prefix}-${String(request.periodYear)}-${counter}`
    : `${row.prefix}-${counter}`;
}

/** Numbering scopes, so a scope name is never a string literal at a call site. */
export const NUMBER_SCOPES = {
  SUBSCRIBER: { scope: 'SUBSCRIBER', prefix: 'SUB', periodYear: 0 },
  SERVICE_ACCOUNT: { scope: 'SERVICE_ACCOUNT', prefix: 'SA', periodYear: 0 },
  /**
   * Invoices are numbered per business year (decision A11), so a number is
   * `INV-2026-000123`. Numbering is global rather than per-workstation: three
   * PCs each with their own counter would issue the same number three times.
   */
  INVOICE: { scope: 'INVOICE', prefix: 'INV', includeYear: true },
  /**
   * Receipts are numbered per business year, like invoices, so a number reads
   * `RCPT-2026-000123`. Voided receipt numbers are reserved and never reissued
   * (§11), which is the reason the counter must never skip a number on rollback.
   */
  RECEIPT: { scope: 'RECEIPT', prefix: 'RCPT', includeYear: true },
} as const;
