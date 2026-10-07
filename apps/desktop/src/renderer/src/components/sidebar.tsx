import { Badge } from '@renderer/components/ui/badge';
import {
  ActivityIcon,
  ArchiveIcon,
  BanknoteIcon,
  BarChartIcon,
  CheckCircleIcon,
  CircleDollarSignIcon,
  ClipboardListIcon,
  CoinsIcon,
  CreditCardIcon,
  FilePlusIcon,
  FileTextIcon,
  GaugeIcon,
  HistoryIcon,
  LayersIcon,
  LayoutGridIcon,
  MapIcon,
  PackageIcon,
  ReceiptIcon,
  SettingsIcon,
  ShieldIcon,
  TagIcon,
  TrendingUpIcon,
  UserCheckIcon,
  UserIcon,
  UserPlusIcon,
  UsersIcon,
  type IconProps,
} from '@renderer/components/ui/icons';
import { useAuth } from '@renderer/features/auth/auth-context';
import { NAV_SECTIONS, SCREEN_PERMISSIONS, type ScreenKey } from '@renderer/lib/navigation';
import { cn } from '@renderer/lib/utils';
import type { ComponentType, JSX, ReactNode } from 'react';
import { useId, useState } from 'react';

/**
 * Navigation.
 *
 * ── WHY THE GROUPS COLLAPSE ─────────────────────────────────────────────────
 * Twenty-odd destinations rendered flat is a wall the eye has to scan every time
 * someone wants one of them. Collapsing each section behind its own header turns
 * that wall into nine short labels, and the section holding the current screen is
 * opened so the way back is never hidden.
 *
 * ── PERMISSION-AWARE, AND WHAT THAT DOES NOT MEAN ───────────────────────────
 * An implemented screen the signed-in user cannot use is not shown at all, and a
 * section left with nothing to show disappears rather than opening onto nothing.
 * That is a usability decision: a Cashier has no reason to see an Audit Log entry
 * they can never open.
 *
 * It is NOT the security boundary. That lives in `requirePermission` on the
 * API: the same Cashier calling `/audit-logs` directly is refused regardless of
 * what this file decided to render.
 */

interface SidebarProps {
  readonly active: ScreenKey;
  readonly onSelect: (screen: ScreenKey) => void;
}

/** A destination in the sidebar. `screen` absent means a not-yet-built phase. */
interface SidebarEntry {
  readonly label: string;
  readonly screen?: ScreenKey;
  readonly phase?: number;
}

interface SidebarGroup {
  readonly label: string;
  readonly items: readonly SidebarEntry[];
}

/** Icon for each collapsible section header. */
const SECTION_ICONS: Record<string, ComponentType<IconProps>> = {
  System: ActivityIcon,
  Overview: LayoutGridIcon,
  Subscribers: UsersIcon,
  Billing: ReceiptIcon,
  Payments: CreditCardIcon,
  Collections: CoinsIcon,
  Receivables: TrendingUpIcon,
  Services: LayersIcon,
  Reports: BarChartIcon,
  Administration: ShieldIcon,
};

/** Icon for each implemented destination, keyed by screen. */
const SCREEN_ICONS: Record<ScreenKey, ComponentType<IconProps>> = {
  'system-health': ActivityIcon,
  'my-account': UserIcon,
  subscribers: UsersIcon,
  'new-subscriber': UserPlusIcon,
  'subscriber-detail': UserIcon,
  'service-accounts': LayersIcon,
  plans: TagIcon,
  'billing-dashboard': GaugeIcon,
  'generate-billing': FilePlusIcon,
  invoices: FileTextIcon,
  'invoice-detail': FileTextIcon,
  'receive-payment': CircleDollarSignIcon,
  'payment-history': HistoryIcon,
  'gcash-verification': CheckCircleIcon,
  collectors: UserCheckIcon,
  'collection-areas': MapIcon,
  'collection-batches': PackageIcon,
  remittance: BanknoteIcon,
  receivables: TrendingUpIcon,
  reports: BarChartIcon,
  users: UsersIcon,
  'audit-log': ClipboardListIcon,
  settings: SettingsIcon,
  backup: ArchiveIcon,
};

