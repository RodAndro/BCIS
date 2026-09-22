import type { AuditEntry } from '@bcis/validation';

import type { AuditRow } from './audit.repository';

/**
 * Row → DTO.
 *
 * Timestamps become ISO-8601 strings at the edge. Keeping `Date` objects out of
 * the response shape means the desktop client parses one representation and
 * formats in Asia/Manila, rather than relying on the transport's rendering.
 */
export function toAuditEntry(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    reason: row.reason,
    actorUserId: row.actorUserId,
    actorUsername: row.actorUsername,
    oldValues: row.oldValues ?? null,
    newValues: row.newValues ?? null,
    ip: row.ip,
    createdAt: row.createdAt.toISOString(),
  };
}
