/**
 * @bcis/validation — Zod schemas shared by the API and the desktop client.
 *
 * The API uses these to validate inbound requests. The desktop client uses the
 * same schemas for form validation and to parse responses, so a server-side
 * rule change surfaces in the UI rather than silently diverging.
 */

export {
  businessDateSchema,
  centavosSchema,
  idParamSchema,
  idSchema,
  noteSchema,
  pesoInputSchema,
  quantitySchema,
  reasonSchema,
  shortTextSchema,
  signedCentavosSchema,
} from './primitives';

export {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  buildPageMeta,
  dateRangeQuerySchema,
  offsetFor,
  paginationQuerySchema,
  sortDirectionSchema,
  sortQuerySchema,
} from './pagination';
export type {
  DateRangeQuery,
  PageMeta,
  PaginationQuery,
  SortDirection,
  SortQuery,
} from './pagination';

export {
  apiErrorSchema,
  apiSuccessSchema,
  errorCodeSchema,
  livenessSchema,
  paginatedBody,
  readinessSchema,
  successBody,
} from './http';
export type { ApiErrorBody, ApiSuccessBody, Liveness, Readiness } from './http';
