import { PERMISSIONS } from '@bcis/shared';
import {
  createSubscriberSchema,
  paginatedBody,
  replaceAddressesSchema,
  replaceContactsSchema,
  setSubscriberStatusSchema,
  subscriberIdParamSchema,
  subscriberListQuerySchema,
  successBody,
  updateSubscriberSchema,
} from '@bcis/validation';
import type { FastifyPluginAsync } from 'fastify';

import { actorContextOf } from '../../shared/request-context';
import { parseInput } from '../../shared/validate';
import {
  createSubscriber,
  getSubscriber,
  listSubscribers,
  replaceAddresses,
  replaceContacts,
  setSubscriberStatus,
  updateSubscriber,
} from './subscribers.service';

/**
 * Subscriber endpoints.
 *
 * Reads need `subscriber.view`, writes `subscriber.create` / `subscriber.update`.
 * Archiving is part of update rather than a permission of its own — the
 * dedicated permission exists for a later phase that needs to separate them.
 */
export const subscriberRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/subscribers',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.SUBSCRIBER_VIEW } } },
    async (request, reply) => {
      const query = parseInput(subscriberListQuerySchema, request.query);
      const page = await listSubscribers(app.db, query);

      return reply.send(paginatedBody(page.subscribers, query.page, query.pageSize, page.total));
    },
  );

  app.get(
    '/subscribers/:id',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.SUBSCRIBER_VIEW } } },
    async (request, reply) => {
      const { id } = parseInput(subscriberIdParamSchema, request.params);
      return reply.send(successBody(await getSubscriber(app.db, id)));
    },
  );

  app.post(
    '/subscribers',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.SUBSCRIBER_CREATE } } },
    async (request, reply) => {
      const input = parseInput(createSubscriberSchema, request.body);
      const created = await createSubscriber(app.db, input, actorContextOf(request));

      return reply.code(201).send(successBody(created));
    },
  );

  app.put(
    '/subscribers/:id',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.SUBSCRIBER_UPDATE } } },
    async (request, reply) => {
      const { id } = parseInput(subscriberIdParamSchema, request.params);
      const input = parseInput(updateSubscriberSchema, request.body);

      return reply.send(
        successBody(await updateSubscriber(app.db, id, input, actorContextOf(request))),
      );
    },
  );

  app.patch(
    '/subscribers/:id/status',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.SUBSCRIBER_UPDATE } } },
    async (request, reply) => {
      const { id } = parseInput(subscriberIdParamSchema, request.params);
      const input = parseInput(setSubscriberStatusSchema, request.body);

      return reply.send(
        successBody(await setSubscriberStatus(app.db, id, input, actorContextOf(request))),
      );
    },
  );

  /**
   * Addresses and contacts are replaced as a set rather than edited row by row.
   * One request, one audit record, and no way for the screen and the database
   * to disagree about what the current set is.
   */
  app.put(
    '/subscribers/:id/addresses',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.SUBSCRIBER_UPDATE } } },
    async (request, reply) => {
      const { id } = parseInput(subscriberIdParamSchema, request.params);
      const input = parseInput(replaceAddressesSchema, request.body);

      return reply.send(
        successBody(await replaceAddresses(app.db, id, input.addresses, actorContextOf(request))),
      );
    },
  );

  app.put(
    '/subscribers/:id/contacts',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.SUBSCRIBER_UPDATE } } },
    async (request, reply) => {
      const { id } = parseInput(subscriberIdParamSchema, request.params);
      const input = parseInput(replaceContactsSchema, request.body);

      return reply.send(
        successBody(await replaceContacts(app.db, id, input.contacts, actorContextOf(request))),
      );
    },
  );
};
