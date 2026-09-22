import { PERMISSIONS } from '@bcis/shared';
import { successBody, updateSettingSchema } from '@bcis/validation';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { actorContextOf } from '../../shared/request-context';
import { parseInput } from '../../shared/validate';
import { listSettings, updateSetting } from './settings.service';

/**
 * Settings endpoints.
 *
 * Both are behind `settings.manage`: configuration is Owner/Administrator work,
 * and a settings screen that anyone can read invites questions about values the
 * reader cannot change.
 */

const settingKeyParamSchema = z.object({
  key: z.string().trim().min(1).max(120),
});

export const settingsRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/settings',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.SETTINGS_MANAGE } } },
    async (_request, reply) => {
      return reply.send(successBody(await listSettings(app.db)));
    },
  );

  app.put(
    '/settings/:key',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.SETTINGS_MANAGE } } },
    async (request, reply) => {
      const { key } = parseInput(settingKeyParamSchema, request.params);
      const { value } = parseInput(updateSettingSchema, request.body);

      return reply.send(
        successBody(await updateSetting(app.db, key, value, actorContextOf(request))),
      );
    },
  );
};
