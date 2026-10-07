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
    <div className={cn('overflow-x-auto rounded-lg border border-border bg-surface shadow-panel', className)}>
      <table className="w-full min-w-full border-collapse text-sm">{children}</table>
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
        'border-b border-border bg-muted/70 px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground',
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
        'border-b border-border px-4 py-3 align-middle text-foreground',
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
  return <tr className={cn('transition-colors hover:bg-accent/5', className)}>{children}</tr>;
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
