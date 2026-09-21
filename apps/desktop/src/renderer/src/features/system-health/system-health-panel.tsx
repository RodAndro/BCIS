import { StatusPill, type StatusTone } from '@renderer/components/status-pill';
import { HealthRow } from '@renderer/features/system-health/health-row';
import { useAppInfo, useSystemHealth } from '@renderer/features/system-health/use-system-health';
import { cn } from '@renderer/lib/utils';
import type { JSX, ReactNode } from 'react';

/**
 * Phase 1 system health screen.
 *
 * ── WHAT THIS SCREEN IS FOR ─────────────────────────────────────────────────
 * It is not decoration. It is the evidence that the required architecture is
 * actually wired end to end:
 *
 *   renderer  →  preload  →  main process  →  HTTP  →  Fastify  →  PostgreSQL
 *
 * Every value on this page is fetched live through that chain. Deliberately
 * stopping the API must change what is displayed — and it does, because
 * nothing here is hardcoded.
 *
 * ── WHY MIGRATION STATE IS SHOWN ────────────────────────────────────────────
 * "The database answers" and "the database has the schema this build expects"
 * are different questions. An API running against a database that is one
 * migration behind will pass a naive ping and then fail on the first real
 * query, so the pending-migration list is surfaced rather than hidden.
 */

export function SystemHealthPanel(): JSX.Element {
  const health = useSystemHealth();
  const appInfo = useAppInfo();

  const result = health.data;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground">System Health</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live status of the API and the PostgreSQL database, read through the desktop client.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {health.dataUpdatedAt > 0 && (
            <span className="text-xs text-muted-foreground">
              Checked {formatClockTime(health.dataUpdatedAt)}
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              void health.refetch();
            }}
            disabled={health.isFetching}
            className={cn(
              'rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium',
              'text-foreground transition-colors hover:bg-muted',
              'disabled:cursor-not-allowed disabled:opacity-60',
            )}
          >
            {health.isFetching ? 'Checking…' : 'Check now'}
          </button>
        </div>
      </header>

      <OverallStatus health={result} isLoading={health.isLoading} error={health.error} />

      <div className="grid gap-4 lg:grid-cols-2">
        <StatusCard
          title="API"
          subtitle="Fastify service"
          tone={result?.api.reachable === true ? 'success' : 'danger'}
          statusLabel={result?.api.reachable === true ? 'Reachable' : 'Unreachable'}
        >
          <HealthRow label="Base URL">{result?.api.baseUrl ?? '—'}</HealthRow>
          <HealthRow label="Reported status">{result?.api.status ?? '—'}</HealthRow>
          <HealthRow label="Version">{result?.api.version ?? '—'}</HealthRow>
          <HealthRow label="Round trip" mono>
            {result === undefined ? '—' : `${String(result.api.latencyMs)} ms`}
          </HealthRow>
          {result?.api.error != null && (
            <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
              {result.api.error}
            </p>
          )}
        </StatusCard>

        <StatusCard
          title="Database"
          subtitle="PostgreSQL"
          tone={databaseTone(result?.database.status ?? null, result?.database.connected ?? false)}
          statusLabel={databaseLabel(
            result?.database.status ?? null,
            result?.database.connected ?? false,
          )}
        >
          <HealthRow label="Query latency" mono>
            {result?.database.latencyMs == null ? '—' : `${String(result.database.latencyMs)} ms`}
          </HealthRow>
          <HealthRow label="Server">
            {shortPostgresVersion(result?.database.serverVersion ?? null)}
          </HealthRow>
          <HealthRow label="Applied migrations" mono>
            {result?.database.appliedMigrations ?? '—'}
          </HealthRow>
          <HealthRow label="Pending migrations" mono>
            {result === undefined
              ? '—'
              : result.database.pendingMigrations.length === 0
                ? 'none'
                : String(result.database.pendingMigrations.length)}
          </HealthRow>

          {result !== undefined && result.database.pendingMigrations.length > 0 && (
            <div className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <p className="font-medium">This database is behind the code.</p>
              <p className="mt-1">
                Run <span className="font-mono">pnpm db:migrate</span>. Pending:{' '}
                {result.database.pendingMigrations.join(', ')}
              </p>
            </div>
          )}

          {result?.database.error != null && (
            <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
              {result.database.error}
            </p>
          )}
        </StatusCard>
      </div>

      <section className="rounded-lg border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold text-foreground">Desktop client</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Versions reported by the Electron main process. The renderer cannot read these itself — it
          has no Node access by design.
        </p>

        <dl className="mt-3 grid gap-x-8 sm:grid-cols-2">
          <HealthRow label="Application">{appInfo.data?.name ?? '—'}</HealthRow>
          <HealthRow label="Version">{appInfo.data?.version ?? '—'}</HealthRow>
          <HealthRow label="Electron" mono>
            {appInfo.data?.electronVersion ?? '—'}
          </HealthRow>
          <HealthRow label="Chromium" mono>
            {appInfo.data?.chromeVersion ?? '—'}
          </HealthRow>
          <HealthRow label="Node" mono>
            {appInfo.data?.nodeVersion ?? '—'}
          </HealthRow>
          <HealthRow label="Platform" mono>
            {appInfo.data?.platform ?? '—'}
          </HealthRow>
        </dl>
      </section>
    </div>
  );
}

