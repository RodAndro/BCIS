/**
 * Permission vocabulary (§15 of the laboratory specification).
 *
 * These codes are the single source of truth shared by the API's authorization
 * guard and the desktop client's UI hints.
 *
 * ── IMPORTANT ───────────────────────────────────────────────────────────────
 * The desktop client uses these only to hide or disable controls. That is a
 * usability measure, NOT a security boundary. Every protected API route
 * independently declares the permission it requires, and the server rejects
 * the request when it is absent — a Cashier calling an administrator endpoint
 * directly must receive 403 regardless of what the UI showed them.
 */

export const PERMISSIONS = {
  SUBSCRIBER_VIEW: 'subscriber.view',
  SUBSCRIBER_CREATE: 'subscriber.create',
  SUBSCRIBER_UPDATE: 'subscriber.update',
  SUBSCRIBER_ARCHIVE: 'subscriber.archive',

  SERVICE_VIEW: 'service.view',
  SERVICE_MANAGE: 'service.manage',
  SERVICE_PLAN_MANAGE: 'service.plan.manage',

  BILLING_VIEW: 'billing.view',
  BILLING_GENERATE: 'billing.generate',
  BILLING_ADJUST: 'billing.adjust',
  BILLING_VOID: 'billing.void',

  PAYMENT_VIEW: 'payment.view',
  PAYMENT_CREATE: 'payment.create',
  PAYMENT_REVERSE: 'payment.reverse',
  PAYMENT_VERIFY_GCASH: 'payment.verify.gcash',
  PAYMENT_OVERRIDE_DUPLICATE_REFERENCE: 'payment.override.duplicate_reference',

  COLLECTION_VIEW: 'collection.view',
  COLLECTION_CREATE: 'collection.create',
  COLLECTION_SUBMIT: 'collection.submit',
  COLLECTION_REMITTANCE_VIEW: 'collection.remittance.view',
  COLLECTION_REMITTANCE_RECORD: 'collection.remittance.record',
  COLLECTION_RECONCILE: 'collection.reconcile',
  COLLECTION_VARIANCE_APPROVE: 'collection.variance.approve',

  RECEIVABLE_VIEW: 'receivable.view',
  SUSPENSION_VIEW: 'suspension.view',
  SUSPENSION_APPROVE: 'suspension.approve',
  RECONNECTION_REQUEST: 'reconnection.request',
  RECONNECTION_APPROVE: 'reconnection.approve',

  REPORT_VIEW: 'report.view',
  REPORT_EXPORT: 'report.export',

  USER_VIEW: 'user.view',
  USER_MANAGE: 'user.manage',
  ROLE_MANAGE: 'role.manage',
  SETTINGS_MANAGE: 'settings.manage',

  AUDIT_VIEW: 'audit.view',
  BACKUP_CREATE: 'backup.create',
  BACKUP_RESTORE: 'backup.restore',

  INTEGRITY_CHECK_RUN: 'integrity.check.run',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** Every permission code, for seeding the `permissions` table. */
export const ALL_PERMISSIONS: readonly Permission[] = Object.values(PERMISSIONS);

export const ROLE_CODES = {
  OWNER: 'OWNER',
  ADMINISTRATOR: 'ADMINISTRATOR',
  CASHIER: 'CASHIER',
  COLLECTION_SUPERVISOR: 'COLLECTION_SUPERVISOR',
  ACCOUNTING_AUDITOR: 'ACCOUNTING_AUDITOR',
  TECHNICIAN: 'TECHNICIAN',
  READ_ONLY_VIEWER: 'READ_ONLY_VIEWER',
} as const;

export type RoleCode = (typeof ROLE_CODES)[keyof typeof ROLE_CODES];

export const ALL_ROLE_CODES: readonly RoleCode[] = Object.values(ROLE_CODES);

/**
 * Which permissions each role receives at seed time.
 *
 * This is the starting grant set, not a hardcoded law: the actual authorization
 * decision always comes from `role_permissions` in the database, so an Owner
 * can adjust a role without a code change. Phase 2 seeds these rows.
 *
 * `OWNER` is intentionally absent — it is granted every permission, including
 * any added later, so it does not need an explicit list that could drift.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<Exclude<RoleCode, 'OWNER'>, readonly Permission[]> = {
  ADMINISTRATOR: [
    PERMISSIONS.SUBSCRIBER_VIEW,
    PERMISSIONS.SUBSCRIBER_CREATE,
    PERMISSIONS.SUBSCRIBER_UPDATE,
    PERMISSIONS.SUBSCRIBER_ARCHIVE,
    PERMISSIONS.SERVICE_VIEW,
    PERMISSIONS.SERVICE_MANAGE,
    PERMISSIONS.SERVICE_PLAN_MANAGE,
    PERMISSIONS.BILLING_VIEW,
    PERMISSIONS.BILLING_GENERATE,
    PERMISSIONS.BILLING_ADJUST,
    PERMISSIONS.BILLING_VOID,
    PERMISSIONS.PAYMENT_VIEW,
    PERMISSIONS.PAYMENT_CREATE,
    PERMISSIONS.PAYMENT_VERIFY_GCASH,
    PERMISSIONS.COLLECTION_VIEW,
    PERMISSIONS.COLLECTION_CREATE,
    PERMISSIONS.COLLECTION_RECONCILE,
    PERMISSIONS.RECEIVABLE_VIEW,
    PERMISSIONS.SUSPENSION_VIEW,
    PERMISSIONS.SUSPENSION_APPROVE,
    PERMISSIONS.RECONNECTION_REQUEST,
    PERMISSIONS.RECONNECTION_APPROVE,
    PERMISSIONS.REPORT_VIEW,
    PERMISSIONS.REPORT_EXPORT,
    PERMISSIONS.USER_VIEW,
    PERMISSIONS.AUDIT_VIEW,
  ],

  CASHIER: [
    PERMISSIONS.SUBSCRIBER_VIEW,
    PERMISSIONS.SERVICE_VIEW,
    PERMISSIONS.BILLING_VIEW,
    PERMISSIONS.PAYMENT_VIEW,
    PERMISSIONS.PAYMENT_CREATE,
    PERMISSIONS.PAYMENT_VERIFY_GCASH,
    PERMISSIONS.COLLECTION_VIEW,
    PERMISSIONS.RECEIVABLE_VIEW,
    PERMISSIONS.REPORT_VIEW,
  ],

  COLLECTION_SUPERVISOR: [
    PERMISSIONS.SUBSCRIBER_VIEW,
    PERMISSIONS.SERVICE_VIEW,
    PERMISSIONS.BILLING_VIEW,
    PERMISSIONS.PAYMENT_VIEW,
    PERMISSIONS.PAYMENT_CREATE,
    PERMISSIONS.PAYMENT_VERIFY_GCASH,
    PERMISSIONS.PAYMENT_REVERSE,
    PERMISSIONS.COLLECTION_VIEW,
    PERMISSIONS.COLLECTION_CREATE,
    PERMISSIONS.COLLECTION_SUBMIT,
    PERMISSIONS.COLLECTION_REMITTANCE_VIEW,
    PERMISSIONS.COLLECTION_REMITTANCE_RECORD,
    PERMISSIONS.COLLECTION_RECONCILE,
    PERMISSIONS.COLLECTION_VARIANCE_APPROVE,
    PERMISSIONS.RECEIVABLE_VIEW,
    PERMISSIONS.SUSPENSION_VIEW,
    PERMISSIONS.SUSPENSION_APPROVE,
    PERMISSIONS.RECONNECTION_REQUEST,
    PERMISSIONS.REPORT_VIEW,
    PERMISSIONS.REPORT_EXPORT,
  ],

  ACCOUNTING_AUDITOR: [
    PERMISSIONS.SUBSCRIBER_VIEW,
    PERMISSIONS.SERVICE_VIEW,
    PERMISSIONS.BILLING_VIEW,
    PERMISSIONS.PAYMENT_VIEW,
    PERMISSIONS.COLLECTION_VIEW,
    PERMISSIONS.COLLECTION_REMITTANCE_VIEW,
    PERMISSIONS.RECEIVABLE_VIEW,
    PERMISSIONS.SUSPENSION_VIEW,
    PERMISSIONS.REPORT_VIEW,
    PERMISSIONS.REPORT_EXPORT,
    PERMISSIONS.AUDIT_VIEW,
    PERMISSIONS.INTEGRITY_CHECK_RUN,
  ],

  TECHNICIAN: [
    PERMISSIONS.SUBSCRIBER_VIEW,
    PERMISSIONS.SERVICE_VIEW,
    PERMISSIONS.RECONNECTION_REQUEST,
    PERMISSIONS.SUSPENSION_VIEW,
  ],

  READ_ONLY_VIEWER: [
    PERMISSIONS.SUBSCRIBER_VIEW,
    PERMISSIONS.SERVICE_VIEW,
    PERMISSIONS.BILLING_VIEW,
    PERMISSIONS.PAYMENT_VIEW,
    PERMISSIONS.COLLECTION_VIEW,
    PERMISSIONS.RECEIVABLE_VIEW,
    PERMISSIONS.REPORT_VIEW,
  ],
};

/** Human-readable role names, for seeding and for the UI. */
export const ROLE_LABELS: Record<RoleCode, string> = {
  OWNER: 'Owner / Super Admin',
  ADMINISTRATOR: 'Administrator',
  CASHIER: 'Cashier',
  COLLECTION_SUPERVISOR: 'Collection Supervisor',
  ACCOUNTING_AUDITOR: 'Accounting / Auditor',
  TECHNICIAN: 'Technician',
  READ_ONLY_VIEWER: 'Read-only Viewer',
};
