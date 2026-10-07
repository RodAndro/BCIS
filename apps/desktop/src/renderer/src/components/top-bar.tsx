import { Button } from '@renderer/components/ui/button';
import { LockIcon, LogOutIcon } from '@renderer/components/ui/icons';
import { StatusPill } from '@renderer/components/status-pill';
import { useAuth } from '@renderer/features/auth/auth-context';
import { useSystemHealth } from '@renderer/features/system-health/use-system-health';
import { roleLabel } from '@renderer/lib/format';
import type { JSX } from 'react';

/**
 * Application chrome.
 *
 * Shows who is signed in, on which role, and whether the workstation can reach
 * the server — the three things a cashier needs without opening another screen.
 *
 * The lock and sign-out controls live here rather than being buried in a menu,
 * because they are the two actions someone takes when they walk away from the
 * till, and they should cost one click.
 */
export function TopBar({ title }: { readonly title: string }): JSX.Element {
  const { state, lock, logout } = useAuth();
  const health = useSystemHealth();
  const result = health.data;
  const user = state.user;

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/15 bg-primary px-6 text-primary-foreground">
      <div className="min-w-0">
        <p className="truncate text-base font-semibold text-primary-foreground">{title}</p>
        <p className="truncate text-[11px] text-primary-foreground/70">
          {user === null
            ? 'Not signed in'
            : `${user.fullName} · ${user.roles.map(roleLabel).join(', ') || 'no role'}`}
        </p>
      </div>

      <div className="flex items-center gap-3">
        <span className="hidden font-mono text-[11px] text-primary-foreground/70 lg:inline">
          {result?.api.baseUrl ?? '—'}
        </span>

        {result === undefined ? (
          <StatusPill tone="neutral" label="Checking" />
        ) : result.ok ? (
          <StatusPill tone="success" label="Connected" />
        ) : result.api.reachable ? (
          <StatusPill tone="warning" label="Database down" />
        ) : (
          <StatusPill tone="danger" label="Disconnected" />
        )}

        <div className="ml-2 flex items-center gap-2 border-l border-white/20 pl-3">
          <Button
            size="sm"
            onClick={() => {
              void lock();
            }}
          >
            <LockIcon className="size-3.5" />
            Lock
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-primary-foreground/80 hover:bg-white/10 hover:text-primary-foreground active:bg-white/15"
            onClick={() => {
              void logout();
            }}
          >
            <LogOutIcon className="size-3.5" />
            Sign out
          </Button>
        </div>
      </div>
    </header>
  );
}
