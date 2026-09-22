import { PERMISSIONS } from '@bcis/shared';
import { ledgerQuerySchema, successBody } from '@bcis/validation';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { parseInput } from '../../shared/validate';
import { accountStatement, subscriberStatement } from './ledger.service';

/**
 * Ledger endpoints.
 *
 * Read-only by design. Entries are written by the service that performs the
 * change, inside its own transaction, and the table rejects UPDATE and DELETE —
 * so there is nothing here for a client to mutate even if it tried.
 */
const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

export const ledgerRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/ledger/subscribers/:id',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.RECEIVABLE_VIEW } } },
    async (request, reply) => {
      const { id } = parseInput(idParamSchema, request.params);
      const query = parseInput(ledgerQuerySchema, request.query);

      return reply.send(successBody(await subscriberStatement(app.db, id, query)));
    },
  );

  app.get(
    '/ledger/service-accounts/:id',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.RECEIVABLE_VIEW } } },
    async (request, reply) => {
      const { id } = parseInput(idParamSchema, request.params);
      const query = parseInput(ledgerQuerySchema, request.query);

      return reply.send(successBody(await accountStatement(app.db, id, query)));
    },
  );
};