export function Sidebar({ active, onSelect }: SidebarProps): JSX.Element {
  const { can } = useAuth();

  const systemGroup: SidebarGroup = {
    label: 'System',
    items: [
      { label: 'System Health', screen: 'system-health' },
      { label: 'My Account', screen: 'my-account' },
    ],
  };

  const groups: SidebarGroup[] = [
    systemGroup,
    ...NAV_SECTIONS.map((section): SidebarGroup => ({
      label: section.label,
      items: section.items.flatMap<SidebarEntry>((item) => {
        if (item.screen === undefined) {
          return [{ label: item.label, phase: item.phase }];
        }

        const permission = SCREEN_PERMISSIONS[item.screen];
        if (permission !== null && !can(permission)) {
          return [];
        }

        return [{ label: item.label, screen: item.screen }];
      }),
    })),
  ].filter((group) => group.items.length > 0);

  /*
   * Which sections are open. A section defaults to open when it holds the
   * current screen and closed otherwise, so the list starts short but the
   * path back to where the user is stays visible. Once someone toggles a
   * section by hand that choice wins — including closing the active one.
   */
  const activeGroup = groups.find((group) =>
    group.items.some((item) => item.screen === active),
  )?.label;

  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  const isOpen = (label: string): boolean => toggled[label] ?? label === activeGroup;

  function toggle(label: string): void {
    setToggled((current) => ({
      ...current,
      [label]: !(current[label] ?? label === activeGroup),
    }));
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-white/15 bg-primary text-primary-foreground">
      <div className="border-b border-white/15 px-5 py-5">
        <div className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-accent text-sm font-bold text-accent-foreground">
            B
          </span>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold leading-tight text-primary-foreground">
              BCIS Billing
            </p>
            <p className="mt-1 truncate text-xs leading-tight text-primary-foreground/70">
              Bukidnon Cable &amp; Internet
            </p>
          </div>
        </div>
      </div>

      {/*
        `[scrollbar-gutter:stable]` reserves the scrollbar's width at all times.
        Without it, expanding enough groups makes the list overflow, a scrollbar
        appears, and every entry narrows by its width — the sidebar visibly
        throbs as dropdowns open and close. With the gutter always reserved, the
        nav measures the same regardless of how many groups are expanded.
      */}
      <nav className="flex-1 overflow-y-auto py-4 pl-2 pr-0 [scrollbar-gutter:stable]">
        {groups.map((group) => (
          <NavGroup
            key={group.label}
            label={group.label}
            icon={SECTION_ICONS[group.label]}
            open={isOpen(group.label)}
            onToggle={() => {
              toggle(group.label);
            }}
          >
            {group.items.map((item) => {
              const screen = item.screen;

              if (screen === undefined) {
                return <NavEntry key={item.label} label={item.label} phase={item.phase} />;
              }

              return (
                <NavEntry
                  key={item.label}
                  label={item.label}
                  icon={SCREEN_ICONS[screen]}
                  ready
                  active={screen === active}
                  onClick={() => {
                    onSelect(screen);
                  }}
                />
              );
            })}
          </NavGroup>
        ))}
      </nav>
    </aside>
  );
}

function NavGroup({
  label,
  icon: Icon,
  open,
  onToggle,
  children,
}: {
  readonly label: string;
  readonly icon: ComponentType<IconProps> | undefined;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly children: ReactNode;
}): JSX.Element {
  const listId = useId();

  return (
    <div className="mb-1">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={onToggle}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-md py-2 pl-3 pr-2',
          'text-[11px] font-semibold uppercase tracking-wider text-primary-foreground/70',
          'transition-colors hover:bg-white/10 hover:text-primary-foreground',
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          {Icon !== undefined && <Icon className="size-3.5" />}
          <span className="truncate">{label}</span>
        </span>
        <Chevron open={open} />
      </button>

      {open && (
        <ul id={listId} className="mt-0.5 space-y-0.5">
          {children}
        </ul>
      )}
    </div>
  );
}

function Chevron({ open }: { readonly open: boolean }): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}

interface NavEntryProps {
  readonly label: string;
  /** Icon for an implemented destination; absent for a future phase. */
  readonly icon?: ComponentType<IconProps>;
  readonly active?: boolean;
  /** True when the screen exists; false when the item is a future phase. */
  readonly ready?: boolean;
  /**
   * `| undefined` is required, not decorative: `exactOptionalPropertyTypes` is
   * on, so passing `phase={maybeUndefined}` is rejected even though omitting the
   * prop entirely is allowed.
   */
  readonly phase?: number | undefined;
  readonly onClick?: () => void;
}

function NavEntry({
  label,
  icon: Icon,
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
            'relative flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm',
            'transition-colors',
            active
              ? 'bg-white/15 font-medium text-primary-foreground'
              : 'text-primary-foreground/75 hover:bg-white/10 hover:text-primary-foreground',
          )}
        >
          {active && (
            <span
              aria-hidden="true"
              className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-accent"
            />
          )}
          <span className="flex min-w-0 items-center gap-2.5">
            {Icon !== undefined && <Icon className="size-4" />}
            <span className="truncate">{label}</span>
          </span>
        </button>
      </li>
    );
  }

  return (
    <li>
      <div
        title={`Not implemented yet. Planned for Phase ${String(phase ?? 0)}.`}
        aria-disabled="true"
        className="flex cursor-default items-center justify-between gap-2 rounded-md px-3 py-2 text-sm text-primary-foreground/50"
      >
        <span className="truncate">{label}</span>
        {phase !== undefined && <Badge>{`P${String(phase)}`}</Badge>}
      </div>
    </li>
  );
}
