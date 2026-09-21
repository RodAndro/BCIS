import { ERROR_CODES, isAppError, type ErrorCode, type ErrorDetails } from '@bcis/shared';
import type { ApiErrorBody } from '@bcis/validation';
import fp from 'fastify-plugin';

/**
 * Central error handling.
 *
 * ── THE CONTRACT ────────────────────────────────────────────────────────────
 * Every failure — validation, authorization, a business rule, a database
 * constraint, or an outright bug — leaves this handler as the same shape:
 *
 *   { "error": { "code": "...", "message": "...", "requestId": "..." } }
 *
 * `code` is stable and machine-readable so the desktop client can react
 * precisely; `message` is presentational. §31 requires that a duplicate GCash
 * reference produce "This GCash reference has already been recorded." rather
 * than "PostgreSQL error 23505", so nothing technical is ever placed in
 * `message`.
 *
 * ── WHAT IS DELIBERATELY NOT RETURNED ───────────────────────────────────────
 *   - SQLSTATE codes and constraint names
 *   - stack traces
 *   - the connection string
 *   - driver internals
 * All of it goes to the structured log, correlated by the same requestId, so a
 * developer can still diagnose the failure without exposing it to a user.
 */

/**
 * A PostgreSQL SQLSTATE, as emitted by node-postgres.
 *
 * ── WHY THE SHAPE CHECK ─────────────────────────────────────────────────────
 * Fastify errors ALSO carry a `code` property, but as strings like
 * `FST_ERR_VALIDATION`. Matching on `code` alone would misclassify framework
 * errors as database errors. node-postgres attaches `severity` and `routine`
 * to its errors, so requiring one of those makes the two unambiguous.
 */
const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;

function readSqlState(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;

  const candidate = error as { code?: unknown; severity?: unknown; routine?: unknown };
  if (typeof candidate.code !== 'string') return null;
  if (!SQLSTATE_PATTERN.test(candidate.code)) return null;

  const hasDriverShape =
    'severity' in candidate || 'routine' in candidate || 'constraint' in candidate;

  return hasDriverShape ? candidate.code : null;
}

interface SqlStateMapping {
  readonly code: ErrorCode;
  readonly message: string;
}

/**
 * Database constraints mapped to user-facing outcomes.
 *
 * These messages are intentionally generic. The specific, helpful message is
 * produced by the domain service, which knows *which* unique constraint it was
 * attempting — for example, the GCash reference check in Phase 5 answers with
 * DUPLICATE_GCASH_REFERENCE before the index is ever reached. This table is the
 * safety net for a constraint the service did not anticipate, and it must not
 * leak the constraint name.
 */
const SQL_STATE_MAPPINGS: Record<string, SqlStateMapping> = {
  '23505': { code: ERROR_CODES.CONFLICT, message: 'That record already exists.' },
  '23503': {
    code: ERROR_CODES.CONFLICT,
    message: 'A record this depends on does not exist.',
  },
  '23514': {
    code: ERROR_CODES.CONFLICT,
    message: 'A value did not satisfy a data integrity rule.',
  },
  '23502': {
    code: ERROR_CODES.VALIDATION_FAILED,
    message: 'A required value was missing.',
  },
  '40001': {
    code: ERROR_CODES.CONFLICT,
    message: 'The record was changed by another user. Reload and try again.',
  },
  '40P01': {
    code: ERROR_CODES.CONFLICT,
    message: 'The record was busy. Try again.',
  },
};

function buildErrorBody(
  code: ErrorCode,
  message: string,
  requestId: string,
  details: ErrorDetails | undefined,
): ApiErrorBody {
  return {
    error: {
      code,
      message,
      requestId,
      ...(details === undefined ? {} : { details }),
    },
  };
}

/** One entry from Fastify's schema validation failure list. */
interface ValidationIssue {
  readonly instancePath: string;
}

/**
 * The parts of a Fastify error this handler reacts to.
 *
 * Fastify types the handler parameter as `unknown`, because a handler can
 * receive anything that was thrown — including a non-Error value. Declaring the
 * shape we actually inspect keeps the narrowing explicit and stops `any` from
 * spreading through the handler.
 */
interface InspectableError {
  readonly validation?: readonly ValidationIssue[];
  readonly statusCode?: number;
  readonly constraint?: string;
}

export default fp(
  async (app) => {
    app.setNotFoundHandler((request, reply) => {
      void reply
        .code(404)
        .send(
          buildErrorBody(
            ERROR_CODES.ROUTE_NOT_FOUND,
            `No endpoint matches ${request.method} ${request.url}.`,
            request.id,
            undefined,
          ),
        );
    });

    app.setErrorHandler((error: unknown, request, reply) => {
      const requestId = request.id;

      // 1. Errors we raised on purpose. Already safe to show.
      if (isAppError(error)) {
        request.log.info(
          { code: error.code, details: error.details, statusCode: error.httpStatus },
          'application error',
        );
        void reply
          .code(error.httpStatus)
          .send(buildErrorBody(error.code, error.message, requestId, error.details));
        return;
      }

      const inspectable = error as InspectableError;

      // 2. Schema validation performed by Fastify itself.
      if (inspectable.validation !== undefined) {
        const fields = inspectable.validation.map(
          (issue) => issue.instancePath.replace(/^\//, '') || '(root)',
        );
        request.log.info({ validation: inspectable.validation }, 'request validation failed');
        void reply
          .code(422)
          .send(
            buildErrorBody(
              ERROR_CODES.VALIDATION_FAILED,
              'The request contained invalid data.',
              requestId,
              { fields },
            ),
          );
        return;
      }

      // 3. Database constraint violations that reached us unmapped.
      const sqlState = readSqlState(error);
      if (sqlState !== null) {
        const mapping = SQL_STATE_MAPPINGS[sqlState];
        request.log.error(
          { sqlState, constraint: inspectable.constraint },
          'unmapped database error',
        );
        if (mapping !== undefined) {
          void reply
            .code(sqlState.startsWith('23') ? 409 : 503)
            .send(buildErrorBody(mapping.code, mapping.message, requestId, undefined));
          return;
        }
      }

      // 4. Anything else is a bug. Log it fully; tell the user nothing.
      const statusCode = typeof inspectable.statusCode === 'number' ? inspectable.statusCode : 500;
      request.log.error({ err: error }, 'unhandled error');

      void reply
        .code(statusCode >= 400 && statusCode < 500 ? statusCode : 500)
        .send(
          buildErrorBody(
            ERROR_CODES.INTERNAL_ERROR,
            'Something went wrong. Please try again, and report this to the administrator ' +
              `with reference ${requestId}.`,
            requestId,
            undefined,
          ),
        );
    });
  },
  { name: 'error-handler' },
);
