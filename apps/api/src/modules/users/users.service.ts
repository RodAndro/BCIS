import { generateTemporaryPassword, hashPassword } from '@bcis/security';
import { ConflictError, NotFoundError, ValidationError } from '@bcis/shared';
import type { RoleCode } from '@bcis/shared';
import {
  offsetFor,
  type CreateUserInput,
  type SetUserStatusInput,
  type UpdateUserInput,
  type UserListQuery,
  type UserSummary,
} from '@bcis/validation';

import type { Db } from '../../shared/database';
import type { ActorContext } from '../../shared/request-context';
import { AUDIT_ACTIONS, AUDIT_ENTITIES } from '../audit/audit.actions';
import { writeAudit } from '../audit/audit.service';
import { toUserSummary } from './users.mapper';
import * as repository from './users.repository';

/**
 * User administration.
 *
 * ── EVERY FUNCTION HERE IS A PRIVILEGE CHANGE ───────────────────────────────
 * Each one writes an audit record inside the same transaction as the change, so
 * "who created this account and with which roles" is answerable. The two
 * integrity guards — a unique username, and never removing the last active
 * Owner — are enforced here and by the database respectively; see the comments
 * on each.
 */

export interface UserPage {
  readonly users: readonly UserSummary[];
  readonly total: number;
}

export async function listUsers(db: Db, query: UserListQuery): Promise<UserPage> {
  const offset = offsetFor(query.page, query.pageSize);

  const [rows, total] = await Promise.all([
    repository.listUsers(db, query, offset),
    repository.countUsers(db, query),
  ]);

  return { users: rows.map((row) => toUserSummary(row)), total };
}

export async function getUser(db: Db, userId: number): Promise<UserSummary> {
  const row = await repository.findUserAdminById(db, userId);
  if (row === null) {
    throw new NotFoundError('That user does not exist.');
  }
  return toUserSummary(row);
}

/**
 * Create a user.
 *
 * The username uniqueness check here produces a clear error message; the unique
 * index is what actually guarantees it under concurrency. Both are needed: the
 * index for correctness, this for a message a person can act on.
 */
export async function createUser(
  db: Db,
  input: CreateUserInput,
  actor: ActorContext,
): Promise<UserSummary> {
  if (await repository.usernameExists(db, input.username)) {
    throw new ConflictError('That username is already taken.');
  }

  const roleIds = await resolveRoleIds(db, input.roles);
  const passwordHash = await hashPassword(input.password);

  const userId = await db.transaction(async (tx) => {
    const id = await repository.insertUser(tx, {
      username: input.username,
      fullName: input.fullName,
      passwordHash,
      mustChangePassword: false,
      createdBy: actor.userId,
    });

    await repository.replaceUserRoles(tx, id, roleIds, actor.userId);
    await writeAudit(tx, {
      action: AUDIT_ACTIONS.USER_CREATED,
      entityType: AUDIT_ENTITIES.USER,
      entityId: String(id),
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ip: actor.ip,
      // The password and its hash are never part of a snapshot.
      newValues: {
        username: input.username,
        fullName: input.fullName,
        roles: input.roles,
      },
    });

    return id;
  });

  return getUser(db, userId);
}

/** Update the display name and role assignment. */
export async function updateUser(
  db: Db,
  userId: number,
  input: UpdateUserInput,
  actor: ActorContext,
): Promise<UserSummary> {
  const existing = await repository.findUserAdminById(db, userId);
  if (existing === null) {
    throw new NotFoundError('That user does not exist.');
  }

  const wasOwner = existing.roles.includes('OWNER');
  const willBeOwner = input.roles.includes('OWNER');

  if (wasOwner && !willBeOwner) {
    await assertAnotherActiveOwnerExists(db, userId);
  }

  const roleIds = await resolveRoleIds(db, input.roles);

  await db.transaction(async (tx) => {
    await repository.updateUserProfile(tx, userId, {
      fullName: input.fullName,
      updatedBy: actor.userId,
    });
    await repository.replaceUserRoles(tx, userId, roleIds, actor.userId);

    await writeAudit(tx, {
      action: AUDIT_ACTIONS.USER_UPDATED,
      entityType: AUDIT_ENTITIES.USER,
      entityId: String(userId),
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ip: actor.ip,
      oldValues: { fullName: existing.fullName, roles: existing.roles },
      newValues: { fullName: input.fullName, roles: input.roles },
    });
  });

  return getUser(db, userId);
}

