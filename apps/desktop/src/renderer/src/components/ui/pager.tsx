import { Button } from '@renderer/components/ui/button';
import { Select } from '@renderer/components/ui/form';
import { cn } from '@renderer/lib/utils';
import type { JSX } from 'react';

/**
 * List pagination.
 *
 * ── WHY THE SERVER DOES THE PAGING ──────────────────────────────────────────
 * Every list endpoint filters, sorts, and pages in SQL and the API caps
 * `pageSize` at 200. This control therefore moves a window over the result set;
 * it never loads one. That is what keeps a 20,000-subscriber table from being
 * pulled into the renderer.
 *
 * ── ONE CONTROL, EVERY LIST ─────────────────────────────────────────────────
 * The sizes offered here are the whole vocabulary, and the range text is phrased
 * the same way everywhere, so "how many per page?" has one answer in the
 * application rather than one per screen.
 */

/** The page sizes offered on every list. */
export const PAGE_SIZE_OPTIONS = [10, 15, 20, 30] as const;

/** What every paginated list starts at. */
export const DEFAULT_PAGE_SIZE = 10;

export interface PagerProps {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly onChange: (page: number) => void;
  /**
   * Omitted by a list that cannot change its page size — the ledger statement
   * is read as one continuous balance, so re-sizing it is not offered.
   */
  readonly onPageSizeChange?: ((pageSize: number) => void) | undefined;
  readonly className?: string;
}

export function Pager({
  page,
  pageSize,
  total,
  onChange,
  onPageSizeChange,
  className,
}: PagerProps): JSX.Element | null {
  // Nothing to page through, so the control would only be noise.
  if (total === 0) return null;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // A filter can shrink the result set under the current page; clamp so the
  // range text and the buttons describe what is actually on screen.
  const current = Math.min(page, totalPages);
  const first = (current - 1) * pageSize + 1;
  const last = Math.min(current * pageSize, total);

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-border pt-4 text-xs text-muted-foreground',
        className,
      )}
    >
      <p>
        Showing <span className="tabular-nums text-foreground">{first}</span>–
        <span className="tabular-nums text-foreground">{last}</span> of{' '}
        <span className="tabular-nums text-foreground">{total}</span> record(s)
      </p>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {onPageSizeChange !== undefined && (
          <label className="flex items-center gap-2">
            <span>Rows per page</span>
            <Select
              aria-label="Rows per page"
              className="h-8 w-20 py-0 text-xs leading-none tabular-nums"
              value={String(pageSize)}
              onChange={(event) => {
                onPageSizeChange(Number(event.target.value));
              }}
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={String(size)}>
                  {size}
                </option>
              ))}
            </Select>
          </label>
        )}

        <nav aria-label="Pagination" className="flex items-center gap-1">
          <Button
            size="sm"
            disabled={current <= 1}
            onClick={() => {
              onChange(current - 1);
            }}
          >
            Previous
          </Button>

          {pageEntries(current, totalPages).map((entry, index) =>
            entry === 'gap' ? (
              <span key={`gap-${String(index)}`} aria-hidden="true" className="px-1">
                …
              </span>
            ) : (
              <Button
                key={entry}
                size="sm"
                variant={entry === current ? 'primary' : 'secondary'}
                aria-current={entry === current ? 'page' : undefined}
                className="h-9 w-9 min-w-9 p-0 text-xs leading-none tabular-nums"
                onClick={() => {
                  onChange(entry);
                }}
              >
                {entry}
              </Button>
            ),
          )}

          <Button
            size="sm"
            disabled={current >= totalPages}
            onClick={() => {
              onChange(current + 1);
            }}
          >
            Next
          </Button>
        </nav>
      </div>
    </div>
  );
}

type PageEntry = number | 'gap';

/**
 * The page numbers to show, with `…` standing in for the pages between.
 *
 * A run of thirty numbered buttons is not a control anyone reads; the first and
 * last page are always reachable and the current one stays visible.
 */
function pageEntries(current: number, totalPages: number): PageEntry[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const start = Math.max(2, current - 1);
  const end = Math.min(totalPages - 1, current + 1);
  const entries: PageEntry[] = [1];

  if (start > 2) entries.push('gap');
  for (let value = start; value <= end; value += 1) entries.push(value);
  if (end < totalPages - 1) entries.push('gap');
  entries.push(totalPages);

  return entries;
}
