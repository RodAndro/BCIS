import { schema } from '@bcis/database';
import type { AuditListQuery } from '@bcis/validation';
import { and, count, desc, eq, gte, lte, type SQL } from 'drizzle-orm';

import type { Executor } from '../../shared/database';
import type { AuditAction, AuditEntity } from './audit.actions';

/**
 * Audit log queries.
 *
 * Append-only by design and by database trigger (see the Phase 2 migration):
 * there is no update or delete function here because there is no legal
 * operation to perform.
 */

export interface AuditInsert {
  readonly action: AuditAction;
  readonly entityType: AuditEntity | string;
  readonly entityId: string | null;
  readonly actorUserId: number | null;
  readonly sessionId: number | null;
  readonly reason: string | null;
  readonly oldValues: unknown;
  readonly newValues: unknown;
  readonly ip: string | null;
}

export async function insertAuditLog(db: Executor, entry: AuditInsert): Promise<void> {
  await db.insert(schema.auditLogs).values({
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    actorUserId: entry.actorUserId,
    sessionId: entry.sessionId,
    reason: entry.reason,
    // JSONB columns: `undefined` would be omitted, so an absent snapshot is
    // written as null explicitly, which is what makes "no snapshot" and "empty
    // snapshot" distinguishable.
    oldValues: entry.oldValues ?? null,
    newValues: entry.newValues ?? null,
    ip: entry.ip,
  });
}

export interface AuditQueryBounds {
  /** Inclusive lower bound, as a UTC instant. */
  readonly from: Date | null;
  /** Exclusive upper bound, as a UTC instant. */
  readonly to: Date | null;
}

export interface AuditRow {
  readonly id: number;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly reason: string | null;
  readonly actorUserId: number | null;
  readonly actorUsername: string | null;
  readonly oldValues: unknown;
  readonly newValues: unknown;
  readonly ip: string | null;
  readonly createdAt: Date;
}

function buildFilters(query: AuditListQuery, bounds: AuditQueryBounds): SQL | undefined {
  const conditions: SQL[] = [];

  if (query.action !== undefined) conditions.push(eq(schema.auditLogs.action, query.action));
  if (query.entityType !== undefined)
    conditions.push(eq(schema.auditLogs.entityType, query.entityType));
  if (query.actorUserId !== undefined)
    conditions.push(eq(schema.auditLogs.actorUserId, query.actorUserId));
  if (bounds.from !== null) conditions.push(gte(schema.auditLogs.createdAt, bounds.from));
  if (bounds.to !== null) conditions.push(lte(schema.auditLogs.createdAt, bounds.to));

  if (conditions.length === 0) return undefined;
  return and(...conditions);
}

export async function listAuditLogs(
  db: Executor,
  query: AuditListQuery,
  bounds: AuditQueryBounds,
  offset: number,
): Promise<readonly AuditRow[]> {
  const rows = await db
    .select({
      id: schema.auditLogs.id,
      action: schema.auditLogs.action,
      entityType: schema.auditLogs.entityType,
      entityId: schema.auditLogs.entityId,
      reason: schema.auditLogs.reason,
      actorUserId: schema.auditLogs.actorUserId,
      actorUsername: schema.users.username,
      oldValues: schema.auditLogs.oldValues,
      newValues: schema.auditLogs.newValues,
      ip: schema.auditLogs.ip,
      createdAt: schema.auditLogs.createdAt,
    })
    .from(schema.auditLogs)
    // Left join: a failed sign-in for an unknown username has no actor, and
    // those rows must still appear.
    .leftJoin(schema.users, eq(schema.auditLogs.actorUserId, schema.users.id))
    .where(buildFilters(query, bounds))
    .orderBy(desc(schema.auditLogs.createdAt), desc(schema.auditLogs.id))
    .limit(query.pageSize)
    .offset(offset);

  return rows;
}

export async function countAuditLogs(
  db: Executor,
  query: AuditListQuery,
  bounds: AuditQueryBounds,
): Promise<number> {
  const rows = await db
    .select({ total: count() })
    .from(schema.auditLogs)
    .where(buildFilters(query, bounds));

  return rows[0]?.total ?? 0;
}
