import {
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  performTimingSymmetryWork,
  verifyPassword,
} from '@bcis/security';
import { AppError, ERROR_CODES, UnauthenticatedError } from '@bcis/shared';
import type { LoginInput, SessionUser } from '@bcis/validation';

import { env } from '../../config/env';
import type { Db } from '../../shared/database';
import { AUDIT_ACTIONS, AUDIT_ENTITIES } from '../audit/audit.actions';
import { writeAudit } from '../audit/audit.service';
import { toSessionUser } from './auth.mapper';
import * as repository from './auth.repository';
import type { AuthUserRow } from './auth.repository';

/**
 * Authentication service.
 *
 * ── THE SIGN-IN ALGORITHM, AND WHY IT IS IN THIS ORDER ─────────────────────
 * 1. Look the user up. If there is no such user, spend the same time as a real
 *    verification would and answer exactly as a wrong password does. Skipping
 *    that would make "unknown user" measurably faster than "wrong password",
 *    which enumerates usernames without saying anything.
 * 2. Verify the password. Everything after this point may be specific, because
 *    only someone who already knows the password has reached it.
 * 3. Only then report a locked, disabled, or deactivated account.
 *
 * That ordering is the whole design: account state is never revealed to a
 * caller who has not proved they own the account.
 */

export interface SessionContext {
  readonly user: SessionUser;
  readonly session: {
    readonly id: number;
    readonly lockedAt: Date | null;
  };
}

export interface LoginContext {
  readonly ip: string | null;
  readonly device: string | null;
  readonly userAgent: string | null;
}

/**
 * Resolve a token hash into the request's identity.
 *
 * Called by the auth plugin on every authenticated request. Returns null for a
 * revoked, expired, or unknown session — the caller turns that into a 401 and
 * the client returns to the sign-in screen.
 */
export async function loadAuthenticatedContext(
  db: Db,
  tokenHash: string,
): Promise<SessionContext | null> {
  const found = await repository.findUsableSessionByTokenHash(db, tokenHash);
  if (found === null) return null;

  const grants = await repository.loadGrants(db, found.user.id);

  // Best-effort: a failure here is not worth failing the request over, and the
  // update is itself conditional so it is usually a no-op.
  await repository.touchSession(db, found.session.id, new Date());

  return {
    user: toSessionUser(found.user, grants),
    session: { id: found.session.id, lockedAt: found.session.lockedAt },
  };
}

/**
 * Sign in.
 *
 * @throws UnauthenticatedError for an unknown username or a wrong password —
 *         deliberately the same error for both.
 * @throws AppError with ACCOUNT_LOCKED / ACCOUNT_DISABLED for an account in
 *         that state, only after the password has been verified.
 */
