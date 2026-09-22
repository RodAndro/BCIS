import { z } from 'zod';

import { permissionCodeSchema, roleCodeSchema } from './auth';
import { noteSchema } from './primitives';

/**
 * Role and permission contracts.
 *
 * The role editor reads these. Changing a role's permissions is a privilege
 * change and is audited; the permission codes themselves are seeded from
 * `@bcis/shared`, so this schema cannot introduce one the API does not know.
 */

export const permissionSummarySchema = z.object({
  code: z.string(),
  category: z.string(),
  description: z.string().nullable(),
});

export type PermissionSummary = z.infer<typeof permissionSummarySchema>;

export const roleSummarySchema = z.object({
  code: roleCodeSchema,
  name: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  /** How many users currently hold this role. */
  userCount: z.number().int().nonnegative(),
  permissions: z.array(permissionCodeSchema),
});

export type RoleSummary = z.infer<typeof roleSummarySchema>;

/**
 * Replace a role's permission set.
 *
 * A full replacement rather than add/remove deltas: the editor shows the whole
 * set, so sending the whole set keeps the request and the screen in agreement
 * and avoids a stale delta revoking a permission someone just granted.
 */
export const setRolePermissionsSchema = z.object({
  permissions: z.array(permissionCodeSchema).max(200),
  reason: noteSchema.optional(),
});

export type SetRolePermissionsInput = z.infer<typeof setRolePermissionsSchema>;

/** Route parameter for a role code. */
export const roleCodeParamSchema = z.object({ code: roleCodeSchema });
