import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { citext } from './helpers';
import { users } from './identity';

const id = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();

/**
 * Sessions and login attempts — §5.1 and §7 of the roadmap.
 *
 * ── WHY OPAQUE TOKENS RATHER THAN JWT ───────────────────────────────────────
 * A JWT is self-validating, which is exactly the problem: it cannot be revoked
 * before it expires. This system must be able to lock or revoke a workstation
 * the moment a supervisor says so, so the session lives in a row and the token
 * is a random opaque string.
 *
 * Only the SHA-256 of the token is stored. A database dump therefore does not
 * hand an attacker a set of usable sessions.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    /** SHA-256 (hex) of the opaque token. The token itself is never stored. */
    tokenHash: text('token_hash').notNull(),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * Session lock (§7). A locked session may call only the unlock endpoint,
     * enforced in the auth plugin — not by hiding a button. This is what makes
     * a cashier stepping away from the till safe without ending the session.
     */
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    /** Set on logout or forced revocation. A revoked session is never valid again. */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),

    ip: text('ip'),
    device: text('device'),
  },
  (table) => [
    uniqueIndex('uq_sessions_token_hash').on(table.tokenHash),
    index('ix_sessions_user').on(table.userId),
    index('ix_sessions_expires').on(table.expiresAt),
  ],
);

/**
 * Append-only record of every sign-in attempt.
 *
 * Kept separate from `audit_logs` because the volume is different: a brute-force
 * attempt writes one row per guess, and this table is what answers "what
 * happened before this account was locked". The lockout counter lives on
 * `users` so it can be read without aggregating this table on every login.
 */
export const loginAttempts = pgTable(
  'login_attempts',
  {
    id: id(),
    /** The username as typed, which may not correspond to any user. */
    username: citext('username').notNull(),
    /** Null when the username did not match an account. */
    userId: bigint('user_id', { mode: 'number' }).references(() => users.id, {
      onDelete: 'set null',
    }),
    success: boolean('success').notNull(),
    /** Machine-readable outcome, e.g. `INVALID_CREDENTIALS`, `ACCOUNT_LOCKED`. */
    reason: text('reason'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('ix_login_attempts_username').on(table.username),
    index('ix_login_attempts_created').on(table.createdAt),
    check('ck_login_attempts_reason', sql`${table.reason} IS NULL OR length(${table.reason}) > 0`),
  ],
);
