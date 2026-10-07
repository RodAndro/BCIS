import { cn } from '@renderer/lib/utils';
import type { JSX } from 'react';

/**
 * Status indicator.
 *
 * §19 requires status to be conveyed by text AND colour. Colour alone fails
 * for a colour-blind user, on a washed-out office monitor, and on a
 * black-and-white printout of a saved report — and in a billing system a
 * misread status is a misread balance.
 */

export type StatusTone = 'success' | 'warning' | 'danger' | 'neutral' | 'pending';

const TONE_CLASSES: Record<StatusTone, string> = {
  success: 'bg-success font-semibold text-white ring-success/70',
  warning: 'bg-warning/15 text-warning ring-warning/30',
  danger: 'bg-destructive/15 text-destructive ring-destructive/30',
  pending: 'bg-info/15 text-info ring-info/30',
  neutral: 'bg-muted text-muted-foreground ring-border',
};

/** The dot colour, paired with the label so the meaning never rests on it. */
const DOT_CLASSES: Record<StatusTone, string> = {
  success: 'bg-white',
  warning: 'bg-warning',
  danger: 'bg-destructive',
  pending: 'bg-info',
  neutral: 'bg-muted-foreground/60',
};

interface StatusPillProps {
  readonly tone: StatusTone;
  readonly label: string;
  readonly className?: string;
}

export function StatusPill({ tone, label, className }: StatusPillProps): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5',
        'text-xs font-medium ring-1 ring-inset',
        TONE_CLASSES[tone],
        className,
      )}
    >
      <span aria-hidden="true" className={cn('size-1.5 rounded-full', DOT_CLASSES[tone])} />
      {label}
    </span>
  );
}
