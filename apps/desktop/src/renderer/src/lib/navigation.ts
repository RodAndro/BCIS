import { PERMISSIONS, type Permission } from '@bcis/shared';

/**
 * Navigation structure (§18) and the screens that exist.
 *
 * ── WHY PERMISSIONS ARE PART OF THE DATA ────────────────────────────────────
 * The sidebar decides what to show from the signed-in user's permissions. That
 * is a USABILITY measure and nothing more: every screen's endpoint re-checks
 * the permission server-side, and a user who navigates directly to a screen
 * they lack — because their role changed a moment ago, for instance — is
 * refused by the API rather than by this file.
 *
 * ── WHY UNBUILT ITEMS STILL APPEAR ──────────────────────────────────────────
 * §38 lists "static UI without functional financial workflows" as a critical
 * failure. Each not-yet-built item therefore advertises the phase that will
 * build it instead of linking to a screen that does nothing.
 */

export type ScreenKey =
  | 'system-health'
  | 'my-account'
  | 'subscribers'
  | 'new-subscriber'
  | 'subscriber-detail'
  | 'service-accounts'
  | 'plans'
  | 'billing-dashboard'
  | 'generate-billing'
  | 'invoices'
  | 'invoice-detail'
  | 'receive-payment'
  | 'payment-history'
  | 'gcash-verification'
  | 'collectors'
  | 'collection-areas'
  | 'collection-batches'
  | 'remittance'
  | 'receivables'
  | 'reports'
  | 'users'
  | 'audit-log'
  | 'settings'
  | 'backup';

export interface NavItem {
  readonly label: string;
  /** Present when the screen exists; absent means "planned for `phase`". */
  readonly screen?: ScreenKey;
  readonly phase: number;
  /** Permission required to use the screen. Absent means "signed in is enough". */
  readonly permission?: Permission;
}

export interface NavSection {
  readonly label: string;
  readonly items: readonly NavItem[];
}

