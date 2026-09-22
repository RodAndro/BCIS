import { cn } from '@renderer/lib/utils';
import type { JSX, ReactNode, ThHTMLAttributes } from 'react';

/**
 * Data table primitives.
 *
 * ── WHY THESE ARE PLAIN ELEMENTS ────────────────────────────────────────────
 * The screens in Phase 2 are small lists. A virtualising table is a Phase 3
 * concern (TanStack Table arrives with the subscriber list, which is the first
 * one that needs it); building the abstraction now would mean guessing at the
 * requirements. These wrappers exist only so the spacing, borders, and header
 * treatment are identical everywhere.
 */

export function DataTable({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}): JSX.Element {
  return (
    <div className={cn('overflow-x-auto rounded-lg border border-border bg-surface', className)}>
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({
  children,
  className,
  align = 'left',
  ...rest
}: ThHTMLAttributes<HTMLTableCellElement> & { readonly align?: 'left' | 'right' }): JSX.Element {
  return (
    <th
      scope="col"
      className={cn(
        'border-b border-border bg-muted/60 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground',
        align === 'right' ? 'text-right' : 'text-left',
        className,
      )}
      {...rest}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className,
  align = 'left',
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly align?: 'left' | 'right';
}): JSX.Element {
  return (
    <td
      className={cn(
        'border-b border-border px-3 py-2 align-middle text-foreground',
        align === 'right' && 'text-right tabular-nums',
        className,
      )}
    >
      {children}
    </td>
  );
}

export function Tr({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}): JSX.Element {
  return <tr className={cn('hover:bg-muted/40', className)}>{children}</tr>;
}

/** A full-width row for "nothing here", so the table never renders as a bare box. */
export function EmptyRow({
  colSpan,
  children,
}: {
  readonly colSpan: number;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-10 text-center text-sm text-muted-foreground">
        {children}
      </td>
    </tr>
  );
}
