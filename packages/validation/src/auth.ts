import { ALL_PERMISSIONS, ALL_ROLE_CODES, type Permission, type RoleCode } from '@bcis/shared';
import { z } from 'zod';

import { idSchema, passwordSchema } from './primitives';

/**
 * Authentication contracts.
 *
 * Shared by the API (which validates the request) and the desktop main process
 * (which validates both the input it forwards and the response it receives), so
 * a change to either side surfaces as a type error rather than a runtime
 * surprise in front of a cashier.
 */

export const roleCodeSchema = z.enum([...ALL_ROLE_CODES] as [RoleCode, ...RoleCode[]]);

export const permissionCodeSchema = z.enum([...ALL_PERMISSIONS] as [Permission, ...Permission[]]);

export const userStatusSchema = z.enum(['ACTIVE', 'LOCKED', 'DISABLED']);

/**
 * Sign-in request.
 *
 * The password is only checked for presence: applying the current password
 * policy here would lock out any account whose password predates a policy
 * change. The real check is the hash comparison.
 */
export const loginSchema = z.object({
  username: z.string().trim().min(1, 'Enter your username.').max(50),
  password: z.string().min(1, 'Enter your password.').max(200),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.').max(200),
    newPassword: passwordSchema,
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: 'The new password must be different from the current one.',
    path: ['newPassword'],
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/**
 * The signed-in user as the client is allowed to see it.
 *
 * ── WHAT IS ABSENT IS THE POINT ─────────────────────────────────────────────
 * No password hash, no session token, no token hash. This schema is the single
 * definition of the user shape that crosses to the renderer, so a field added
 * to the entity cannot leak by accident — it has to be added here first.
 */
export const sessionUserSchema = z.object({
  id: idSchema,
  username: z.string(),
  fullName: z.string(),
  status: userStatusSchema,
  mustChangePassword: z.boolean(),
  roles: z.array(roleCodeSchema),
  permissions: z.array(permissionCodeSchema),
});

export type SessionUser = z.infer<typeof sessionUserSchema>;

/**
 * What the Electron main process reports to the renderer about the session.
 *
 * The token is deliberately not part of this shape: it lives in main-process
 * memory and never reaches the window.
 */
export const authStateSchema = z.object({
  authenticated: z.boolean(),
  /** A locked session may only call `auth.unlock`. */
  locked: z.boolean(),
  user: sessionUserSchema.nullable(),
});

export type AuthState = z.infer<typeof authStateSchema>;

/**
 * The API's answer to a successful sign-in.
 *
 * `token` is present here because the API and the Electron main process — the
 * only two components that legitimately handle it — exchange this shape. The
 * preload bridge strips it before anything reaches React.
 */
export const loginResultSchema = z.object({
  token: z.string().min(1),
  user: sessionUserSchema,
});

export type LoginResult = z.infer<typeof loginResultSchema>;

/** A reusable "authenticated but not currently permitted" shape for guards. */
export const requiresPermissionSchema = z.object({
  permission: permissionCodeSchema,
});
