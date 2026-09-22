/**
 * Drizzle schema — the source that `pnpm db:generate` reads.
 *
 * ── AUTHORING RULE ──────────────────────────────────────────────────────────
 * Tables are authored here in TypeScript and the SQL in
 * `database/migrations/` is generated from it. When a migration needs
 * something the generator cannot express — a trigger, for example — the SQL is
 * appended to the generated file and this schema is left alone, because
 * Drizzle does not track triggers and would try to "fix" a hand-written one.
 *
 * ── CONVENTIONS ─────────────────────────────────────────────────────────────
 *   - Primary keys:   bigint identity
 *   - Money:          bigint *_centavos (mode: 'number'), never numeric/real
 *   - Instants:       timestamp with time zone
 *   - Calendar dates: date, interpreted in Asia/Manila (@bcis/shared/time)
 *   - Names:          written out explicitly in snake_case
 *   - History:        never hard-deleted; use status, voided_at, archived_at
 */

export { applicationSettings } from './settings';
export { auditLogs, backupHistory } from './audit';
export { adjustments, billingCycles, invoiceItems, invoices } from './billing';
export { collectionAreas, documentSequences, servicePlans, serviceTypes } from './catalog';
export {
  collectionAssignments,
  collectionBatchAccounts,
  collectionBatches,
  collectionReconciliations,
  collectorRemittances,
} from './collections';
export { permissions, rolePermissions, roles, userRoles, users } from './identity';
export { ledgerEntries } from './ledger';
export {
  paymentAllocations,
  paymentProofs,
  paymentReversals,
  payments,
  receipts,
} from './payments';
export {
  reconnectionRecords,
  serviceAccounts,
  serviceEvents,
  suspensionRecords,
} from './service-accounts';
export { loginAttempts, sessions } from './sessions';
export { subscriberAddresses, subscriberContacts, subscribers } from './subscribers';
