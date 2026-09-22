/**
 * Audit action vocabulary.
 *
 * ── WHY CONSTANTS AND NOT LITERALS ──────────────────────────────────────────
 * The audit log is queried by action (`?action=USER_STATUS_CHANGED`), so the
 * strings are part of the API surface. Centralising them means a rename is a
 * compile error at every call site rather than a filter that silently returns
 * nothing.
 *
 * Every Phase 2+ module records its own actions here as it is built.
 */
export const AUDIT_ACTIONS = {
  // --- Authentication ------------------------------------------------------
  LOGIN_SUCCEEDED: 'LOGIN_SUCCEEDED',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGOUT: 'LOGOUT',
  SESSION_LOCKED: 'SESSION_LOCKED',
  SESSION_UNLOCKED: 'SESSION_UNLOCKED',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',

  // --- User administration -------------------------------------------------
  USER_CREATED: 'USER_CREATED',
  USER_UPDATED: 'USER_UPDATED',
  USER_STATUS_CHANGED: 'USER_STATUS_CHANGED',
  USER_ROLES_CHANGED: 'USER_ROLES_CHANGED',
  USER_PASSWORD_RESET: 'USER_PASSWORD_RESET',

  // --- Access control ------------------------------------------------------
  ROLE_PERMISSIONS_CHANGED: 'ROLE_PERMISSIONS_CHANGED',

  // --- Configuration -------------------------------------------------------
  SETTING_UPDATED: 'SETTING_UPDATED',

  // --- Plans and collection areas (Phase 3) --------------------------------
  PLAN_CREATED: 'PLAN_CREATED',
  PLAN_UPDATED: 'PLAN_UPDATED',
  /** A new price version. The old version stays readable — that is the point. */
  PLAN_PRICE_CHANGED: 'PLAN_PRICE_CHANGED',
  PLAN_RETIRED: 'PLAN_RETIRED',
  COLLECTION_AREA_CREATED: 'COLLECTION_AREA_CREATED',
  COLLECTION_AREA_UPDATED: 'COLLECTION_AREA_UPDATED',
  COLLECTION_BATCH_CREATED: 'COLLECTION_BATCH_CREATED',
  COLLECTION_BATCH_STARTED: 'COLLECTION_BATCH_STARTED',
  COLLECTION_BATCH_SUBMITTED: 'COLLECTION_BATCH_SUBMITTED',
  COLLECTOR_REMITTANCE_RECORDED: 'COLLECTOR_REMITTANCE_RECORDED',
  COLLECTION_BATCH_RECONCILED: 'COLLECTION_BATCH_RECONCILED',
  COLLECTION_BATCH_CLOSED: 'COLLECTION_BATCH_CLOSED',
  SUSPENSION_RECORDED: 'SUSPENSION_RECORDED',
  RECONNECTION_REQUESTED: 'RECONNECTION_REQUESTED',
  RECONNECTION_SCHEDULED: 'RECONNECTION_SCHEDULED',
  RECONNECTION_COMPLETED: 'RECONNECTION_COMPLETED',
  BACKUP_CREATED: 'BACKUP_CREATED',
  BACKUP_VERIFIED: 'BACKUP_VERIFIED',
  BACKUP_RESTORED: 'BACKUP_RESTORED',

  // --- Subscribers (Phase 3) -----------------------------------------------
  SUBSCRIBER_CREATED: 'SUBSCRIBER_CREATED',
  SUBSCRIBER_UPDATED: 'SUBSCRIBER_UPDATED',
  SUBSCRIBER_STATUS_CHANGED: 'SUBSCRIBER_STATUS_CHANGED',
  SUBSCRIBER_ADDRESSES_CHANGED: 'SUBSCRIBER_ADDRESSES_CHANGED',
  SUBSCRIBER_CONTACTS_CHANGED: 'SUBSCRIBER_CONTACTS_CHANGED',

  // --- Service accounts (Phase 3) ------------------------------------------
  SERVICE_ACCOUNT_CREATED: 'SERVICE_ACCOUNT_CREATED',
  SERVICE_ACCOUNT_UPDATED: 'SERVICE_ACCOUNT_UPDATED',
  SERVICE_ACCOUNT_STATUS_CHANGED: 'SERVICE_ACCOUNT_STATUS_CHANGED',
  SERVICE_ACCOUNT_PLAN_CHANGED: 'SERVICE_ACCOUNT_PLAN_CHANGED',
  /** An account was deliberately moved onto its plan's current price. */
  SERVICE_ACCOUNT_RATE_APPLIED: 'SERVICE_ACCOUNT_RATE_APPLIED',
  SERVICE_ACCOUNT_NOTE: 'SERVICE_ACCOUNT_NOTE',

  // --- Billing and the ledger (Phase 4) ------------------------------------
  BILLING_CYCLE_OPENED: 'BILLING_CYCLE_OPENED',
  BILLING_GENERATED: 'BILLING_GENERATED',
  /** A draft became a posted document and wrote its ledger debit. */
  INVOICE_FINALIZED: 'INVOICE_FINALIZED',
  INVOICE_VOIDED: 'INVOICE_VOIDED',
  INVOICE_ADJUSTMENT_POSTED: 'INVOICE_ADJUSTMENT_POSTED',
  INVOICE_PENALTY_APPLIED: 'INVOICE_PENALTY_APPLIED',

  // --- Payments (Phase 5) ---------------------------------------------------
  PAYMENT_CAPTURED: 'PAYMENT_CAPTURED',
  PAYMENT_POSTED: 'PAYMENT_POSTED',
  PAYMENT_VERIFIED: 'PAYMENT_VERIFIED',
  PAYMENT_REJECTED: 'PAYMENT_REJECTED',
  PAYMENT_REVERSED: 'PAYMENT_REVERSED',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

/** Entity types referenced by `audit_logs.entity_type`. */
export const AUDIT_ENTITIES = {
  USER: 'user',
  ROLE: 'role',
  SESSION: 'session',
  SETTING: 'setting',
  SERVICE_PLAN: 'service_plan',
  COLLECTION_AREA: 'collection_area',
  COLLECTION_BATCH: 'collection_batch',
  SUSPENSION: 'suspension',
  RECONNECTION: 'reconnection',
  BACKUP: 'backup',
  SUBSCRIBER: 'subscriber',
  SERVICE_ACCOUNT: 'service_account',
  BILLING_CYCLE: 'billing_cycle',
  INVOICE: 'invoice',
  ADJUSTMENT: 'adjustment',
  PAYMENT: 'payment',
  RECEIPT: 'receipt',
} as const;

export type AuditEntity = (typeof AUDIT_ENTITIES)[keyof typeof AUDIT_ENTITIES];
