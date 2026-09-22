import { PERMISSIONS } from '@bcis/shared';
import { successBody, subscriberSearchQuerySchema } from '@bcis/validation';
import type { FastifyPluginAsync } from 'fastify';

import { parseInput } from '../../shared/validate';
import { searchSubscribers } from '../subscribers/subscribers.service';
import { listSubscriberSearchProviders } from './search.service';

/**
 * Search endpoints.
 *
 * ── WHY `/search/providers` EXISTS ──────────────────────────────────────────
 * The search box tells the user what it searches ("account number, name,
 * contact, address"). That list is served rather than hardcoded in the UI,
 * because Phase 4 and Phase 5 register invoice, receipt, and GCash-reference
 * providers — and the hint must grow with them without a UI change.
 *
 * It also makes the extension point visible: an empty or missing provider shows
 * up here rather than as "search does not find my invoice".
 */
export const searchRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/search/providers',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.SUBSCRIBER_VIEW } } },
    async (_request, reply) => {
      return reply.send(successBody(listSubscriberSearchProviders()));
    },
  );

  app.get(
    '/search/subscribers',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.SUBSCRIBER_VIEW } } },
    async (request, reply) => {
      const query = parseInput(subscriberSearchQuerySchema, request.query);
      const subscribers = await searchSubscribers(app.db, query.q, query.limit);

      return reply.send(successBody(subscribers));
    },
  );
};