function OverallStatus({
  health,
  isLoading,
  error,
}: {
  readonly health: ReturnType<typeof useSystemHealth>['data'];
  readonly isLoading: boolean;
  readonly error: Error | null;
}): JSX.Element {
  if (isLoading) {
    return (
      <div className="rounded-lg border border-border bg-surface px-5 py-4">
        <StatusPill tone="pending" label="Checking" />
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-5 py-4">
        <div className="flex items-center gap-3">
          <StatusPill tone="danger" label="Client error" />
          <p className="text-sm text-red-800">
            The desktop client could not complete the health check: {error.message}
          </p>
        </div>
      </div>
    );
  }

  if (health === undefined) {
    return (
      <div className="rounded-lg border border-border bg-surface px-5 py-4">
        <StatusPill tone="neutral" label="No data" />
      </div>
    );
  }

  if (health.ok) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-5 py-4">
        <div className="flex items-center gap-3">
          <StatusPill tone="success" label="All systems normal" />
          <p className="text-sm text-emerald-800">
            The client reached the API, and the API reached PostgreSQL.
          </p>
        </div>
      </div>
    );
  }

  if (health.api.reachable && !health.database.connected) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-5 py-4">
        <div className="flex items-center gap-3">
          <StatusPill tone="warning" label="Degraded" />
          <p className="text-sm text-amber-800">
            The API is running but cannot reach PostgreSQL. No billing or payment operation can
            succeed until this is resolved.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-5 py-4">
      <div className="flex items-center gap-3">
        <StatusPill tone="danger" label="API unreachable" />
        <p className="text-sm text-red-800">
          The desktop client cannot reach the API at {health.api.baseUrl}. Start it with{' '}
          <span className="font-mono">pnpm dev</span>.
        </p>
      </div>
    </div>
  );
}

function StatusCard({
  title,
  subtitle,
  tone,
  statusLabel,
  children,
}: {
  readonly title: string;
  readonly subtitle: string;
  readonly tone: StatusTone;
  readonly statusLabel: string;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <StatusPill tone={tone} label={statusLabel} />
      </div>

      <dl className="mt-4 divide-y divide-border">{children}</dl>
    </section>
  );
}

function databaseTone(
  status: 'ok' | 'degraded' | 'unavailable' | null,
  connected: boolean,
): StatusTone {
  if (!connected) return 'danger';
  if (status === 'degraded') return 'warning';
  return 'success';
}

function databaseLabel(
  status: 'ok' | 'degraded' | 'unavailable' | null,
  connected: boolean,
): string {
  if (!connected) return 'Unavailable';
  if (status === 'degraded') return 'Migrations pending';
  return 'Connected';
}

/** `PostgreSQL 17.11 on x86_64-windows, compiled by ...` becomes `PostgreSQL 17.11`. */
function shortPostgresVersion(version: string | null): string {
  if (version === null) return '—';
  return version.split(' ').slice(0, 2).join(' ');
}

function formatClockTime(epochMs: number): string {
  const date = new Date(epochMs);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
