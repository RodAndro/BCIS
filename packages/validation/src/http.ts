import { ERROR_CODES } from '@bcis/shared';
import { z } from 'zod';

import { buildPageMeta } from './pagination';

/**
 * The HTTP response contract.
 *
 * Every endpoint answers with one of exactly two shapes. A client therefore
 * never has to guess whether a failure is a transport error, a validation
 * error, or a business rule — `error.code` says so.
 */

/** Machine-readable error codes, mirroring the shared ERROR_CODES table. */
export const errorCodeSchema = z.enum(Object.values(ERROR_CODES) as [string, ...string[]]);

export const apiErrorSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    /**
     * Non-sensitive, field-level context: which field failed validation,
     * which invoice conflicted. Never a SQLSTATE, stack trace, or connection
     * string — those belong in the server log, correlated by requestId.
     */
    details: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]))
      .optional(),
    requestId: z.string(),
  }),
});

export type ApiErrorBody = z.infer<typeof apiErrorSchema>;

export interface ApiSuccessBody<T> {
  readonly data: T;
  readonly meta: ReturnType<typeof buildPageMeta> | null;
}

export function successBody<T>(data: T): ApiSuccessBody<T> {
  return { data, meta: null };
}

export function paginatedBody<T>(
  items: readonly T[],
  page: number,
  pageSize: number,
  total: number,
): ApiSuccessBody<readonly T[]> {
  return { data: items, meta: buildPageMeta(page, pageSize, total) };
}

/** Builds the success envelope schema for a given item schema. */
export function apiSuccessSchema<T extends z.ZodType>(dataSchema: T) {
  return z.object({
    data: dataSchema,
    meta: z
      .object({
        page: z.number(),
        pageSize: z.number(),
        total: z.number(),
        totalPages: z.number(),
        hasNext: z.boolean(),
      })
      .nullable(),
  });
}

/** Liveness. `GET /health`. Never touches the database. */
export const livenessSchema = z.object({
  status: z.literal('ok'),
  service: z.string(),
  version: z.string(),
  uptimeSeconds: z.number().nonnegative(),
  timestamp: z.string(),
});

export type Liveness = z.infer<typeof livenessSchema>;

/**
 * Readiness. `GET /health/db`.
 *
 * Reports the migration state as well as connectivity, because "the database
 * answers" and "the database has the schema this build expects" are different
 * questions, and confusing them produces a running API that fails on first use.
 */
export const readinessSchema = z.object({
  status: z.enum(['ok', 'degraded', 'unavailable']),
  database: z.object({
    connected: z.boolean(),
    latencyMs: z.number().nonnegative(),
    serverVersion: z.string().nullable(),
    appliedMigrations: z.number().int().nonnegative().nullable(),
    /** Migrations present on disk but not applied to this database. */
    pendingMigrations: z.array(z.string()),
  }),
  timestamp: z.string(),
});

export type Readiness = z.infer<typeof readinessSchema>;
