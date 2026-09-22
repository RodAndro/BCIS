import type { UserSummary } from '@bcis/validation';

import type { UserAdminRow } from './users.repository';

/**
 * Row → DTO for user administration.
 *
 * `lockedOut` is derived rather than stored: a temporary lockout is a function
 * of `lockedUntil` and the current time, and storing it as a status would mean
 * a background job to clear it — and a window in which it is wrong.
 */
export function toUserSummary(row: UserAdminRow, now: Date = new Date()): UserSummary {
  return {
    id: row.id,
    username: row.username,
    fullName: row.fullName,
    status: row.status,
    mustChangePassword: row.mustChangePassword,
    lockedOut: row.lockedUntil !== null && row.lockedUntil.getTime() > now.getTime(),
    lastLoginAt: row.lastLoginAt === null ? null : row.lastLoginAt.toISOString(),
    roles: [...row.roles].sort(),
    createdAt: row.createdAt.toISOString(),
  };
}
