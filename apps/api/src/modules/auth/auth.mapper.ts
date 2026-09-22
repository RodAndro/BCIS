import type { SessionUser } from '@bcis/validation';

import type { AuthUserRow, GrantSet } from './auth.repository';

/**
 * Row → DTO for authentication.
 *
 * ── WHAT MUST NEVER LEAVE THIS FUNCTION ─────────────────────────────────────
 * `passwordHash`. The projection is built field by field rather than by
 * spreading the row, so a column added to `users` later cannot reach the client
 * without someone deliberately adding it here.
 *
 * Permissions are sorted so the desktop client's permission checks and any
 * snapshot taken of them are stable between requests.
 */
export function toSessionUser(user: AuthUserRow, grants: GrantSet): SessionUser {
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    status: user.status,
    mustChangePassword: user.mustChangePassword,
    roles: [...grants.roles].sort(),
    permissions: [...grants.permissions].sort(),
  };
}
