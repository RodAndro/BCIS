import { schema } from '@bcis/database';
import type { Permission, RoleCode } from '@bcis/shared';
import { and, asc, count, eq, inArray } from 'drizzle-orm';

import type { Executor } from '../../shared/database';

/**
 * Role and permission queries.
 *
 * The permission codes are seeded from `@bcis/shared`, so the API guard and
 * this table cannot disagree about what a permission is called.
 */

export interface PermissionRow {
  readonly code: Permission;
  readonly category: string;
  readonly description: string | null;
}

export interface RoleRow {
  readonly code: RoleCode;
  readonly name: string;
  readonly description: string | null;
  readonly isSystem: boolean;
  readonly permissions: readonly Permission[];
  readonly userCount: number;
}

export async function listPermissions(db: Executor): Promise<readonly PermissionRow[]> {
  const rows = await db
    .select({
      code: schema.permissions.code,
      category: schema.permissions.category,
      description: schema.permissions.description,
    })
    .from(schema.permissions)
    .orderBy(asc(schema.permissions.category), asc(schema.permissions.code));

  return rows.map((row) => ({
    code: row.code as Permission,
    category: row.category,
    description: row.description,
  }));
}

/**
 * Every role with its permissions and how many users hold it.
 *
 * Three queries rather than one join: a join across roles × permissions × users
 * multiplies rows, and the de-duplication that follows is both slower and
 * easier to get wrong than three indexed reads assembled in memory.
 */
export async function listRoles(db: Executor): Promise<readonly RoleRow[]> {
  const roles = await db
    .select({
      id: schema.roles.id,
      code: schema.roles.code,
      name: schema.roles.name,
      description: schema.roles.description,
      isSystem: schema.roles.isSystem,
    })
    .from(schema.roles)
    .orderBy(asc(schema.roles.code));

  const grants = await db
    .select({ roleId: schema.rolePermissions.roleId, code: schema.permissions.code })
    .from(schema.rolePermissions)
    .innerJoin(schema.permissions, eq(schema.rolePermissions.permissionId, schema.permissions.id));

  const userCounts = await db
    .select({ roleId: schema.userRoles.roleId, total: count() })
    .from(schema.userRoles)
    .groupBy(schema.userRoles.roleId);

  const permissionsByRole = new Map<number, Permission[]>();
  for (const grant of grants) {
    const existing = permissionsByRole.get(grant.roleId);
    if (existing === undefined) {
      permissionsByRole.set(grant.roleId, [grant.code as Permission]);
    } else {
      existing.push(grant.code as Permission);
    }
  }

  const usersByRole = new Map<number, number>();
  for (const row of userCounts) {
    usersByRole.set(row.roleId, row.total);
  }

  return roles.map((role) => ({
    code: role.code as RoleCode,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    permissions: permissionsByRole.get(role.id) ?? [],
    userCount: usersByRole.get(role.id) ?? 0,
  }));
}

export async function findRoleIdByCode(db: Executor, code: RoleCode): Promise<number | null> {
  const rows = await db
    .select({ id: schema.roles.id })
    .from(schema.roles)
    .where(eq(schema.roles.code, code))
    .limit(1);

  return rows[0]?.id ?? null;
}

export async function findPermissionIdsByCodes(
  db: Executor,
  codes: readonly Permission[],
): Promise<Map<Permission, number>> {
  const result = new Map<Permission, number>();
  if (codes.length === 0) return result;

  const rows = await db
    .select({ id: schema.permissions.id, code: schema.permissions.code })
    .from(schema.permissions)
    .where(inArray(schema.permissions.code, [...codes]));

  for (const row of rows) {
    result.set(row.code as Permission, row.id);
  }
  return result;
}

export async function countPermissions(db: Executor): Promise<number> {
  const rows = await db.select({ total: count() }).from(schema.permissions);
  return rows[0]?.total ?? 0;
}

/** Replace a role's permission set wholesale. */
export async function replaceRolePermissions(
  db: Executor,
  roleId: number,
  permissionIds: readonly number[],
): Promise<void> {
  await db.delete(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, roleId));

  if (permissionIds.length > 0) {
    await db
      .insert(schema.rolePermissions)
      .values(permissionIds.map((permissionId) => ({ roleId, permissionId })));
  }
}

/** How many active users hold a role — used to describe the effect of a change. */
export async function countRoleHolders(db: Executor, roleId: number): Promise<number> {
  const rows = await db
    .select({ total: count() })
    .from(schema.userRoles)
    .innerJoin(schema.users, eq(schema.userRoles.userId, schema.users.id))
    .where(and(eq(schema.userRoles.roleId, roleId), eq(schema.users.status, 'ACTIVE')));

  return rows[0]?.total ?? 0;
}

/** The permission codes a role currently holds, for the audit "before" snapshot. */
export async function listPermissionCodesForRole(
  db: Executor,
  roleId: number,
): Promise<readonly Permission[]> {
  const rows = await db
    .select({ code: schema.permissions.code })
    .from(schema.rolePermissions)
    .innerJoin(schema.permissions, eq(schema.rolePermissions.permissionId, schema.permissions.id))
    .where(eq(schema.rolePermissions.roleId, roleId));

  return rows.map((row) => row.code as Permission).sort();
}