export async function login(
  db: Db,
  input: LoginInput,
  context: LoginContext,
): Promise<{ token: string; user: SessionUser }> {
  const now = new Date();
  const user = await repository.findUserByUsername(db, input.username);

  if (user === null) {
    await performTimingSymmetryWork();
    await repository.insertLoginAttempt(db, {
      username: input.username,
      userId: null,
      success: false,
      reason: ERROR_CODES.INVALID_CREDENTIALS,
      ip: context.ip,
      userAgent: context.userAgent,
    });
    throw new UnauthenticatedError(
      'Incorrect username or password.',
      ERROR_CODES.INVALID_CREDENTIALS,
    );
  }

  const passwordMatches = await verifyPassword(user.passwordHash, input.password);

  if (!passwordMatches) {
    const failedLoginCount = user.failedLoginCount + 1;
    const reachedThreshold = failedLoginCount >= env.MAX_FAILED_LOGIN_ATTEMPTS;
    const lockedUntil = reachedThreshold
      ? new Date(now.getTime() + env.ACCOUNT_LOCK_MINUTES * 60_000)
      : null;

    await db.transaction(async (tx) => {
      await repository.markLoginFailed(tx, user.id, {
        // Reset the counter when the lock is applied, so the lock itself is the
        // state and the counter does not keep climbing while it is in force.
        failedLoginCount: reachedThreshold ? 0 : failedLoginCount,
        lockedUntil,
      });
      await repository.insertLoginAttempt(tx, {
        username: user.username,
        userId: user.id,
        success: false,
        reason: reachedThreshold ? ERROR_CODES.ACCOUNT_LOCKED : ERROR_CODES.INVALID_CREDENTIALS,
        ip: context.ip,
        userAgent: context.userAgent,
      });
      if (reachedThreshold) {
        await writeAudit(tx, {
          action: AUDIT_ACTIONS.LOGIN_FAILED,
          entityType: AUDIT_ENTITIES.USER,
          entityId: String(user.id),
          actorUserId: user.id,
          ip: context.ip,
          reason: `Account locked after ${String(failedLoginCount)} failed sign-in attempts.`,
        });
      }
    });

    // Same message as the unknown-username path above.
    throw new UnauthenticatedError(
      'Incorrect username or password.',
      ERROR_CODES.INVALID_CREDENTIALS,
    );
  }

  await assertAccountUsable(db, user, now, context);

  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(now.getTime() + env.SESSION_TTL_HOURS * 3_600_000);

  await db.transaction(async (tx) => {
    const sessionId = await repository.insertSession(tx, {
      tokenHash,
      userId: user.id,
      expiresAt,
      ip: context.ip,
      device: context.device,
    });

    await repository.markLoginSucceeded(tx, user.id, now);
    await repository.insertLoginAttempt(tx, {
      username: user.username,
      userId: user.id,
      success: true,
      reason: null,
      ip: context.ip,
      userAgent: context.userAgent,
    });
    await writeAudit(tx, {
      action: AUDIT_ACTIONS.LOGIN_SUCCEEDED,
      entityType: AUDIT_ENTITIES.SESSION,
      entityId: String(sessionId),
      actorUserId: user.id,
      sessionId,
      ip: context.ip,
    });
  });

  const grants = await repository.loadGrants(db, user.id);

  // Reflect the login in the returned identity without a second read.
  const refreshed: AuthUserRow = {
    ...user,
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: now,
  };

  return { token, user: toSessionUser(refreshed, grants) };
}

/**
 * Refuse an account that exists and whose password was correct but which may
 * not be used. Reached only after verification, so the specific reason is safe
 * to return.
 */
async function assertAccountUsable(
  db: Db,
  user: AuthUserRow,
  now: Date,
  context: LoginContext,
): Promise<void> {
  if (user.lockedUntil !== null && user.lockedUntil.getTime() > now.getTime()) {
    const minutes = Math.max(1, Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 60_000));
    await recordRefusal(db, user, ERROR_CODES.ACCOUNT_LOCKED, context, 'Account is locked out.');
    throw new AppError(
      ERROR_CODES.ACCOUNT_LOCKED,
      `Too many failed attempts. Try again in about ${String(minutes)} minute(s).`,
    );
  }

  if (user.status === 'DISABLED') {
    await recordRefusal(db, user, ERROR_CODES.ACCOUNT_DISABLED, context, 'Account is disabled.');
    throw new AppError(
      ERROR_CODES.ACCOUNT_DISABLED,
      'This account has been deactivated. Contact an administrator.',
    );
  }

  if (user.status === 'LOCKED') {
    await recordRefusal(db, user, ERROR_CODES.ACCOUNT_LOCKED, context, 'Account is locked.');
    throw new AppError(
      ERROR_CODES.ACCOUNT_LOCKED,
      'This account is locked. Contact an administrator.',
    );
  }
}

async function recordRefusal(
  db: Db,
  user: AuthUserRow,
  reason: string,
  context: LoginContext,
  auditReason: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await repository.insertLoginAttempt(tx, {
      username: user.username,
      userId: user.id,
      success: false,
      reason,
      ip: context.ip,
      userAgent: context.userAgent,
    });
    await writeAudit(tx, {
      action: AUDIT_ACTIONS.LOGIN_FAILED,
      entityType: AUDIT_ENTITIES.USER,
      entityId: String(user.id),
      actorUserId: user.id,
      ip: context.ip,
      reason: auditReason,
    });
  });
}

