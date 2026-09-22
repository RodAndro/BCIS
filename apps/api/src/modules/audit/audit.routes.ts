import { PERMISSIONS } from '@bcis/shared';
import { auditListQuerySchema, paginatedBody } from '@bcis/validation';
import type { FastifyPluginAsync } from 'fastify';

import { parseInput } from '../../shared/validate';
import { queryAuditLog } from './audit.service';

/**
 * Audit log endpoints.
 *
 * Read-only. There is deliberately no create, update, or delete route: entries
 * are written by the services that perform the change, inside their
 * transaction, and the table is protected by a trigger that rejects mutation.
 */
export const auditRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/audit-logs',
    {
      config: { auth: { authenticated: true, permission: PERMISSIONS.AUDIT_VIEW } },
    },
    async (request, reply) => {
      const query = parseInput(auditListQuerySchema, request.query);
      const page = await queryAuditLog(app.db, query);

      return reply.send(paginatedBody(page.entries, query.page, query.pageSize, page.total));
    },
  );
};
