/**
 * Invoice status vocabulary.
 *
 * ── WHY THIS LIVES IN `shared` ──────────────────────────────────────────────
 * Three layers need the same list: the pure billing rules in `@bcis/domain`, the
 * Zod schemas in `@bcis/validation`, and the SQL CHECK constraint written by
 * hand in the migration. `@bcis/validation` may not import `@bcis/domain`
 * (the client bundles validation, and the documented package boundaries do not
 * have that edge), so the vocabulary lives in the one package both already
 * depend on.
 *
 * ── THE SEVEN STATES, AND WHY ONLY SIX ARE STORED ───────────────────────────
 * The specification names seven invoice states. Six are lifecycle states that
 * are true regardless of when you ask. `OVERDUE` is not: it is a function of
 * the due date and today's date, so storing it would make it wrong until the
 * next job run — an invoice reported overdue the morning after it was paid is
 * worse than one reported a day late.
 *
 * `OVERDUE` is therefore derived, and the API returns it as `displayStatus`, so
 * the UI still shows all seven. Decision A13 in the roadmap.
 */

export const STORED_INVOICE_STATUSES = [
  'DRAFT',
  'UNPAID',
  'PARTIALLY_PAID',
  'PAID',
  'VOID',
  'CREDITED',
] as const;

export type StoredInvoiceStatus = (typeof STORED_INVOICE_STATUSES)[number];

export const DISPLAY_INVOICE_STATUSES = [...STORED_INVOICE_STATUSES, 'OVERDUE'] as const;

export type DisplayInvoiceStatus = (typeof DISPLAY_INVOICE_STATUSES)[number];