/** End the session. The token stops working immediately, not at expiry. */
export async function logout(
  db: Db,
  sessionId: number,
  actorUserId: number,
  ip: string | null,
): Promise<void> {
  await db.transaction(async (tx) => {
    await repository.revokeSession(tx, sessionId, 'USER_LOGOUT');
    await writeAudit(tx, {
      action: AUDIT_ACTIONS.LOGOUT,
      entityType: AUDIT_ENTITIES.SESSION,
      entityId: String(sessionId),
      actorUserId,
      sessionId,
      ip,
    });
  });
}

/**
 * Lock the session without ending it.
 *
 * The token stays valid but the auth plugin refuses every route except unlock,
 * which is what lets a cashier step away from the till without losing the
 * screen they were on.
 */
export async function lockSession(
  db: Db,
  sessionId: number,
  actorUserId: number,
  ip: string | null,
): Promise<void> {
  await db.transaction(async (tx) => {
    await repository.setSessionLocked(tx, sessionId, true);
    await writeAudit(tx, {
      action: AUDIT_ACTIONS.SESSION_LOCKED,
      entityType: AUDIT_ENTITIES.SESSION,
      entityId: String(sessionId),
      actorUserId,
      sessionId,
      ip,
    });
  });
}

/**
 * Unlock by re-entering the password.
 *
 * Password re-entry rather than a bare "unlock" call is the point of the
 * feature: someone who walks up to an unattended till must not be able to press
 * Continue and be inside the session.
 */
export async function unlockSession(
  db: Db,
  sessionId: number,
  userId: number,
  password: string,
  ip: string | null,
): Promise<void> {
  const user = await repository.findUserById(db, userId);
  if (user === null) {
    throw new UnauthenticatedError(
      'Your session has ended. Sign in again.',
      ERROR_CODES.SESSION_EXPIRED,
    );
  }

  const matches = await verifyPassword(user.passwordHash, password);
  if (!matches) {
    await repository.insertLoginAttempt(db, {
      username: user.username,
      userId: user.id,
      success: false,
      reason: ERROR_CODES.INVALID_CREDENTIALS,
      ip,
      userAgent: null,
    });
    throw new UnauthenticatedError('That password is incorrect.', ERROR_CODES.INVALID_CREDENTIALS);
  }

  await db.transaction(async (tx) => {
    await repository.setSessionLocked(tx, sessionId, false);
    await writeAudit(tx, {
      action: AUDIT_ACTIONS.SESSION_UNLOCKED,
      entityType: AUDIT_ENTITIES.SESSION,
      entityId: String(sessionId),
      actorUserId: userId,
      sessionId,
      ip,
    });
  });
}

/**
 * Change the signed-in user's own password.
 *
 * Every other session for this user is revoked: if the password is being
 * changed because it was shared or exposed, leaving the old sessions alive
 * would defeat the purpose. The current session is kept so the user is not
 * thrown out of the screen they are on.
 */
export async function changeOwnPassword(
  db: Db,
  input: {
    readonly userId: number;
    readonly sessionId: number;
    readonly currentPassword: string;
    readonly newPassword: string;
    readonly ip: string | null;
  },
): Promise<void> {
  const user = await repository.findUserById(db, input.userId);
  if (user === null) {
    throw new UnauthenticatedError(
      'Your session has ended. Sign in again.',
      ERROR_CODES.SESSION_EXPIRED,
    );
  }

  const matches = await verifyPassword(user.passwordHash, input.currentPassword);
  if (!matches) {
    throw new UnauthenticatedError(
      'Your current password is incorrect.',
      ERROR_CODES.INVALID_CREDENTIALS,
    );
  }

  const passwordHash = await hashPassword(input.newPassword);

  await db.transaction(async (tx) => {
    await repository.updatePasswordHash(tx, user.id, passwordHash, false);
    const revoked = await repository.revokeOtherSessions(
      tx,
      user.id,
      input.sessionId,
      'PASSWORD_CHANGED',
    );
    await writeAudit(tx, {
      action: AUDIT_ACTIONS.PASSWORD_CHANGED,
      entityType: AUDIT_ENTITIES.USER,
      entityId: String(user.id),
      actorUserId: user.id,
      sessionId: input.sessionId,
      ip: input.ip,
      // The count is recorded; the password and its hash never are.
      newValues: { otherSessionsRevoked: revoked },
    });
  });
}
