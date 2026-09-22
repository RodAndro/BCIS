import { Button } from '@renderer/components/ui/button';
import type { JSX } from 'react';

/**
 * List pagination.
 *
 * The API caps `pageSize` at 200 and every list endpoint filters and sorts in
 * SQL, so this is a page control rather than a "load everything" affordance.
 * It renders nothing when there is a single page, which keeps short lists from
 * carrying controls that cannot do anything.
 */
export function Pager({
  page,
  total,
  pageSize,
  onChange,
}: {
  readonly page: number;
  readonly total: number;
  readonly pageSize: number;
  readonly onChange: (page: number) => void;
}): JSX.Element | null {
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between text-xs text-muted-foreground">
      <span>
        Page {page} of {totalPages} · {total} record(s)
      </span>
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={page <= 1}
          onClick={() => {
            onChange(page - 1);
          }}
        >
          Previous
        </Button>
        <Button
          size="sm"
          disabled={page >= totalPages}
          onClick={() => {
            onChange(page + 1);
          }}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
