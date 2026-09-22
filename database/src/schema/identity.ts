import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { citext } from './helpers';

/**
 * Identity and access — §5.1 of the roadmap.
 *
 * Five tables model the whole RBAC graph. The design point worth stating:
 * authorization reads `user_roles → role_permissions → permissions` on every
 * request. A user may hold more than one role, and a role holds any number of
 * permissions, so a workstation that needs both "Cashier" and "Technician"
 * duties is a data change rather than a code change.
 */

/** Primary keys are identity columns so the database, not the app, assigns ids. */
const id = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();

export const users = pgTable(
  'users',
  {
    id: id(),
    /**
     * `citext` so "cashier1", "Cashier1", and "CASHIER1" are one account.
     * Lowercasing in application code fails the moment a row is inserted by a
     * seed or a migration and then two accounts exist that the app believes
     * are one.
     */
    username: citext('username').notNull(),
    /** Argon2id hash. A plaintext password never reaches this column. */
    passwordHash: text('password_hash').notNull(),
    fullName: text('full_name').notNull(),
    /**
     * ACTIVE  — may sign in.
     * LOCKED  — administratively locked, or locked by repeated failed logins.
     * DISABLED— deactivated. The account is kept for history and audit.
     *
     * Values use CHECK ... IN rather than a native enum: a new state costs a
     * one-line migration instead of an enum alteration.
     */
    status: text('status').notNull().default('ACTIVE'),
    /** Forces a password change on next sign-in. True for seeded accounts. */
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    /** Consecutive failures since the last success. Reset on a successful login. */
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    /** When set and in the future, sign-in is refused until it passes. */
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: bigint('created_by', { mode: 'number' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: bigint('updated_by', { mode: 'number' }),
  },
  (table) => [
    uniqueIndex('uq_users_username').on(table.username),
    index('ix_users_status').on(table.status),
    check('ck_users_status', sql`${table.status} IN ('ACTIVE', 'LOCKED', 'DISABLED')`),
    check('ck_users_failed_login_count', sql`${table.failedLoginCount} >= 0`),
  ],
);

export const roles = pgTable(
  'roles',
  {
    id: id(),
    /** Stable machine code, e.g. `CASHIER`. Referenced by `ROLE_CODES` in @bcis/shared. */
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    /** System roles are seeded and should not be deleted; they may still be edited. */
    isSystem: boolean('is_system').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('uq_roles_code').on(table.code)],
);

export const permissions = pgTable(
  'permissions',
  {
    id: id(),
    /** e.g. `payment.reverse`. The unit the API guard checks. */
    code: text('code').notNull(),
    /** Grouping for the role editor, e.g. `payments`. */
    category: text('category').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_permissions_code').on(table.code),
    index('ix_permissions_category').on(table.category),
  ],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: bigint('role_id', { mode: 'number' })
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: bigint('permission_id', { mode: 'number' })
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.roleId, table.permissionId] }),
    index('ix_role_permissions_role').on(table.roleId),
  ],
);

export const userRoles = pgTable(
  'user_roles',
  {
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: bigint('role_id', { mode: 'number' })
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
    assignedBy: bigint('assigned_by', { mode: 'number' }),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.roleId] }),
    index('ix_user_roles_user').on(table.userId),
  ],
);
