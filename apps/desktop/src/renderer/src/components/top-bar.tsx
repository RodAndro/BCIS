import { StatusPill } from '@renderer/components/status-pill';
import { useSystemHealth } from '@renderer/features/system-health/use-system-health';
import type { JSX } from 'react';

/**
 * Application chrome.
 *
 * Shows a single global connection indicator so that a cashier always knows
 * whether the workstation is talking to the server, without having to open the
 * health screen. It reads the same query as the health panel, so TanStack Query
 * deduplicates the request.
 */
export function TopBar(): JSX.Element {
  const health = useSystemHealth();
  const result = health.data;

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-6">
      <div>
        <p className="text-sm font-medium text-foreground">Subscription Billing and Collection</p>
      </div>

      <div className="flex items-center gap-4">
        <span className="font-mono text-[11px] text-muted-foreground">
          {result?.api.baseUrl ?? '—'}
        </span>

        {result === undefined ? (
          <StatusPill tone="neutral" label="Unknown" />
        ) : result.ok ? (
          <StatusPill tone="success" label="Connected" />
        ) : result.api.reachable ? (
          <StatusPill tone="warning" label="Database down" />
        ) : (
          <StatusPill tone="danger" label="Disconnected" />
        )}
      </div>
    </header>
  );
}
