import { schema } from '@bcis/database';
import type { Permission, RoleCode } from '@bcis/shared';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';

import type { Executor } from '../../shared/database';

/**
 * Queries for authentication.
 *
 * Drizzle only — no business rules, no HTTP, no error construction. The service
 * decides what a result means; this file only fetches it.
 */

export type UserStatus = 'ACTIVE' | 'LOCKED' | 'DISABLED';

/** The user fields authentication needs. Never includes anything derived. */
export interface AuthUserRow {
  readonly id: number;
  readonly username: string;
  readonly passwordHash: string;
  readonly fullName: string;
  readonly status: UserStatus;
  readonly mustChangePassword: boolean;
  readonly failedLoginCount: number;
  readonly lockedUntil: Date | null;
  readonly lastLoginAt: Date | null;
}

export interface SessionRow {
  readonly id: number;
  readonly userId: number;
  readonly expiresAt: Date;
  readonly lockedAt: Date | null;
  readonly revokedAt: Date | null;
}

export interface GrantSet {
  readonly roles: readonly RoleCode[];
  readonly permissions: readonly Permission[];
}

function toAuthUserRow(row: typeof schema.users.$inferSelect): AuthUserRow {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.passwordHash,
    fullName: row.fullName,
    status: row.status as UserStatus,
    mustChangePassword: row.mustChangePassword,
    failedLoginCount: row.failedLoginCount,
    lockedUntil: row.lockedUntil,
    lastLoginAt: row.lastLoginAt,
  };
}

function toSessionRow(row: typeof schema.sessions.$inferSelect): SessionRow {
  return {
    id: row.id,
    userId: row.userId,
    expiresAt: row.expiresAt,
    lockedAt: row.lockedAt,
    revokedAt: row.revokedAt,
  };
}

/**
 * Find a user by username.
 *
 * `users.username` is `citext`, so this comparison is case-insensitive without
 * the application lowercasing anything.
 */
export async function findUserByUsername(
  db: Executor,
  username: string,
): Promise<AuthUserRow | null> {
  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.username, username))
    .limit(1);

  const row = rows[0];
  return row === undefined ? null : toAuthUserRow(row);
}

export async function findUserById(db: Executor, userId: number): Promise<AuthUserRow | null> {
  const rows = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  const row = rows[0];
  return row === undefined ? null : toAuthUserRow(row);
}

/**
 * Every role and permission a user holds, resolved through the RBAC graph.
 *
 * One query rather than three: the joins are on primary keys and the result set
 * is small (a user holds a handful of roles), so a round trip per level would
 * be pure latency.
 */
export async function loadGrants(db: Executor, userId: number): Promise<GrantSet> {
  const rows = await db
    .select({
      roleCode: schema.roles.code,
      permissionCode: schema.permissions.code,
    })
    .from(schema.userRoles)
    .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
    .leftJoin(schema.rolePermissions, eq(schema.rolePermissions.roleId, schema.roles.id))
    .leftJoin(schema.permissions, eq(schema.rolePermissions.permissionId, schema.permissions.id))
    .where(eq(schema.userRoles.userId, userId));

  const roles = new Set<RoleCode>();
  const permissions = new Set<Permission>();

  for (const row of rows) {
    roles.add(row.roleCode as RoleCode);
    // Null when the role holds no permissions at all, which is a valid state.
    if (row.permissionCode !== null) {
      permissions.add(row.permissionCode as Permission);
    }
  }

  return { roles: [...roles], permissions: [...permissions] };
}

/**
 * Resolve an opaque session token hash to a live session and its user.
 *
 * Revoked and expired sessions are excluded here rather than filtered by the
 * caller, so there is exactly one definition of "usable session" in the
 * codebase.
 */
