import { UnauthenticatedError } from '@bcis/shared';
import { changePasswordSchema, loginSchema, successBody } from '@bcis/validation';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { auditContextOf, describeDevice } from '../../shared/request-context';
import { parseInput } from '../../shared/validate';
import * as service from './auth.service';

/**
 * Authentication endpoints.
 *
 * ── THE TWO PUBLIC PATHS ────────────────────────────────────────────────────
 * Only `/auth/login` is `public`. Every other route below is `authenticated`,
 * and the ones that must remain reachable from a locked session or from an
 * account that must change its password say so explicitly. That is a deliberate
 * allowlist: the auth plugin refuses everything else in those states, so
 * forgetting to opt a route in fails closed.
 */

const unlockSchema = z.object({
  password: z.string().min(1, 'Enter your password.').max(200),
});

/** The identity the plugin has already established for an authenticated route. */
function identity(request: FastifyRequest): {
  userId: number;
  sessionId: number;
  sessionLocked: boolean;
  user: NonNullable<FastifyRequest['authUser']>;
} {
  const user = request.authUser;
  const session = request.authSession;

  if (user === null || session === null) {
    // Only reachable if a route is authenticated but the plugin was skipped,
    // which would itself be a bug — fail closed rather than proceed.
    throw new UnauthenticatedError('Sign in to continue.');
  }

  return {
    userId: user.id,
    sessionId: session.id,
    sessionLocked: session.lockedAt !== null,
    user,
  };
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/auth/login', { config: { auth: { public: true } } }, async (request, reply) => {
    const input = parseInput(loginSchema, request.body);
    const context = auditContextOf(request);

    const result = await service.login(app.db, input, {
      ip: context.ip,
      device: describeDevice(request),
      userAgent: context.userAgent,
    });

    // The username and id are logged; the password and the token are not, and
    // the token is deliberately absent from every log line.
    request.log.info({ userId: result.user.id, username: result.user.username }, 'signed in');

    return reply.send(successBody(result));
  });

  /**
   * The current session. Reachable while locked and while a password change is
   * required, because the client needs to be told which of those is true in
   * order to render the right screen.
   */
  app.get(
    '/auth/me',
    {
      config: {
        auth: {
          authenticated: true,
          allowLocked: true,
          allowPasswordChangeRequired: true,
        },
      },
    },
    async (request, reply) => {
      const user = request.authUser;
      const session = request.authSession;

      return reply.send(
        successBody({
          authenticated: user !== null,
          locked: session !== null && session.lockedAt !== null,
          user,
        }),
      );
    },
  );

  app.post(
    '/auth/logout',
    {
      config: {
        auth: { authenticated: true, allowLocked: true, allowPasswordChangeRequired: true },
      },
    },
    async (request, reply) => {
      const { userId, sessionId } = identity(request);
      await service.logout(app.db, sessionId, userId, auditContextOf(request).ip);
      return reply.send(successBody({ signedOut: true }));
    },
  );

  app.post(
    '/auth/lock',
    { config: { auth: { authenticated: true, allowPasswordChangeRequired: true } } },
    async (request, reply) => {
      const { userId, sessionId } = identity(request);
      await service.lockSession(app.db, sessionId, userId, auditContextOf(request).ip);
      return reply.send(successBody({ locked: true }));
    },
  );

  app.post(
    '/auth/unlock',
    {
      config: {
        auth: { authenticated: true, allowLocked: true, allowPasswordChangeRequired: true },
      },
    },
    async (request, reply) => {
      const { userId, sessionId } = identity(request);
      const body = parseInput(unlockSchema, request.body);

      await service.unlockSession(
        app.db,
        sessionId,
        userId,
        body.password,
        auditContextOf(request).ip,
      );

      return reply.send(successBody({ locked: false }));
    },
  );

  app.post(
    '/auth/change-password',
    { config: { auth: { authenticated: true, allowPasswordChangeRequired: true } } },
    async (request, reply) => {
      const { userId, sessionId } = identity(request);
      const body = parseInput(changePasswordSchema, request.body);

      await service.changeOwnPassword(app.db, {
        userId,
        sessionId,
        currentPassword: body.currentPassword,
        newPassword: body.newPassword,
        ip: auditContextOf(request).ip,
      });

      return reply.send(successBody({ changed: true }));
    },
  );
};
