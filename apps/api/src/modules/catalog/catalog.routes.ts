import { PERMISSIONS } from '@bcis/shared';
import {
  changePlanPriceSchema,
  createPlanSchema,
  paginatedBody,
  planIdParamSchema,
  planListQuerySchema,
  retirePlanSchema,
  successBody,
  updatePlanSchema,
} from '@bcis/validation';
import type { FastifyPluginAsync } from 'fastify';

import { actorContextOf } from '../../shared/request-context';
import { parseInput } from '../../shared/validate';
import {
  changePlanPrice,
  createPlan,
  getPlan,
  listPlans,
  listServiceTypes,
  retirePlan,
  updatePlan,
} from './catalog.service';

/**
 * Service types and plans.
 *
 * Reading needs `service.view` — every role that touches a customer needs to
 * know what they are on. Creating, editing, repricing, and retiring need
 * `service.plan.manage`, which is Administrator and Owner only: a price change
 * affects what every future customer is charged.
 */
export const catalogRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/service-types',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.SERVICE_VIEW } } },
    async (_request, reply) => {
      return reply.send(successBody(await listServiceTypes(app.db)));
    },
  );

  app.get(
    '/plans',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.SERVICE_VIEW } } },
    async (request, reply) => {
      const query = parseInput(planListQuerySchema, request.query);
      const page = await listPlans(app.db, query);

      return reply.send(paginatedBody(page.plans, query.page, query.pageSize, page.total));
    },
  );

  app.get(
    '/plans/:id',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.SERVICE_VIEW } } },
    async (request, reply) => {
      const { id } = parseInput(planIdParamSchema, request.params);
      return reply.send(successBody(await getPlan(app.db, id)));
    },
  );

  app.post(
    '/plans',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.SERVICE_PLAN_MANAGE } } },
    async (request, reply) => {
      const input = parseInput(createPlanSchema, request.body);
      const created = await createPlan(app.db, input, actorContextOf(request));

      return reply.code(201).send(successBody(created));
    },
  );

  app.put(
    '/plans/:id',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.SERVICE_PLAN_MANAGE } } },
    async (request, reply) => {
      const { id } = parseInput(planIdParamSchema, request.params);
      const input = parseInput(updatePlanSchema, request.body);

      return reply.send(successBody(await updatePlan(app.db, id, input, actorContextOf(request))));
    },
  );

  /**
   * A price change is a POST to a sub-resource, not a PUT to the plan, because
   * it creates a document rather than editing one. The route shape says so.
   */
  app.post(
    '/plans/:id/price',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.SERVICE_PLAN_MANAGE } } },
    async (request, reply) => {
      const { id } = parseInput(planIdParamSchema, request.params);
      const input = parseInput(changePlanPriceSchema, request.body);

      return reply
        .code(201)
        .send(successBody(await changePlanPrice(app.db, id, input, actorContextOf(request))));
    },
  );

  app.post(
    '/plans/:id/retire',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.SERVICE_PLAN_MANAGE } } },
    async (request, reply) => {
      const { id } = parseInput(planIdParamSchema, request.params);
      const input = parseInput(retirePlanSchema, request.body);

      return reply.send(successBody(await retirePlan(app.db, id, input, actorContextOf(request))));
    },
  );
};
