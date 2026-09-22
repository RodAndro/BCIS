import { PERMISSIONS } from '@bcis/shared';
import { roleCodeParamSchema, setRolePermissionsSchema, successBody } from '@bcis/validation';
import type { FastifyPluginAsync } from 'fastify';

import { actorContextOf } from '../../shared/request-context';
import { parseInput } from '../../shared/validate';
import { listPermissions, listRoles, setRolePermissions } from './rbac.service';

/**
 * Role and permission endpoints.
 *
 * The two reads are behind `user.view` because the Users & Roles screen needs
 * them together; changing a role's grants needs `role.manage`, which only the
 * Owner holds. That split is deliberate: a supervisor who can see the role list
 * cannot silently widen it.
 */
export const rbacRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/roles',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.USER_VIEW } } },
    async (_request, reply) => {
      return reply.send(successBody(await listRoles(app.db)));
    },
  );

  app.get(
    '/permissions',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.USER_VIEW } } },
    async (_request, reply) => {
      return reply.send(successBody(await listPermissions(app.db)));
    },
  );

  app.put(
    '/roles/:code/permissions',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.ROLE_MANAGE } } },
    async (request, reply) => {
      const { code } = parseInput(roleCodeParamSchema, request.params);
      const input = parseInput(setRolePermissionsSchema, request.body);

      return reply.send(
        successBody(await setRolePermissions(app.db, code, input, actorContextOf(request))),
      );
    },
  );
};
