import { NAV_SECTIONS, SYSTEM_HEALTH_ITEM } from '@renderer/lib/navigation';
import { cn } from '@renderer/lib/utils';
import type { JSX, ReactNode } from 'react';

export function Sidebar(): JSX.Element {
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
          <NavEntry label={SYSTEM_HEALTH_ITEM.label} active />
        </NavGroup>

        {NAV_SECTIONS.map((section) => (
          <NavGroup key={section.label} label={section.label}>
            {section.items.map((item) => (
              <NavEntry key={item.label} label={item.label} phase={item.phase} />
            ))}
          </NavGroup>
        ))}
      </nav>

      <div className="border-t border-white/10 px-4 py-3">
        <p className="text-[11px] leading-snug text-white/50">
          Phase 1 — Foundation
          <br />
          Only System Health is implemented. Every other item shows the phase that will build it.
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
  readonly children: ReactNode;
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

function NavEntry({
  label,
  active = false,
  phase,
}: {
  readonly label: string;
  readonly active?: boolean;
  readonly phase?: number;
}): JSX.Element {
  return (
    <li>
      <div
        aria-current={active ? 'page' : undefined}
        aria-disabled={active ? undefined : true}
        title={
          active === true
            ? undefined
            : `Not implemented yet. Planned for Phase ${String(phase ?? 0)}.`
        }
        className={cn(
          'flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[13px]',
          active === true ? 'bg-white/15 font-medium text-white' : 'cursor-default text-white/55',
        )}
      >
        <span className="truncate">{label}</span>
        {active !== true && phase !== undefined && (
          <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/50">
            P{phase}
          </span>
        )}
      </div>
    </li>
  );
}
