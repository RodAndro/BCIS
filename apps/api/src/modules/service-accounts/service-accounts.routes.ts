import { PERMISSIONS } from '@bcis/shared';
import {
  applyPlanRateSchema,
  changeServiceAccountPlanSchema,
  createServiceAccountSchema,
  paginatedBody,
  serviceAccountIdParamSchema,
  serviceAccountListQuerySchema,
  serviceNoteSchema,
  setServiceAccountStatusSchema,
  successBody,
  updateServiceAccountSchema,
} from '@bcis/validation';
import type { FastifyPluginAsync } from 'fastify';

import { actorContextOf } from '../../shared/request-context';
import { parseInput } from '../../shared/validate';
import {
  addServiceNote,
  applyPlanRate,
  changeServiceAccountPlan,
  createServiceAccount,
  getServiceAccount,
  listServiceAccounts,
  setServiceAccountStatus,
  updateServiceAccount,
} from './service-accounts.service';

/**
 * Service account endpoints.
 *
 * Reads need `service.view`; every mutation needs `service.manage`. Repricing an
 * account and moving it to another plan are business decisions rather than
 * clerical ones, so they live behind the same permission as the rest of the
 * account rather than a permission of their own — Phase 4 can split them out if
 * billing rules demand it.
 */
export const serviceAccountRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/service-accounts',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.SERVICE_VIEW } } },
    async (request, reply) => {
      const query = parseInput(serviceAccountListQuerySchema, request.query);
      const page = await listServiceAccounts(app.db, query);

      return reply.send(paginatedBody(page.accounts, query.page, query.pageSize, page.total));
    },
  );

  app.get(
    '/service-accounts/:id',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.SERVICE_VIEW } } },
    async (request, reply) => {
      const { id } = parseInput(serviceAccountIdParamSchema, request.params);
      return reply.send(successBody(await getServiceAccount(app.db, id)));
    },
  );

  app.post(
    '/service-accounts',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.SERVICE_MANAGE } } },
    async (request, reply) => {
      const input = parseInput(createServiceAccountSchema, request.body);
      const created = await createServiceAccount(app.db, input, actorContextOf(request));

      return reply.code(201).send(successBody(created));
    },
  );

  app.put(
    '/service-accounts/:id',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.SERVICE_MANAGE } } },
    async (request, reply) => {
      const { id } = parseInput(serviceAccountIdParamSchema, request.params);
      const input = parseInput(updateServiceAccountSchema, request.body);

      return reply.send(
        successBody(await updateServiceAccount(app.db, id, input, actorContextOf(request))),
      );
    },
  );

  app.patch(
    '/service-accounts/:id/status',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.SERVICE_MANAGE } } },
    async (request, reply) => {
      const { id } = parseInput(serviceAccountIdParamSchema, request.params);
      const input = parseInput(setServiceAccountStatusSchema, request.body);

      return reply.send(
        successBody(await setServiceAccountStatus(app.db, id, input, actorContextOf(request))),
      );
    },
  );

  app.post(
    '/service-accounts/:id/apply-rate',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.SERVICE_MANAGE } } },
    async (request, reply) => {
      const { id } = parseInput(serviceAccountIdParamSchema, request.params);
      const input = parseInput(applyPlanRateSchema, request.body);

      return reply.send(
        successBody(await applyPlanRate(app.db, id, input, actorContextOf(request))),
      );
    },
  );

  app.post(
    '/service-accounts/:id/change-plan',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.SERVICE_MANAGE } } },
    async (request, reply) => {
      const { id } = parseInput(serviceAccountIdParamSchema, request.params);
      const input = parseInput(changeServiceAccountPlanSchema, request.body);

      return reply.send(
        successBody(await changeServiceAccountPlan(app.db, id, input, actorContextOf(request))),
      );
    },
  );

  app.post(
    '/service-accounts/:id/notes',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.SERVICE_MANAGE } } },
    async (request, reply) => {
      const { id } = parseInput(serviceAccountIdParamSchema, request.params);
      const input = parseInput(serviceNoteSchema, request.body);

      return reply.send(
        successBody(
          await addServiceNote(
            app.db,
            id,
            input.effectiveDate,
            input.note,
            actorContextOf(request),
          ),
        ),
      );
    },
  );
};