export async function findUsableSessionByTokenHash(
  db: Executor,
  tokenHash: string,
): Promise<{ session: SessionRow; user: AuthUserRow } | null> {
  const rows = await db
    .select({ session: schema.sessions, user: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
    .where(
      and(
        eq(schema.sessions.tokenHash, tokenHash),
        isNull(schema.sessions.revokedAt),
        sql`${schema.sessions.expiresAt} > now()`,
      ),
    )
    .limit(1);

  const row = rows[0];
  if (row === undefined) return null;

  return { session: toSessionRow(row.session), user: toAuthUserRow(row.user) };
}

export async function insertSession(
  db: Executor,
  input: {
    readonly tokenHash: string;
    readonly userId: number;
    readonly expiresAt: Date;
    readonly ip: string | null;
    readonly device: string | null;
  },
): Promise<number> {
  const rows = await db
    .insert(schema.sessions)
    .values({
      tokenHash: input.tokenHash,
      userId: input.userId,
      expiresAt: input.expiresAt,
      ip: input.ip,
      device: input.device,
    })
    .returning({ id: schema.sessions.id });

  const id = rows[0]?.id;
  if (id === undefined) throw new Error('Inserting a session returned no id.');
  return id;
}

/**
 * Record that a session was seen.
 *
 * ── WHY THIS IS CONDITIONAL ─────────────────────────────────────────────────
 * Updating on every request would mean a write for every API call — three
 * workstations polling a list is far more writes than the information is worth.
 * The staleness window is five minutes, which is precise enough for "who is
 * signed in" and costs one write per five minutes per session.
 */
export async function touchSession(db: Executor, sessionId: number, at: Date): Promise<void> {
  await db
    .update(schema.sessions)
    .set({ lastSeenAt: at })
    .where(
      and(
        eq(schema.sessions.id, sessionId),
        lt(schema.sessions.lastSeenAt, sql`now() - interval '5 minutes'`),
      ),
    );
}

export async function revokeSession(
  db: Executor,
  sessionId: number,
  reason: string,
): Promise<void> {
  await db
    .update(schema.sessions)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(eq(schema.sessions.id, sessionId), isNull(schema.sessions.revokedAt)));
}

export async function setSessionLocked(
  db: Executor,
  sessionId: number,
  locked: boolean,
): Promise<void> {
  await db
    .update(schema.sessions)
    .set({ lockedAt: locked ? new Date() : null })
    .where(and(eq(schema.sessions.id, sessionId), isNull(schema.sessions.revokedAt)));
}

/** Reset the failure counter and stamp the successful sign-in. */
export async function markLoginSucceeded(db: Executor, userId: number, at: Date): Promise<void> {
  await db
    .update(schema.users)
    .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: at, updatedAt: at })
    .where(eq(schema.users.id, userId));
}

export async function markLoginFailed(
  db: Executor,
  userId: number,
  input: { readonly failedLoginCount: number; readonly lockedUntil: Date | null },
): Promise<void> {
  await db
    .update(schema.users)
    .set({
      failedLoginCount: input.failedLoginCount,
      lockedUntil: input.lockedUntil,
      updatedAt: new Date(),
    })
    .where(eq(schema.users.id, userId));
}

export async function insertLoginAttempt(
  db: Executor,
  input: {
    readonly username: string;
    readonly userId: number | null;
    readonly success: boolean;
    readonly reason: string | null;
    readonly ip: string | null;
    readonly userAgent: string | null;
  },
): Promise<void> {
  await db.insert(schema.loginAttempts).values({
    username: input.username,
    userId: input.userId,
    success: input.success,
    reason: input.reason,
    ip: input.ip,
    userAgent: input.userAgent,
  });
}

export async function updatePasswordHash(
  db: Executor,
  userId: number,
  passwordHash: string,
  mustChangePassword: boolean,
): Promise<void> {
  await db
    .update(schema.users)
    .set({ passwordHash, mustChangePassword, updatedAt: new Date() })
    .where(eq(schema.users.id, userId));
}

/** Revoke every other live session — used after a password change. */
export async function revokeOtherSessions(
  db: Executor,
  userId: number,
  keepSessionId: number,
  reason: string,
): Promise<number> {
  const rows = await db
    .update(schema.sessions)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(
      and(
        eq(schema.sessions.userId, userId),
        isNull(schema.sessions.revokedAt),
        sql`${schema.sessions.id} <> ${keepSessionId}`,
      ),
    )
    .returning({ id: schema.sessions.id });

  return rows.length;
}
