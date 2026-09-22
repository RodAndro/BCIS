import {
  ValidationError,
  businessDateStartUtc,
  businessDayRangeUtc,
  isBusinessDate,
} from '@bcis/shared';
import { offsetFor, type AuditEntry, type AuditListQuery } from '@bcis/validation';

import type { Db, Executor } from '../../shared/database';
import { toAuditEntry } from './audit.mapper';
import {
  countAuditLogs,
  insertAuditLog,
  listAuditLogs,
  type AuditInsert,
  type AuditQueryBounds,
} from './audit.repository';

/**
 * Audit service.
 *
 * ── THE ONE RULE ────────────────────────────────────────────────────────────
 * `writeAudit` is called inside the same transaction as the change it
 * describes. If the audit write fails, the change rolls back — so a mutation
 * that happened without a record is impossible, which is what makes the log
 * trustworthy rather than best-effort.
 *
 * ── WHAT MUST NEVER APPEAR IN A SNAPSHOT ────────────────────────────────────
 * A password, a password hash, a session token, or a token hash. Callers
 * construct the snapshots explicitly field by field; they never pass a whole
 * row, which is how a hash would otherwise end up in the log.
 */

export interface AuditDescriptor {
  readonly action: AuditInsert['action'];
  readonly entityType: AuditInsert['entityType'];
  readonly entityId?: string | null;
  readonly actorUserId?: number | null;
  readonly sessionId?: number | null;
  readonly reason?: string | null;
  readonly oldValues?: unknown;
  readonly newValues?: unknown;
  readonly ip?: string | null;
}

export async function writeAudit(db: Executor, descriptor: AuditDescriptor): Promise<void> {
  await insertAuditLog(db, {
    action: descriptor.action,
    entityType: descriptor.entityType,
    entityId: descriptor.entityId ?? null,
    actorUserId: descriptor.actorUserId ?? null,
    sessionId: descriptor.sessionId ?? null,
    reason: descriptor.reason ?? null,
    oldValues: descriptor.oldValues,
    newValues: descriptor.newValues,
    ip: descriptor.ip ?? null,
  });
}

/**
 * Resolve business-date filters to a UTC instant range.
 *
 * The report-day boundary is Asia/Manila, so a row written at 07:00 local must
 * be included in that local day's audit view even though it is the previous day
 * in UTC. `to` is exclusive, which is why the range helper is used rather than
 * adding 24 hours here.
 */
export function resolveAuditBounds(query: AuditListQuery): AuditQueryBounds {
  let from: Date | null = null;
  let to: Date | null = null;

  if (query.from !== undefined && query.from.length > 0) {
    if (!isBusinessDate(query.from)) {
      throw new ValidationError('The "from" date must be a valid date.', { field: 'from' });
    }
    from = businessDateStartUtc(query.from);
  }

  if (query.to !== undefined && query.to.length > 0) {
    if (!isBusinessDate(query.to)) {
      throw new ValidationError('The "to" date must be a valid date.', { field: 'to' });
    }
    to = businessDayRangeUtc(query.to).end;
  }

  return { from, to };
}

export interface AuditPage {
  readonly entries: readonly AuditEntry[];
  readonly total: number;
}

export async function queryAuditLog(db: Db, query: AuditListQuery): Promise<AuditPage> {
  const bounds = resolveAuditBounds(query);
  const offset = offsetFor(query.page, query.pageSize);

  const [rows, total] = await Promise.all([
    listAuditLogs(db, query, bounds, offset),
    countAuditLogs(db, query, bounds),
  ]);

  return { entries: rows.map(toAuditEntry), total };
}
