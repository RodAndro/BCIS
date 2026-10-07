import { cn } from '@renderer/lib/utils';
import type { JSX, ReactNode } from 'react';

/**
 * Badge.
 *
 * A short inline label — "you", "older rate", a phase tag. Distinct from
 * `StatusPill`, which always carries a status dot and a meaning; a badge is
 * annotation, so it stays flat and quiet.
 */

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-muted text-muted-foreground ring-border',
  accent: 'bg-accent/15 text-accent ring-accent/30',
  success: 'bg-success/15 text-success ring-success/30',
  warning: 'bg-warning/15 text-warning ring-warning/30',
  danger: 'bg-destructive/15 text-destructive ring-destructive/30',
};

export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  readonly tone?: BadgeTone;
  readonly className?: string;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-md px-2 py-1 text-[11px] font-semibold',
        'ring-1 ring-inset',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
