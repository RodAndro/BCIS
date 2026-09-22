import { z } from 'zod';

import { paginationQuerySchema } from './pagination';

/**
 * Audit log contracts.
 *
 * The audit log is append-only and is read with `audit.view`. `old_values` and
 * `new_values` are `unknown` rather than a typed shape because the entity they
 * describe varies; the screen renders them as JSON. They are guaranteed by the
 * writing services never to contain a password or a token.
 */

export const auditEntrySchema = z.object({
  id: z.number().int().positive(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  reason: z.string().nullable(),
  actorUserId: z.number().int().positive().nullable(),
  /** Resolved for display; null when the actor no longer exists. */
  actorUsername: z.string().nullable(),
  oldValues: z.unknown().nullable(),
  newValues: z.unknown().nullable(),
  ip: z.string().nullable(),
  createdAt: z.string(),
});

export type AuditEntry = z.infer<typeof auditEntrySchema>;

export const auditListQuerySchema = paginationQuerySchema.extend({
  action: z.string().trim().max(60).optional(),
  entityType: z.string().trim().max(60).optional(),
  actorUserId: z.coerce.number().int().positive().optional(),
  /** Inclusive business-date bounds, `YYYY-MM-DD`, interpreted in Asia/Manila. */
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
});

export type AuditListQuery = z.infer<typeof auditListQuerySchema>;
