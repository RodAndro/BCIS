import { schema } from '@bcis/database';
import type { RoleCode } from '@bcis/shared';
import type { UserListQuery } from '@bcis/validation';
import { and, asc, count, eq, ilike, inArray, isNull, ne, or, type SQL } from 'drizzle-orm';

import type { Executor } from '../../shared/database';

/**
 * User administration queries.
 *
 * ── WHY FILTERING AND ROW-LEVEL WORK HAPPEN HERE ────────────────────────────
 * The user list is paginated in SQL. Loading every user and filtering in the
 * renderer would be fine for four accounts and wrong for four hundred, and the
 * wiring that hides that difference is exactly what does not survive a
 * deployment.
 */

export type UserStatus = 'ACTIVE' | 'LOCKED' | 'DISABLED';

export interface UserAdminRow {
  readonly id: number;
  readonly username: string;
  readonly fullName: string;
  readonly status: UserStatus;
  readonly mustChangePassword: boolean;
  readonly lockedUntil: Date | null;
  readonly lastLoginAt: Date | null;
  readonly createdAt: Date;
  readonly roles: readonly RoleCode[];
}

function buildUserFilters(db: Executor, query: UserListQuery): SQL | undefined {
  const conditions: SQL[] = [];

  if (query.search !== undefined && query.search.length > 0) {
    const pattern = `%${query.search}%`;
    // Username and display name, so a supervisor can search by either.
    const search = or(ilike(schema.users.username, pattern), ilike(schema.users.fullName, pattern));
    if (search !== undefined) conditions.push(search);
  }

  if (query.status !== undefined) {
    conditions.push(eq(schema.users.status, query.status));
  }

  if (query.role !== undefined) {
    // Membership test as a subquery rather than a join, so a user holding
    // several roles is not duplicated in the result.
    conditions.push(
      inArray(
        schema.users.id,
        db
          .select({ userId: schema.userRoles.userId })
          .from(schema.userRoles)
          .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
          .where(eq(schema.roles.code, query.role)),
      ),
    );
  }

  if (conditions.length === 0) return undefined;
  return and(...conditions);
}

/** Roles for a set of users, in one query rather than one per row. */
async function loadRolesByUser(
  db: Executor,
  userIds: readonly number[],
): Promise<Map<number, RoleCode[]>> {
  const grouped = new Map<number, RoleCode[]>();
  if (userIds.length === 0) return grouped;

  const rows = await db
    .select({ userId: schema.userRoles.userId, roleCode: schema.roles.code })
    .from(schema.userRoles)
    .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
    .where(inArray(schema.userRoles.userId, [...userIds]));

  for (const row of rows) {
    const existing = grouped.get(row.userId);
    if (existing === undefined) {
      grouped.set(row.userId, [row.roleCode as RoleCode]);
    } else {
      existing.push(row.roleCode as RoleCode);
    }
  }

  return grouped;
}

export async function listUsers(
  db: Executor,
  query: UserListQuery,
  offset: number,
): Promise<readonly UserAdminRow[]> {
  const rows = await db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      fullName: schema.users.fullName,
      status: schema.users.status,
      mustChangePassword: schema.users.mustChangePassword,
      lockedUntil: schema.users.lockedUntil,
      lastLoginAt: schema.users.lastLoginAt,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users)
    .where(buildUserFilters(db, query))
    .orderBy(asc(schema.users.username))
    .limit(query.pageSize)
    .offset(offset);

  const rolesByUser = await loadRolesByUser(
    db,
    rows.map((row) => row.id),
  );

  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    fullName: row.fullName,
    status: row.status as UserStatus,
    mustChangePassword: row.mustChangePassword,
    lockedUntil: row.lockedUntil,
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt,
    roles: rolesByUser.get(row.id) ?? [],
  }));
}

export async function countUsers(db: Executor, query: UserListQuery): Promise<number> {
  const rows = await db
    .select({ total: count() })
    .from(schema.users)
    .where(buildUserFilters(db, query));

  return rows[0]?.total ?? 0;
}

export async function findRoleIdsByCodes(
  db: Executor,
  codes: readonly RoleCode[],
): Promise<Map<RoleCode, number>> {
  const result = new Map<RoleCode, number>();
  if (codes.length === 0) return result;

  const rows = await db
    .select({ id: schema.roles.id, code: schema.roles.code })
    .from(schema.roles)
    .where(inArray(schema.roles.code, [...codes]));

  for (const row of rows) {
    result.set(row.code as RoleCode, row.id);
  }
  return result;
}

