import { PERMISSIONS } from '@bcis/shared';
import { backupIdParamSchema, successBody } from '@bcis/validation';
import type { FastifyPluginAsync } from 'fastify';

import { actorContextOf } from '../../shared/request-context';
import { parseInput } from '../../shared/validate';
import * as repository from './backup.repository';
import { createBackup, restoreBackup, verifyBackup } from './backup.service';

export const backupRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/backups',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.BACKUP_VERIFY } } },
    async (_request, reply) => reply.send(successBody(await repository.listBackups(app.db))),
  );

  app.post(
    '/backups',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.BACKUP_CREATE } } },
    async (request, reply) =>
      reply.code(201).send(successBody(await createBackup(app.db, actorContextOf(request)))),
  );

  app.post(
    '/backups/:backupId/verify',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.BACKUP_VERIFY } } },
    async (request, reply) => {
      const { backupId } = parseInput(backupIdParamSchema, request.params);
      try {
        return reply.send(
          successBody(await verifyBackup(app.db, backupId, actorContextOf(request))),
        );
      } catch (error) {
        if (error instanceof Error && error.message === 'That backup does not exist.') {
          return reply
            .code(404)
            .send({ error: { code: 'NOT_FOUND', message: error.message, requestId: request.id } });
        }
        throw error;
      }
    },
  );

  app.post(
    '/backups/:backupId/restore',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.BACKUP_RESTORE } } },
    async (request, reply) => {
      const { backupId } = parseInput(backupIdParamSchema, request.params);
      return reply.send(
        successBody(await restoreBackup(app.db, backupId, actorContextOf(request))),
      );
    },
  );
};
