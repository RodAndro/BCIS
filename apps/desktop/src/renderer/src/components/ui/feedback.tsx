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
  info: 'border-blue-200 bg-blue-50 text-blue-800',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  danger: 'border-red-200 bg-red-50 text-red-800',
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
      role={tone === 'danger' ? 'alert' : undefined}
      className={cn('rounded-md border px-3 py-2 text-sm', ALERT_TONES[tone], className)}
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

export function SectionCard({
  title,
  description,
  actions,
  children,
}: {
  readonly title: string;
  readonly description?: string;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <section className="rounded-lg border border-border bg-surface">
      <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
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
  readonly description?: string;
  readonly actions?: ReactNode;
}): JSX.Element {
  return (
    <header className="flex items-start justify-between gap-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-foreground">{title}</h1>
        {description !== undefined && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions !== undefined && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
