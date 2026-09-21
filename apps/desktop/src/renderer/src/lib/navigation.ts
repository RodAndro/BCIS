/**
 * Navigation structure (§18).
 *
 * ── WHY THE PHASE IS PART OF THE DATA ───────────────────────────────────────
 * Every item here is specified, and none of it is built yet. Rather than
 * render links that lead nowhere — which looks finished and is not — each item
 * carries the phase that will implement it, and the sidebar shows that openly.
 * §38 lists "static UI without functional financial workflows" as a critical
 * failure, and this is how Phase 1 avoids it: the only interactive surface is
 * the one that actually works.
 */

export interface NavItem {
  readonly label: string;
  readonly phase: number;
}

export interface NavSection {
  readonly label: string;
  readonly items: readonly NavItem[];
}

/** The one screen that is genuinely implemented in Phase 1. */
export const SYSTEM_HEALTH_ITEM = { label: 'System Health', phase: 1 } as const;

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    label: 'Overview',
    items: [{ label: 'Dashboard', phase: 8 }],
  },
  {
    label: 'Subscribers',
    items: [
      { label: 'All Subscribers', phase: 3 },
      { label: 'New Subscriber', phase: 3 },
      { label: 'Service Accounts', phase: 3 },
    ],
  },
  {
    label: 'Billing',
    items: [
      { label: 'Current Billing', phase: 4 },
      { label: 'Generate Billing', phase: 4 },
      { label: 'Invoices', phase: 4 },
    ],
  },
  {
    label: 'Payments',
    items: [
      { label: 'Receive Payment', phase: 5 },
      { label: 'Payment History', phase: 5 },
      { label: 'GCash Verification', phase: 5 },
    ],
  },
  {
    label: 'Collections',
    items: [
      { label: 'Collectors', phase: 6 },
      { label: 'Areas & Routes', phase: 6 },
      { label: 'Collection Batches', phase: 6 },
      { label: 'Remittance', phase: 6 },
    ],
  },
  {
    label: 'Receivables',
    items: [
      { label: 'Outstanding', phase: 7 },
      { label: 'Overdue', phase: 7 },
      { label: 'Aging', phase: 7 },
      { label: 'Suspension Candidates', phase: 7 },
    ],
  },
  {
    label: 'Services',
    items: [{ label: 'Service Plans', phase: 3 }],
  },
  {
    label: 'Reports',
    items: [{ label: 'All Reports', phase: 8 }],
  },
  {
    label: 'Administration',
    items: [
      { label: 'Users & Roles', phase: 2 },
      { label: 'Audit Log', phase: 2 },
      { label: 'Settings', phase: 2 },
      { label: 'Backup & Restore', phase: 9 },
    ],
  },
];
