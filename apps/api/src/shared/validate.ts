import { ValidationError, type ErrorDetails } from '@bcis/shared';
import type { ZodType } from 'zod';

/**
 * Validate external input with Zod and fail as an application error.
 *
 * ── WHY NOT FASTIFY `schema:` ───────────────────────────────────────────────
 * Fastify validates with AJV against JSON Schema. The project authors its rules
 * as Zod schemas in `@bcis/validation` so the API and the desktop client share
 * one definition. Without this helper a raw `ZodError` would reach the central
 * error handler, match no branch, and be reported as an internal 500 — the
 * validation failure would look like a server bug to the user and to the log.
 *
 * Converting here means a bad field produces the same `422 VALIDATION_FAILED`
 * envelope with per-field details that a Fastify schema failure would.
 */
export function parseInput<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);

  if (result.success) {
    return result.data;
  }

  const details: ErrorDetails = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || 'request';
    // First message wins: later issues on the same field are usually the same
    // complaint restated by another refine step.
    details[key] = issue.message;
  }

  throw new ValidationError('The request contained invalid data.', details);
}
