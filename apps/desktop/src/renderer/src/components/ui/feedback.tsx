import { cn } from '@renderer/lib/utils';
import type { JSX, ReactNode } from 'react';

/**
 * Feedback and layout helpers.
 *
 * `Alert` is used for anything the user must read — a failed sign-in, a
 * permission refusal, a validation problem. It always renders text; the colour
 * reinforces the meaning rather than carrying it.
 */

export type AlertTone = 'info' | 'success' | 'warning' | 'danger';

const ALERT_TONES: Record<AlertTone, string> = {
  info: 'border-info/30 bg-info/10 text-info',
  success: 'border-success/30 bg-success/10 text-success',
  warning: 'border-warning/30 bg-warning/10 text-warning',
  danger: 'border-destructive/30 bg-destructive/10 text-destructive',
};

export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  readonly tone?: AlertTone;
  readonly title?: string;
  readonly children: ReactNode;
  readonly className?: string;
}): JSX.Element {
  return (
    <div
      /*
       * A failure interrupts; a confirmation waits its turn. `alert` is assertive
       * and `status` is polite, which is the difference between "read this now"
       * and "say this when you are finished" — and without the second, a success
       * message that appears after an action is never announced at all.
       */
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('rounded-md border px-4 py-3 text-sm shadow-sm', ALERT_TONES[tone], className)}
    >
      {title !== undefined && <p className="font-medium">{title}</p>}
      <div className={cn(title !== undefined && 'mt-0.5')}>{children}</div>
    </div>
  );
}

export function Spinner({ label = 'Loading…' }: { readonly label?: string }): JSX.Element {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
      <span
        aria-hidden="true"
        className="size-4 animate-spin rounded-full border-2 border-border border-t-accent"
      />
      {label}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  readonly title: string;
  readonly description?: string;
  readonly action?: ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description !== undefined && (
        <p className="max-w-md text-xs text-muted-foreground">{description}</p>
      )}
      {action !== undefined && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function MetricCard({
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly detail?: ReactNode;
  readonly tone?: 'neutral' | 'success' | 'warning' | 'danger';
}): JSX.Element {
  const valueTone = {
    neutral: 'text-foreground',
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-destructive',
  }[tone];

  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-panel">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </p>
      <p className={cn('mt-2 text-xl font-semibold tabular-nums', valueTone)}>{value}</p>
      {detail !== undefined && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
    </section>
  );
}

export function SectionCard({
  title,
  description,
  actions,
  children,
}: {
  readonly title: string;
  /**
   * `| undefined` is required, not decorative: `exactOptionalPropertyTypes` is
   * on, so a caller passing `description={maybeUndefined}` is rejected even
   * though omitting the prop entirely is allowed. Same reasoning as `Modal`.
   */
  readonly description?: string | undefined;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <section className="rounded-lg border border-border bg-surface shadow-panel">
      <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          {description !== undefined && (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        {actions !== undefined && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  readonly title: string;
  /** See `SectionCard` for why `| undefined` is spelled out. */
  readonly description?: string | undefined;
  readonly actions?: ReactNode;
}): JSX.Element {
  return (
    <header className="flex items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description !== undefined && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions !== undefined && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
