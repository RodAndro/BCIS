import { UnauthenticatedError } from '@bcis/shared';
import type { FastifyRequest } from 'fastify';

/**
 * Per-request context recorded against audit entries.
 *
 * ── WHY `request.ip` IS TRUSTWORTHY HERE ────────────────────────────────────
 * `trustProxy` is explicitly false on the server (see `app.ts`), because the
 * API is not behind a reverse proxy until the Phase 9 deployment. Trusting a
 * forwarded header before then would let a client write someone else's address
 * into the audit log.
 */

export interface RequestAuditContext {
  readonly ip: string | null;
  readonly userAgent: string | null;
  /** Set once the auth plugin has resolved a session; null when signing in. */
  readonly sessionId: number | null;
  readonly actorUserId: number | null;
}

export function auditContextOf(request: FastifyRequest): RequestAuditContext {
  const userAgent = request.headers['user-agent'];

  return {
    ip: request.ip.length > 0 ? request.ip : null,
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 300) : null,
    sessionId: request.authSession?.id ?? null,
    actorUserId: request.authUser?.id ?? null,
  };
}

/** A short description of the calling workstation, for the session row. */
export function describeDevice(request: FastifyRequest): string | null {
  const userAgent = request.headers['user-agent'];
  if (typeof userAgent === 'string' && userAgent.length > 0) {
    return userAgent.slice(0, 200);
  }
  return null;
}

/**
 * Who is performing an audited change.
 *
 * Every mutation service takes one of these, so an audit record is never
 * written without an actor and the action can never be attributed to nobody.
 * Only meaningful on an authenticated route — the auth plugin has already
 * guaranteed an identity by the time a handler runs.
 */
export interface ActorContext {
  readonly userId: number;
  readonly sessionId: number | null;
  readonly ip: string | null;
}

export function actorContextOf(request: FastifyRequest): ActorContext {
  const user = request.authUser;
  if (user === null) {
    throw new UnauthenticatedError('Sign in to continue.');
  }

  return {
    userId: user.id,
    sessionId: request.authSession?.id ?? null,
    ip: request.ip.length > 0 ? request.ip : null,
  };
}
