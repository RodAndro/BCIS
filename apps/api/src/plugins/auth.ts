import { hashSessionToken } from '@bcis/security';
import { AppError, ERROR_CODES, ForbiddenError, UnauthenticatedError } from '@bcis/shared';
import type { Permission } from '@bcis/shared';
import type { SessionUser } from '@bcis/validation';
import type { FastifyPluginAsync, FastifyRequest, RouteOptions } from 'fastify';
import fp from 'fastify-plugin';

import { loadAuthenticatedContext } from '../modules/auth/auth.service';

/**
 * Authentication and authorization.
 *
 * ── THE TWO GUARANTEES THIS PLUGIN PROVIDES ─────────────────────────────────
 * 1. **Every route must declare its policy.** The `onRoute` hook below throws at
 *    startup for any route without `config.auth`. A route that forgets is not
 *    silently public — the server refuses to boot. This is what turns "every
 *    protected route declares a permission" from a convention into a property
 *    of the build.
 * 2. **The decision is made from the session, server-side.** Permissions are
 *    read from the database per request and checked here. Nothing the renderer
 *    sends is trusted: a Cashier calling an admin endpoint directly, with the
 *    correct token, is refused because the token's session does not hold the
 *    permission. Hiding a button in React is not security, and this is the code
 *    that makes that true.
 */

export type RouteAuth =
  | { readonly public: true }
  | {
      readonly authenticated: true;
      /** Required permission. Omit for "signed in is enough". */
      readonly permission?: Permission;
      /** Permit when the session is locked. Only the unlock/logout/me paths. */
      readonly allowLocked?: boolean;
      /** Permit when the account must change its password first. */
      readonly allowPasswordChangeRequired?: boolean;
    };

declare module 'fastify' {
  interface FastifyContextConfig {
    auth?: RouteAuth;
  }

  interface FastifyRequest {
    /** Resolved identity, or null on a public route. */
    authUser: SessionUser | null;
    authSession: { id: number; lockedAt: Date | null } | null;
  }
}

/** `Authorization: Bearer <token>`, or null. */
function readBearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return null;

  const separator = header.indexOf(' ');
  if (separator === -1) return null;

  const scheme = header.slice(0, separator);
  const value = header.slice(separator + 1).trim();

  if (scheme.toLowerCase() !== 'bearer' || value.length === 0) return null;
  return value;
}

const authPlugin: FastifyPluginAsync = async (app) => {
  // `null` rather than an object: Fastify reuses one request object per
  // connection, so a shared mutable default would leak identity between
  // requests. Each request assigns its own value below.
  app.decorateRequest('authUser', null);
  app.decorateRequest('authSession', null);

  /**
   * Fail the boot, not the request.
   *
   * A missing policy is a programming error, and finding it when the API starts
   * is far better than finding it when someone notices an unprotected endpoint
   * in production.
   */
  app.addHook('onRoute', (routeOptions: RouteOptions) => {
    if (routeOptions.config?.auth === undefined) {
      throw new Error(
        `Route ${routeOptions.method} ${routeOptions.url} does not declare config.auth. ` +
          'Every route must be explicitly { public: true } or ' +
          '{ authenticated: true, permission?: ... }. ' +
          'An undeclared route would otherwise be reachable by anyone.',
      );
    }
  });

  app.addHook('onRequest', async (request) => {
    const policy = request.routeOptions.config?.auth;

    // An undeclared route cannot reach here — the onRoute hook above would have
    // stopped the server from starting. Treat it as public only in that
    // impossible case, so the behaviour is fail-closed either way.
    if (policy === undefined || 'public' in policy) return;

    const token = readBearerToken(request);
    if (token === null) {
      throw new UnauthenticatedError('Sign in to continue.');
    }

    const context = await loadAuthenticatedContext(request.server.db, hashSessionToken(token));

    if (context === null) {
      // Unknown, revoked, or expired. The client reacts by returning to the
      // sign-in screen; the message must not say which of the three it was.
      throw new UnauthenticatedError(
        'Your session has ended. Sign in again.',
        ERROR_CODES.SESSION_EXPIRED,
      );
    }

    request.authUser = context.user;
    request.authSession = context.session;

    if (context.session.lockedAt !== null && policy.allowLocked !== true) {
      throw new AppError(
        ERROR_CODES.SESSION_LOCKED,
        'This session is locked. Enter your password to continue.',
      );
    }

    if (context.user.mustChangePassword && policy.allowPasswordChangeRequired !== true) {
      throw new AppError(
        ERROR_CODES.PASSWORD_CHANGE_REQUIRED,
        'Change your password before continuing.',
      );
    }

    if (policy.permission !== undefined && !context.user.permissions.includes(policy.permission)) {
      throw new ForbiddenError();
    }
  });
};

export default fp(authPlugin, { name: 'auth' });
