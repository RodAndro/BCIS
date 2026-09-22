import { PERMISSIONS } from '@bcis/shared';
import {
  createUserSchema,
  paginatedBody,
  resetPasswordSchema,
  setUserStatusSchema,
  successBody,
  updateUserSchema,
  userIdParamSchema,
  userListQuerySchema,
} from '@bcis/validation';
import type { FastifyPluginAsync } from 'fastify';

import { actorContextOf } from '../../shared/request-context';
import { parseInput } from '../../shared/validate';
import * as service from './users.service';

/**
 * User administration endpoints.
 *
 * ── AUTHORIZATION ───────────────────────────────────────────────────────────
 * Reading needs `user.view`; every mutation needs `user.manage`. The permission
 * is declared per route and enforced by the auth plugin from the session's
 * actual grants, so a Cashier calling these directly with a valid token is
 * refused with 403 — which is the property AT-10 tests.
 */

export const userRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/users',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.USER_VIEW } } },
    async (request, reply) => {
      const query = parseInput(userListQuerySchema, request.query);
      const page = await service.listUsers(app.db, query);

      return reply.send(paginatedBody(page.users, query.page, query.pageSize, page.total));
    },
  );

  app.get(
    '/users/:id',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.USER_VIEW } } },
    async (request, reply) => {
      const { id } = parseInput(userIdParamSchema, request.params);
      return reply.send(successBody(await service.getUser(app.db, id)));
    },
  );

  app.post(
    '/users',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.USER_MANAGE } } },
    async (request, reply) => {
      const input = parseInput(createUserSchema, request.body);
      const created = await service.createUser(app.db, input, actorContextOf(request));

      return reply.code(201).send(successBody(created));
    },
  );

  app.put(
    '/users/:id',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.USER_MANAGE } } },
    async (request, reply) => {
      const { id } = parseInput(userIdParamSchema, request.params);
      const input = parseInput(updateUserSchema, request.body);

      return reply.send(
        successBody(await service.updateUser(app.db, id, input, actorContextOf(request))),
      );
    },
  );

  app.patch(
    '/users/:id/status',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.USER_MANAGE } } },
    async (request, reply) => {
      const { id } = parseInput(userIdParamSchema, request.params);
      const input = parseInput(setUserStatusSchema, request.body);

      return reply.send(
        successBody(await service.setUserStatus(app.db, id, input, actorContextOf(request))),
      );
    },
  );

  app.post(
    '/users/:id/reset-password',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.USER_MANAGE } } },
    async (request, reply) => {
      const { id } = parseInput(userIdParamSchema, request.params);
      // The body may legitimately be empty; the schema only carries an optional
      // reason, so an absent body parses to `{}` defaults rather than failing.
      parseInput(resetPasswordSchema, request.body ?? {});

      const result = await service.resetUserPassword(app.db, id, actorContextOf(request));

      // The temporary password is in the response body only. It is never
      // logged, and the account must change it on first use.
      return reply.send(successBody(result));
    },
  );
};
