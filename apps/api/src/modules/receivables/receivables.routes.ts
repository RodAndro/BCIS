import { PERMISSIONS } from '@bcis/shared';
import {
  receivableListQuerySchema,
  reconnectionCompleteSchema,
  reconnectionIdParamSchema,
  reconnectionRequestSchema,
  reconnectionScheduleSchema,
  serviceAccountIdParamSchema,
  successBody,
  suspensionCandidateQuerySchema,
  suspendServiceSchema,
} from '@bcis/validation';
import type { FastifyPluginAsync } from 'fastify';

import { actorContextOf } from '../../shared/request-context';
import { parseInput } from '../../shared/validate';
import {
  completeReconnection,
  getAgingSummary,
  getReconnection,
  listReceivables,
  listSuspensionCandidates,
  requestReconnection,
  scheduleReconnection,
  suspendService,
} from './receivables.service';

export const receivablesRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/receivables/aging',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.RECEIVABLE_VIEW } } },
    async (_request, reply) => reply.send(successBody(await getAgingSummary(app.db))),
  );

  app.get(
    '/receivables',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.RECEIVABLE_VIEW } } },
    async (request, reply) => {
      const query = parseInput(receivableListQuerySchema, request.query);
      const page = await listReceivables(app.db, query);
      return reply.send({
        data: page.receivables,
        meta: { page: query.page, pageSize: query.pageSize, total: page.total },
      });
    },
  );

  app.get(
    '/receivables/suspension-candidates',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.SUSPENSION_VIEW } } },
    async (request, reply) => {
      const query = parseInput(suspensionCandidateQuerySchema, request.query);
      const page = await listSuspensionCandidates(app.db, query);
      return reply.send({
        data: page.candidates,
        meta: { page: query.page, pageSize: query.pageSize, total: page.total },
      });
    },
  );

  app.post(
    '/service-accounts/:id/suspend',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.SUSPENSION_APPROVE } } },
    async (request, reply) => {
      const { id } = parseInput(serviceAccountIdParamSchema, request.params);
      const input = parseInput(suspendServiceSchema, request.body);
      return reply.send(
        successBody(await suspendService(app.db, id, input, actorContextOf(request))),
      );
    },
  );

  app.post(
    '/service-accounts/:id/reconnection-requests',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.RECONNECTION_REQUEST } } },
    async (request, reply) => {
      const { id } = parseInput(serviceAccountIdParamSchema, request.params);
      const input = parseInput(reconnectionRequestSchema, request.body);
      return reply
        .code(201)
        .send(successBody(await requestReconnection(app.db, id, input, actorContextOf(request))));
    },
  );

  app.get(
    '/reconnection-requests/:id',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.RECONNECTION_REQUEST } } },
    async (request, reply) => {
      const { id } = parseInput(reconnectionIdParamSchema, request.params);
      return reply.send(successBody(await getReconnection(app.db, id)));
    },
  );

  app.patch(
    '/reconnection-requests/:id/schedule',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.RECONNECTION_MANAGE } } },
    async (request, reply) => {
      const { id } = parseInput(reconnectionIdParamSchema, request.params);
      const input = parseInput(reconnectionScheduleSchema, request.body);
      return reply.send(
        successBody(await scheduleReconnection(app.db, id, input, actorContextOf(request))),
      );
    },
  );

  app.patch(
    '/reconnection-requests/:id/complete',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.RECONNECTION_MANAGE } } },
    async (request, reply) => {
      const { id } = parseInput(reconnectionIdParamSchema, request.params);
      const input = parseInput(reconnectionCompleteSchema, request.body);
      return reply.send(
        successBody(await completeReconnection(app.db, id, input, actorContextOf(request))),
      );
    },
  );
};