export async function insertUser(
  db: Executor,
  input: {
    readonly username: string;
    readonly fullName: string;
    readonly passwordHash: string;
    readonly mustChangePassword: boolean;
    readonly createdBy: number | null;
  },
): Promise<number> {
  const rows = await db
    .insert(schema.users)
    .values({
      username: input.username,
      fullName: input.fullName,
      passwordHash: input.passwordHash,
      mustChangePassword: input.mustChangePassword,
      createdBy: input.createdBy,
      updatedBy: input.createdBy,
    })
    .returning({ id: schema.users.id });

  const id = rows[0]?.id;
  if (id === undefined) throw new Error('Inserting a user returned no id.');
  return id;
}

export async function replaceUserRoles(
  db: Executor,
  userId: number,
  roleIds: readonly number[],
  assignedBy: number | null,
): Promise<void> {
  await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, userId));

  if (roleIds.length > 0) {
    await db
      .insert(schema.userRoles)
      .values(roleIds.map((roleId) => ({ userId, roleId, assignedBy })));
  }
}

export async function updateUserProfile(
  db: Executor,
  userId: number,
  input: { readonly fullName: string; readonly updatedBy: number | null },
): Promise<void> {
  await db
    .update(schema.users)
    .set({ fullName: input.fullName, updatedAt: new Date(), updatedBy: input.updatedBy })
    .where(eq(schema.users.id, userId));
}

/**
 * Change account status.
 *
 * Setting a user ACTIVE clears `lockedUntil`, because otherwise a user
 * reactivated after a failed-login lockout would still be refused until the
 * lock expired — which reads as "the administrator's action did nothing".
 */
export async function updateUserStatus(
  db: Executor,
  userId: number,
  status: UserStatus,
  updatedBy: number | null,
): Promise<void> {
  // Built conditionally rather than with `undefined` sentinels: a sparse patch
  // is unambiguous, whereas an explicit `undefined` relies on the query
  // builder's treatment of it.
  const patch: Partial<typeof schema.users.$inferInsert> = {
    status,
    failedLoginCount: 0,
    updatedAt: new Date(),
    updatedBy,
  };
  if (status === 'ACTIVE') {
    patch.lockedUntil = null;
  }

  await db.update(schema.users).set(patch).where(eq(schema.users.id, userId));
}

export async function setUserPassword(
  db: Executor,
  userId: number,
  passwordHash: string,
  mustChangePassword: boolean,
  updatedBy: number | null,
): Promise<void> {
  await db
    .update(schema.users)
    .set({ passwordHash, mustChangePassword, updatedAt: new Date(), updatedBy })
    .where(eq(schema.users.id, userId));
}

/** Revoke every live session for a user — used when disabling or resetting. */
export async function revokeAllSessions(
  db: Executor,
  userId: number,
  reason: string,
): Promise<void> {
  await db
    .update(schema.sessions)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt)));
}

/**
 * How many OTHER active users hold the Owner role.
 *
 * The last active Owner must not be disabled or have the role removed — a
 * system with nobody who can administer it is unrecoverable through the UI, and
 * the mistake is easy to make on a small user list.
 */
export async function countOtherActiveOwners(db: Executor, userId: number): Promise<number> {
  const rows = await db
    .select({ total: count() })
    .from(schema.users)
    .innerJoin(schema.userRoles, eq(schema.userRoles.userId, schema.users.id))
    .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
    .where(
      and(
        eq(schema.roles.code, 'OWNER'),
        eq(schema.users.status, 'ACTIVE'),
        ne(schema.users.id, userId),
      ),
    );

  return rows[0]?.total ?? 0;
}

/** Whether a username is already taken, for a friendly error before insert. */
export async function usernameExists(db: Executor, username: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.username, username))
    .limit(1);

  return rows.length > 0;
}

/** One user with roles, for the response to a create or update. */
export async function findUserAdminById(
  db: Executor,
  userId: number,
): Promise<UserAdminRow | null> {
  const rows = await db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      fullName: schema.users.fullName,
      status: schema.users.status,
      mustChangePassword: schema.users.mustChangePassword,
      lockedUntil: schema.users.lockedUntil,
      lastLoginAt: schema.users.lastLoginAt,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  const row = rows[0];
  if (row === undefined) return null;

  const rolesByUser = await loadRolesByUser(db, [row.id]);

  return {
    id: row.id,
    username: row.username,
    fullName: row.fullName,
    status: row.status as UserStatus,
    mustChangePassword: row.mustChangePassword,
    lockedUntil: row.lockedUntil,
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt,
    roles: rolesByUser.get(row.id) ?? [],
  };
}
