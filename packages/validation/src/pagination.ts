import { z } from 'zod';

/**
 * Pagination and sorting for list endpoints.
 *
 * ── WHY A HARD PAGE-SIZE CEILING ────────────────────────────────────────────
 * §21 targets 20,000 subscribers, 500,000 invoices, and 1,000,000 ledger
 * entries. Returning an unbounded result set would pull hundreds of megabytes
 * into the Electron renderer and freeze the workstation. `pageSize` is capped
 * at 200 and every list endpoint is expected to filter and sort in SQL.
 */

export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 50;

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const sortDirectionSchema = z.enum(['asc', 'desc']);
export type SortDirection = z.infer<typeof sortDirectionSchema>;

/**
 * A requested sort column.
 *
 * ── SECURITY ────────────────────────────────────────────────────────────────
 * This only validates the *shape* of the field name. It must never be
 * interpolated into SQL. Each repository owns an explicit allowlist mapping a
 * public sort key to a real Drizzle column:
 *
 *   const SORTABLE = { accountNumber: subscribers.accountNumber, ... } as const;
 *   const column = SORTABLE[input.sortBy ?? 'accountNumber'];
 *
 * An unknown key is rejected rather than passed through, so a crafted value
 * cannot reach the query builder.
 */
export const sortQuerySchema = z.object({
  sortBy: z
    .string()
    .trim()
    .regex(/^[a-zA-Z][a-zA-Z0-9_]{0,49}$/, 'Invalid sort field.')
    .optional(),
  sortDir: sortDirectionSchema.default('asc'),
});

export type SortQuery = z.infer<typeof sortQuerySchema>;

/** A date range filter. Both bounds inclusive. */
export const dateRangeQuerySchema = z
  .object({
    from: z.string().trim().optional(),
    to: z.string().trim().optional(),
  })
  .refine((range) => range.from === undefined || range.to === undefined || range.from <= range.to, {
    message: 'The start of the range must not be after the end.',
  });

export type DateRangeQuery = z.infer<typeof dateRangeQuerySchema>;

/** Standard pagination metadata returned with every list response. */
export interface PageMeta {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
  readonly hasNext: boolean;
}

export function buildPageMeta(page: number, pageSize: number, total: number): PageMeta {
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  return {
    page,
    pageSize,
    total,
    totalPages,
    hasNext: page < totalPages,
  };
}

export function offsetFor(page: number, pageSize: number): number {
  return (page - 1) * pageSize;
}
