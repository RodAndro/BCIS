import { bigint, index, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { users } from './identity';

const id = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();

/**
 * Audit log — §5.9 of the roadmap.
 *
 * ── APPEND-ONLY, ENFORCED BY THE DATABASE ───────────────────────────────────
 * The migration adds a trigger that raises on UPDATE and DELETE. This is what
 * makes "posted records are immutable" a verifiable claim rather than a
 * convention: a reviewer can open psql and watch the trigger reject an UPDATE.
 *
 * `old_values` / `new_values` are JSONB snapshots. They intentionally store
 * only the fields that changed, and never a password hash.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    /** Null for events with no authenticated actor, e.g. a failed sign-in. */
    actorUserId: bigint('actor_user_id', { mode: 'number' }).references(() => users.id, {
      onDelete: 'set null',
    }),
    /** Stable verb, e.g. `LOGIN_SUCCEEDED`, `USER_ROLES_CHANGED`. */
    action: text('action').notNull(),
    /** The thing acted upon, e.g. `user`, `role`, `session`. */
    entityType: text('entity_type').notNull(),
    /** Id of the entity as text, so non-numeric entities can be recorded too. */
    entityId: text('entity_id'),
    /** Why, for the actions that require a reason (reversals, voids, overrides). */
    reason: text('reason'),
    oldValues: jsonb('old_values'),
    newValues: jsonb('new_values'),
    ip: text('ip'),
    sessionId: bigint('session_id', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('ix_audit_actor').on(table.actorUserId),
    index('ix_audit_entity').on(table.entityType, table.entityId),
    index('ix_audit_action').on(table.action),
    index('ix_audit_created').on(table.createdAt),
  ],
);

export const backupHistory = pgTable(
  'backup_history',
  {
    id: id(),
    backupId: text('backup_id').notNull(),
    backupPath: text('backup_path').notNull(),
    attachmentManifestPath: text('attachment_manifest_path').notNull(),
    status: text('status').notNull().default('STARTED'),
    byteSize: bigint('byte_size', { mode: 'number' }).notNull().default(0),
    sha256: text('sha256'),
    createdBy: bigint('created_by', { mode: 'number' }).references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verificationNotes: text('verification_notes'),
  },
  (table) => [
    uniqueIndex('uq_backup_history_backup_id').on(table.backupId),
    index('ix_backup_history_created').on(table.createdAt),
    index('ix_backup_history_status').on(table.status),
    index('ix_backup_history_sha256').on(table.sha256),
  ],
);
