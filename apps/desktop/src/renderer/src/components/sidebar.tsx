import { useAuth } from '@renderer/features/auth/auth-context';
import {
  NAV_SECTIONS,
  SCREEN_PERMISSIONS,
  type NavItem,
  type ScreenKey,
} from '@renderer/lib/navigation';
import { cn } from '@renderer/lib/utils';
import type { JSX } from 'react';

/**
 * Navigation.
 *
 * ── PERMISSION-AWARE, AND WHAT THAT DOES NOT MEAN ───────────────────────────
 * An implemented screen the signed-in user cannot use is not shown at all. That
 * is a usability decision: a Cashier has no reason to see an Audit Log entry
 * they can never open.
 *
 * It is NOT the security boundary. That lives in `requirePermission` on the
 * API: the same Cashier calling `/audit-logs` directly is refused regardless of
 * what this file decided to render.
 *
 * Items for phases that have not been built stay visible and carry the phase
 * that will build them, rather than linking to a screen that does nothing.
 */

interface SidebarProps {
  readonly active: ScreenKey;
  readonly onSelect: (screen: ScreenKey) => void;
}

interface RenderedItem {
  readonly item: NavItem;
  readonly ready: boolean;
}

export function Sidebar({ active, onSelect }: SidebarProps): JSX.Element {
  const { can } = useAuth();

  const sections = NAV_SECTIONS.map((section) => ({
    label: section.label,
    items: section.items.flatMap<RenderedItem>((item) => {
      if (item.screen === undefined) {
        return [{ item, ready: false }];
      }

      const permission = SCREEN_PERMISSIONS[item.screen];
      if (permission !== null && !can(permission)) {
        return [];
      }

      return [{ item, ready: true }];
    }),
  })).filter((section) => section.items.length > 0);

  return (
    <aside className="flex w-60 shrink-0 flex-col bg-primary text-primary-foreground">
      <div className="border-b border-white/10 px-4 py-4">
        <p className="text-sm font-semibold leading-tight">BCIS Billing</p>
        <p className="mt-0.5 text-[11px] leading-tight text-white/60">
          Bukidnon Cable &amp; Internet
        </p>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <NavGroup label="System">
          <NavEntry
            label="System Health"
            ready
            active={active === 'system-health'}
            onClick={() => {
              onSelect('system-health');
            }}
          />
          <NavEntry
            label="My Account"
            ready
            active={active === 'my-account'}
            onClick={() => {
              onSelect('my-account');
            }}
          />
        </NavGroup>

        {sections.map((section) => (
          <NavGroup key={section.label} label={section.label}>
            {section.items.map(({ item, ready }) => (
              <NavEntry
                key={item.label}
                label={item.label}
                ready={ready}
                phase={item.phase}
                active={item.screen !== undefined && item.screen === active}
                {...(item.screen === undefined
                  ? {}
                  : {
                      onClick: () => {
                        onSelect(item.screen as ScreenKey);
                      },
                    })}
              />
            ))}
          </NavGroup>
        ))}
      </nav>

      <div className="border-t border-white/10 px-4 py-3">
        <p className="text-[11px] leading-snug text-white/50">
          Phase 2 — Auth &amp; RBAC
          <br />
          Items marked P3+ are planned, not broken.
        </p>
      </div>
    </aside>
  );
}

function NavGroup({
  label,
  children,
}: {
  readonly label: string;
  readonly children: JSX.Element | readonly JSX.Element[];
}): JSX.Element {
  return (
    <div className="mb-3">
      <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-white/40">
        {label}
      </p>
      <ul className="space-y-0.5">{children}</ul>
    </div>
  );
}

interface NavEntryProps {
  readonly label: string;
  readonly active?: boolean;
  /** True when the screen exists; false when the item is a future phase. */
  readonly ready?: boolean;
  readonly phase?: number;
  readonly onClick?: () => void;
}

function NavEntry({
  label,
  active = false,
  ready = false,
  phase,
  onClick,
}: NavEntryProps): JSX.Element {
  if (ready) {
    return (
      <li>
        <button
          type="button"
          aria-current={active ? 'page' : undefined}
          onClick={onClick}
          className={cn(
            'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[13px]',
            'transition-colors',
            active
              ? 'bg-white/15 font-medium text-white'
              : 'text-white/70 hover:bg-white/10 hover:text-white',
          )}
        >
          <span className="truncate">{label}</span>
        </button>
      </li>
    );
  }

  return (
    <li>
      <div
        title={`Not implemented yet. Planned for Phase ${String(phase ?? 0)}.`}
        aria-disabled="true"
        className="flex cursor-default items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[13px] text-white/55"
      >
        <span className="truncate">{label}</span>
        {phase !== undefined && (
          <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/50">
            P{phase}
          </span>
        )}
      </div>
    </li>
  );
}
