/**
 * Structured error contract shared by the API and the desktop client.
 *
 * Every error that crosses the network boundary carries a stable machine-
 * readable `code`. The renderer switches on the code; the `message` is only
 * ever shown to a human.
 *
 * ── WHY CODES ───────────────────────────────────────────────────────────────
 * The laboratory specification requires that a duplicate GCash reference
 * produce "This GCash reference has already been recorded." rather than a raw
 * PostgreSQL 23505. Matching on message text would be fragile, so the code is
 * the contract and the message is presentational.
 *
 * ── WHY NOT LEAK DETAIL ─────────────────────────────────────────────────────
 * SQLSTATEs, constraint names, stack traces, and connection strings are never
 * placed in `message`. They go to the structured log, correlated by request id.
 */

export const ERROR_CODES = {
  // --- Transport / framework ---------------------------------------------
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  ROUTE_NOT_FOUND: 'ROUTE_NOT_FOUND',
  METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',
  RATE_LIMITED: 'RATE_LIMITED',

  // --- Authentication / authorization ------------------------------------
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  SESSION_LOCKED: 'SESSION_LOCKED',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  /** Signed in, but must change the password before doing anything else. */
  PASSWORD_CHANGE_REQUIRED: 'PASSWORD_CHANGE_REQUIRED',
  FORBIDDEN: 'FORBIDDEN',

  // --- Data integrity -----------------------------------------------------
  CONFLICT: 'CONFLICT',
  DUPLICATE_INVOICE: 'DUPLICATE_INVOICE',
  DUPLICATE_RECEIPT_NUMBER: 'DUPLICATE_RECEIPT_NUMBER',
  DUPLICATE_GCASH_REFERENCE: 'DUPLICATE_GCASH_REFERENCE',
  IMMUTABLE_RECORD: 'IMMUTABLE_RECORD',

  // --- Financial rules ----------------------------------------------------
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  ALLOCATION_EXCEEDS_BALANCE: 'ALLOCATION_EXCEEDS_BALANCE',
  PAYMENT_ALREADY_REVERSED: 'PAYMENT_ALREADY_REVERSED',
  UNAPPROVED_VARIANCE: 'UNAPPROVED_VARIANCE',
  INVALID_STATUS_TRANSITION: 'INVALID_STATUS_TRANSITION',

  // --- Infrastructure -----------------------------------------------------
  DATABASE_UNAVAILABLE: 'DATABASE_UNAVAILABLE',
  STORAGE_UNAVAILABLE: 'STORAGE_UNAVAILABLE',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  INTERNAL_ERROR: 500,
  VALIDATION_FAILED: 422,
  NOT_FOUND: 404,
  ROUTE_NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  RATE_LIMITED: 429,

  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  SESSION_EXPIRED: 401,
  SESSION_LOCKED: 423,
  ACCOUNT_LOCKED: 423,
  ACCOUNT_DISABLED: 403,
  PASSWORD_CHANGE_REQUIRED: 403,
  FORBIDDEN: 403,

  CONFLICT: 409,
  DUPLICATE_INVOICE: 409,
  DUPLICATE_RECEIPT_NUMBER: 409,
  DUPLICATE_GCASH_REFERENCE: 409,
  IMMUTABLE_RECORD: 409,

  INVALID_AMOUNT: 422,
  ALLOCATION_EXCEEDS_BALANCE: 422,
  PAYMENT_ALREADY_REVERSED: 409,
  UNAPPROVED_VARIANCE: 409,
  INVALID_STATUS_TRANSITION: 409,

  DATABASE_UNAVAILABLE: 503,
  STORAGE_UNAVAILABLE: 503,
};

/** Default HTTP status for an error code. */
export function httpStatusForCode(code: ErrorCode): number {
  return STATUS_BY_CODE[code];
}

/** Extra, non-sensitive context attached to an error response. */
export type ErrorDetails = Record<string, string | number | boolean | string[]>;

/**
 * Base class for every error the API deliberately raises.
 *
 * Anything that is *not* an `AppError` reaching the Fastify error handler is
 * treated as an unexpected internal failure: it is logged in full and answered
 * with a generic message.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details: ErrorDetails | undefined;

  constructor(code: ErrorCode, message: string, details?: ErrorDetails) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.httpStatus = httpStatusForCode(code);
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: ErrorDetails) {
    super(ERROR_CODES.VALIDATION_FAILED, message, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, details?: ErrorDetails) {
    super(ERROR_CODES.NOT_FOUND, message, details);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code: ErrorCode = ERROR_CODES.CONFLICT, details?: ErrorDetails) {
    super(code, message, details);
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'Sign in to continue.', code: ErrorCode = ERROR_CODES.UNAUTHENTICATED) {
    super(code, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action.') {
    super(ERROR_CODES.FORBIDDEN, message);
  }
}

/** Raised when the database cannot be reached or the pool is exhausted. */
export class DatabaseUnavailableError extends AppError {
  constructor(message = 'The database is currently unavailable. Please try again.') {
    super(ERROR_CODES.DATABASE_UNAVAILABLE, message);
  }
}

/** Narrowing helper for `catch (error: unknown)`. */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
