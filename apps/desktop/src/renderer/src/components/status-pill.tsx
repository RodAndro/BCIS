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
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  warning: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  danger: 'bg-red-50 text-red-700 ring-red-600/20',
  pending: 'bg-blue-50 text-blue-700 ring-blue-600/20',
  neutral: 'bg-slate-100 text-slate-600 ring-slate-500/20',
};

/** The dot colour, paired with the label so the meaning never rests on it. */
const DOT_CLASSES: Record<StatusTone, string> = {
  success: 'bg-emerald-600',
  warning: 'bg-amber-600',
  danger: 'bg-red-600',
  pending: 'bg-blue-600',
  neutral: 'bg-slate-400',
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
