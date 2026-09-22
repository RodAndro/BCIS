import { ConflictError, NotFoundError, ValidationError } from '@bcis/shared';
import type { RoleCode } from '@bcis/shared';
import type { PermissionSummary, RoleSummary, SetRolePermissionsInput } from '@bcis/validation';

import type { Db } from '../../shared/database';
import type { ActorContext } from '../../shared/request-context';
import { AUDIT_ACTIONS, AUDIT_ENTITIES } from '../audit/audit.actions';
import { writeAudit } from '../audit/audit.service';
import * as repository from './rbac.repository';

/**
 * Role and permission administration.
 *
 * ── THE ONE GUARD THAT MATTERS ──────────────────────────────────────────────
 * The Owner role must always hold every permission. It is the account that
 * performs user administration, configuration, and restore; stripping a
 * permission from it is how a system becomes unadministrable through its own
 * interface, with no route back.
 */

export async function listRoles(db: Db): Promise<readonly RoleSummary[]> {
  const rows = await repository.listRoles(db);

  return rows.map((row) => ({
    code: row.code,
    name: row.name,
    description: row.description,
    isSystem: row.isSystem,
    userCount: row.userCount,
    permissions: [...row.permissions].sort(),
  }));
}

export async function listPermissions(db: Db): Promise<readonly PermissionSummary[]> {
  const rows = await repository.listPermissions(db);
  return rows.map((row) => ({
    code: row.code,
    category: row.category,
    description: row.description,
  }));
}

export async function setRolePermissions(
  db: Db,
  roleCode: RoleCode,
  input: SetRolePermissionsInput,
  actor: ActorContext,
): Promise<RoleSummary> {
  const roleId = await repository.findRoleIdByCode(db, roleCode);
  if (roleId === null) {
    throw new NotFoundError('That role does not exist.');
  }

  const totalPermissions = await repository.countPermissions(db);

  if (roleCode === 'OWNER' && input.permissions.length !== totalPermissions) {
    throw new ConflictError(
      'The Owner role always holds every permission. Grant the permission to another role instead.',
    );
  }

  const permissionIds = await repository.findPermissionIdsByCodes(db, input.permissions);

  const unknown = input.permissions.filter((code) => !permissionIds.has(code));
  if (unknown.length > 0) {
    throw new ValidationError(`Unknown permission: ${unknown.join(', ')}.`, {
      field: 'permissions',
    });
  }

  const before = await repository.listPermissionCodesForRole(db, roleId);
  const activeHolders = await repository.countRoleHolders(db, roleId);

  await db.transaction(async (tx) => {
    await repository.replaceRolePermissions(tx, roleId, [...permissionIds.values()]);

    await writeAudit(tx, {
      action: AUDIT_ACTIONS.ROLE_PERMISSIONS_CHANGED,
      entityType: AUDIT_ENTITIES.ROLE,
      entityId: String(roleId),
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ip: actor.ip,
      reason: input.reason ?? null,
      oldValues: { permissions: before },
      // The audit records how many active holders the change affects, because
      // "who noticed this?" is the question asked after a permissions mistake.
      newValues: { permissions: [...input.permissions].sort(), activeHolders },
    });
  });

  const roles = await listRoles(db);
  const updated = roles.find((role) => role.code === roleCode);
  if (updated === undefined) {
    throw new NotFoundError('That role does not exist.');
  }
  return updated;
}
