import { z } from 'zod';

import { roleCodeSchema, userStatusSchema } from './auth';
import { paginationQuerySchema } from './pagination';
import {
  idParamSchema,
  noteSchema,
  passwordSchema,
  reasonSchema,
  shortTextSchema,
  usernameSchema,
} from './primitives';

/**
 * User administration contracts.
 *
 * Every mutation here is a privilege change and is therefore audited
 * server-side. The schemas exist to reject malformed input before it reaches
 * the service, not to enforce authorization — that is `requirePermission`.
 */

/** A user as listed in the administration screen. Never includes a password field. */
export const userSummarySchema = z.object({
  id: z.number().int().positive(),
  username: z.string(),
  fullName: z.string(),
  status: userStatusSchema,
  mustChangePassword: z.boolean(),
  /** True when the account is locked by the failed-login policy. */
  lockedOut: z.boolean(),
  lastLoginAt: z.string().nullable(),
  roles: z.array(roleCodeSchema),
  createdAt: z.string(),
});

export type UserSummary = z.infer<typeof userSummarySchema>;

/**
 * Create a user.
 *
 * At least one role is required: a user with no role can sign in and do
 * nothing, which reads as a bug to whoever created it.
 */
export const createUserSchema = z.object({
  username: usernameSchema,
  fullName: shortTextSchema,
  password: passwordSchema,
  roles: z.array(roleCodeSchema).min(1, 'Assign at least one role.').max(7),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

/** Edit a user's display name and role assignment. Status has its own endpoint. */
export const updateUserSchema = z.object({
  fullName: shortTextSchema,
  roles: z.array(roleCodeSchema).min(1, 'Assign at least one role.').max(7),
});

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

/**
 * Change an account's status.
 *
 * A reason is required to disable or lock an account, because "why can this
 * person not sign in?" is a question the audit log must be able to answer.
 */
export const setUserStatusSchema = z
  .object({
    status: userStatusSchema,
    reason: reasonSchema.optional(),
  })
  .refine((value) => value.status === 'ACTIVE' || value.reason !== undefined, {
    message: 'Give a reason for locking or disabling an account.',
    path: ['reason'],
  });

export type SetUserStatusInput = z.infer<typeof setUserStatusSchema>;

/**
 * Administrator-initiated password reset.
 *
 * The generated password is returned to the caller exactly once and is never
 * stored or logged. The account is flagged `mustChangePassword`, so the
 * temporary password cannot become the permanent one.
 */
export const resetPasswordSchema = z.object({
  reason: reasonSchema.optional(),
});

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/** Filters for the user list. Filtering happens in SQL, never in the renderer. */
export const userListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(120).optional(),
  status: userStatusSchema.optional(),
  role: roleCodeSchema.optional(),
});

export type UserListQuery = z.infer<typeof userListQuerySchema>;

/** Route parameter for a user id. */
export const userIdParamSchema = z.object({ id: idParamSchema });

/** Free-text note attached to a user record. */
export const userNoteSchema = noteSchema;
