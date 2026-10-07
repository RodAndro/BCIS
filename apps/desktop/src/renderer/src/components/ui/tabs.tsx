import { cn } from '@renderer/lib/utils';
import type { JSX } from 'react';

/**
 * Tab strip.
 *
 * ── WHY `aria-current` AND NOT `role="tab"` ─────────────────────────────────
 * The full ARIA tab pattern requires `aria-controls` pointing at a `tabpanel`
 * with a matching id. These strips switch which panel *renders* rather than
 * showing one of several mounted panels, so declaring the role without the
 * wiring would be less honest to assistive technology than a plain button that
 * states which view is current.
 *
 * Extracted from two identical copies (the subscriber profile and Users &
 * Roles) so the active treatment cannot drift between them.
 */

export interface TabItem<T extends string> {
  readonly value: T;
  readonly label: string;
}

export interface TabsProps<T extends string> {
  readonly value: T;
  readonly items: readonly TabItem<T>[];
  readonly onChange: (value: T) => void;
  readonly className?: string;
}

export function Tabs<T extends string>({
  value,
  items,
  onChange,
  className,
}: TabsProps<T>): JSX.Element {
  return (
    <div className={cn('flex gap-1 overflow-x-auto border-b border-border', className)}>
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            aria-current={active ? 'page' : undefined}
            onClick={() => {
              onChange(item.value);
            }}
            className={cn(
              '-mb-px whitespace-nowrap border-b-2 px-4 py-3 text-sm transition-colors',
              active
                ? 'border-accent bg-accent/5 font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
