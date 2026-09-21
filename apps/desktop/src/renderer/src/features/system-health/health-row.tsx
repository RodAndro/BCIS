import { cn } from '@renderer/lib/utils';
import type { ReactNode } from 'react';

/**
 * A single labelled reading inside a status card.
 *
 * Values use tabular figures so latency numbers do not jitter horizontally
 * every time the panel refreshes.
 */
export function HealthRow({
  label,
  children,
  mono = false,
}: {
  readonly label: string;
  readonly children: ReactNode;
  readonly mono?: boolean;
}): ReactNode {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'text-right text-xs font-medium text-foreground',
          mono && 'font-mono tabular-nums',
        )}
      >
        {children}
      </dd>
    </div>
  );
}