/** The permission each implemented screen requires, or null when none does. */
export const SCREEN_PERMISSIONS: Record<ScreenKey, Permission | null> = {
  'system-health': null,
  'my-account': null,
  subscribers: PERMISSIONS.SUBSCRIBER_VIEW,
  'new-subscriber': PERMISSIONS.SUBSCRIBER_CREATE,
  'subscriber-detail': PERMISSIONS.SUBSCRIBER_VIEW,
  'service-accounts': PERMISSIONS.SERVICE_VIEW,
  plans: PERMISSIONS.SERVICE_VIEW,
  'billing-dashboard': PERMISSIONS.BILLING_VIEW,
  'generate-billing': PERMISSIONS.BILLING_GENERATE,
  invoices: PERMISSIONS.BILLING_VIEW,
  'invoice-detail': PERMISSIONS.BILLING_VIEW,
  'receive-payment': PERMISSIONS.PAYMENT_CREATE,
  'payment-history': PERMISSIONS.PAYMENT_VIEW,
  'gcash-verification': PERMISSIONS.PAYMENT_VERIFY_GCASH,
  collectors: PERMISSIONS.COLLECTION_VIEW,
  'collection-areas': PERMISSIONS.COLLECTION_VIEW,
  'collection-batches': PERMISSIONS.COLLECTION_VIEW,
  remittance: PERMISSIONS.COLLECTION_REMITTANCE_VIEW,
  receivables: PERMISSIONS.RECEIVABLE_VIEW,
  reports: PERMISSIONS.REPORT_VIEW,
  users: PERMISSIONS.USER_VIEW,
  'audit-log': PERMISSIONS.AUDIT_VIEW,
  settings: PERMISSIONS.SETTINGS_MANAGE,
  backup: PERMISSIONS.BACKUP_VERIFY,
};

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    label: 'Overview',
    items: [
      {
        label: 'Dashboard & Reports',
        screen: 'reports',
        phase: 8,
        permission: PERMISSIONS.REPORT_VIEW,
      },
    ],
  },
  {
    label: 'Subscribers',
    items: [
      {
        label: 'All Subscribers',
        screen: 'subscribers',
        phase: 3,
        permission: PERMISSIONS.SUBSCRIBER_VIEW,
      },
      {
        label: 'New Subscriber',
        screen: 'new-subscriber',
        phase: 3,
        permission: PERMISSIONS.SUBSCRIBER_CREATE,
      },
      {
        label: 'Service Accounts',
        screen: 'service-accounts',
        phase: 3,
        permission: PERMISSIONS.SERVICE_VIEW,
      },
    ],
  },
  {
    label: 'Billing',
    items: [
      {
        label: 'Current Billing',
        screen: 'billing-dashboard',
        phase: 4,
        permission: PERMISSIONS.BILLING_VIEW,
      },
      {
        label: 'Generate Billing',
        screen: 'generate-billing',
        phase: 4,
        permission: PERMISSIONS.BILLING_GENERATE,
      },
      { label: 'Invoices', screen: 'invoices', phase: 4, permission: PERMISSIONS.BILLING_VIEW },
    ],
  },
  {
    label: 'Payments',
    items: [
      {
        label: 'Receive Payment',
        screen: 'receive-payment',
        phase: 5,
        permission: PERMISSIONS.PAYMENT_CREATE,
      },
      {
        label: 'Payment History',
        screen: 'payment-history',
        phase: 5,
        permission: PERMISSIONS.PAYMENT_VIEW,
      },
      {
        label: 'GCash Verification',
        screen: 'gcash-verification',
        phase: 5,
        permission: PERMISSIONS.PAYMENT_VERIFY_GCASH,
      },
    ],
  },
  {
    label: 'Collections',
    items: [
      {
        label: 'Collectors',
        screen: 'collectors',
        phase: 6,
        permission: PERMISSIONS.COLLECTION_VIEW,
      },
      {
        label: 'Areas & Routes',
        screen: 'collection-areas',
        phase: 6,
        permission: PERMISSIONS.COLLECTION_VIEW,
      },
      {
        label: 'Collection Batches',
        screen: 'collection-batches',
        phase: 6,
        permission: PERMISSIONS.COLLECTION_VIEW,
      },
      {
        label: 'Remittance',
        screen: 'remittance',
        phase: 6,
        permission: PERMISSIONS.COLLECTION_REMITTANCE_VIEW,
      },
    ],
  },
  {
    label: 'Receivables',
    items: [
      {
        label: 'Outstanding & Aging',
        screen: 'receivables',
        phase: 7,
        permission: PERMISSIONS.RECEIVABLE_VIEW,
      },
    ],
  },
  {
    label: 'Services',
    items: [
      { label: 'Service Plans', screen: 'plans', phase: 3, permission: PERMISSIONS.SERVICE_VIEW },
    ],
  },
  {
    label: 'Reports',
    items: [
      { label: 'All Reports', screen: 'reports', phase: 8, permission: PERMISSIONS.REPORT_VIEW },
    ],
  },
  {
    label: 'Administration',
    items: [
      { label: 'Users & Roles', screen: 'users', phase: 2, permission: PERMISSIONS.USER_VIEW },
      { label: 'Audit Log', screen: 'audit-log', phase: 2, permission: PERMISSIONS.AUDIT_VIEW },
      { label: 'Settings', screen: 'settings', phase: 2, permission: PERMISSIONS.SETTINGS_MANAGE },
      { label: 'Backup & Restore', screen: 'backup', phase: 9, permission: PERMISSIONS.BACKUP_VERIFY },
    ],
  },
];

/** The label shown for a screen in the header. */
export const SCREEN_TITLES: Record<ScreenKey, string> = {
  'system-health': 'System Health',
  'my-account': 'My Account',
  subscribers: 'Subscribers',
  'new-subscriber': 'New Subscriber',
  'subscriber-detail': 'Subscriber',
  'service-accounts': 'Service Accounts',
  plans: 'Service Plans',
  'billing-dashboard': 'Current Billing',
  'generate-billing': 'Generate Billing',
  invoices: 'Invoices',
  'invoice-detail': 'Invoice',
  'receive-payment': 'Receive Payment',
  'payment-history': 'Payment History',
  'gcash-verification': 'GCash Verification',
  collectors: 'Collectors',
  'collection-areas': 'Areas & Routes',
  'collection-batches': 'Collection Batches',
  remittance: 'Remittance',
  receivables: 'Receivables',
  reports: 'Dashboard & Reports',
  users: 'Users & Roles',
  'audit-log': 'Audit Log',
  settings: 'Settings',
  backup: 'Backup & Restore',
};