/**
 * Lock, disable, or reactivate an account.
 *
 * Disabling or locking also revokes every live session: leaving a disabled
 * user's session valid until it expires would mean the account is disabled on
 * paper and still working at the till.
 */
export async function setUserStatus(
  db: Db,
  userId: number,
  input: SetUserStatusInput,
  actor: ActorContext,
): Promise<UserSummary> {
  const existing = await repository.findUserAdminById(db, userId);
  if (existing === null) {
    throw new NotFoundError('That user does not exist.');
  }

  if (input.status !== 'ACTIVE' && existing.roles.includes('OWNER')) {
    await assertAnotherActiveOwnerExists(db, userId);
  }

  await db.transaction(async (tx) => {
    await repository.updateUserStatus(tx, userId, input.status, actor.userId);

    if (input.status !== 'ACTIVE') {
      await repository.revokeAllSessions(
        tx,
        userId,
        input.status === 'DISABLED' ? 'ACCOUNT_DISABLED' : 'ACCOUNT_LOCKED',
      );
    }

    await writeAudit(tx, {
      action: AUDIT_ACTIONS.USER_STATUS_CHANGED,
      entityType: AUDIT_ENTITIES.USER,
      entityId: String(userId),
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ip: actor.ip,
      reason: input.reason ?? null,
      oldValues: { status: existing.status },
      newValues: { status: input.status },
    });
  });

  return getUser(db, userId);
}

/**
 * Reset a user's password.
 *
 * The generated password is returned once so the administrator can hand it over.
 * It is never logged and never stored in plaintext; the account is flagged
 * `mustChangePassword`, so this value cannot become the password in use.
 */
export async function resetUserPassword(
  db: Db,
  userId: number,
  actor: ActorContext,
): Promise<{ user: UserSummary; temporaryPassword: string }> {
  const existing = await repository.findUserAdminById(db, userId);
  if (existing === null) {
    throw new NotFoundError('That user does not exist.');
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  await db.transaction(async (tx) => {
    await repository.setUserPassword(tx, userId, passwordHash, true, actor.userId);
    await repository.revokeAllSessions(tx, userId, 'PASSWORD_RESET');

    await writeAudit(tx, {
      action: AUDIT_ACTIONS.USER_PASSWORD_RESET,
      entityType: AUDIT_ENTITIES.USER,
      entityId: String(userId),
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ip: actor.ip,
      // A newValues snapshot that is deliberately empty: there is nothing about
      // this operation that belongs in the log beyond the fact that it happened.
    });
  });

  return { user: await getUser(db, userId), temporaryPassword };
}

/** Turn role codes into ids, rejecting a code the database does not know. */
async function resolveRoleIds(db: Db, codes: readonly RoleCode[]): Promise<number[]> {
  const byCode = await repository.findRoleIdsByCodes(db, codes);

  const missing = codes.filter((code) => !byCode.has(code));
  if (missing.length > 0) {
    throw new ValidationError(`Unknown role: ${missing.join(', ')}.`, { field: 'roles' });
  }

  return codes.map((code) => {
    const id = byCode.get(code);
    if (id === undefined) throw new ValidationError(`Unknown role: ${code}.`, { field: 'roles' });
    return id;
  });
}

/**
 * Refuse an operation that would leave nobody able to administer the system.
 *
 * There is no recovery path through the UI from "no active Owner", which makes
 * this worth a guard even though it is an unusual thing to attempt.
 */
async function assertAnotherActiveOwnerExists(db: Db, userId: number): Promise<void> {
  const others = await repository.countOtherActiveOwners(db, userId);
  if (others === 0) {
    throw new ConflictError(
      'This is the only active Owner account. Assign the Owner role to another active user first.',
    );
  }
}
