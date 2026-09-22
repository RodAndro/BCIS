/**
 * @bcis/shared — cross-cutting primitives with no dependency on Fastify,
 * Drizzle, React, or Electron.
 *
 * Everything here is pure and synchronous so it can be used identically in the
 * API, in the desktop main process, in the renderer, and in tests.
 */

export {
  CENTAVOS_PER_PESO,
  MAX_CENTAVOS,
  MoneyError,
  PESO_SIGN,
  SIGNED_ZERO,
  ZERO,
  addCentavos,
  addSignedCentavos,
  applyRateBasisPoints,
  centavos,
  compareCentavos,
  deserializeCentavos,
  equalsCentavos,
  formatCentavos,
  formatCentavosPlain,
  isNegative,
  isPositive,
  isValidAmountInput,
  isZero,
  maxCentavos,
  minCentavos,
  negateCentavos,
  nonNegative,
  nonPositive,
  parseCentavos,
  serializeCentavos,
  signedCentavos,
  subtractCentavos,
  sumCentavos,
  sumSignedCentavos,
} from './money';
export type { Centavos, SignedCentavos } from './money';

export {
  ALL_PERMISSIONS,
  ALL_ROLE_CODES,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  ROLE_CODES,
  ROLE_LABELS,
} from './permissions';
export type { Permission, RoleCode } from './permissions';

export {
  AppError,
  ConflictError,
  DatabaseUnavailableError,
  ERROR_CODES,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
  httpStatusForCode,
  isAppError,
} from './errors';
export type { ErrorCode, ErrorDetails } from './errors';

export {
  ALLOWED_STATUS_TRANSITIONS,
  SERVICE_ACCOUNT_STATUSES,
  SERVICE_ACCOUNT_STATUS_LABELS,
  SERVICE_EVENT_TYPES,
  canTransitionServiceStatus,
  eventTypeForTransition,
  isServiceDelivering,
} from './service-lifecycle';
export type { ServiceAccountStatus, ServiceEventType } from './service-lifecycle';

export { DISPLAY_INVOICE_STATUSES, STORED_INVOICE_STATUSES } from './invoice-status';
export type { DisplayInvoiceStatus, StoredInvoiceStatus } from './invoice-status';

export {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUSES,
  PAYMENT_STATUS_LABELS,
  RECEIPT_STATUSES,
  canReversePayment,
  paymentMethodCarriesReference,
  paymentMethodRequiresVerification,
} from './payment';
export type { PaymentMethod, PaymentStatus, ReceiptStatus } from './payment';

export {
  BUSINESS_TIMEZONE,
  BUSINESS_UTC_OFFSET_MINUTES,
  DateError,
  addBusinessDays,
  addBusinessMonths,
  businessDateStartUtc,
  businessDayRangeUtc,
  businessMonthKey,
  businessMonthPeriod,
  businessToday,
  daysBetween,
  daysInBusinessMonth,
  endOfBusinessMonth,
  formatBusinessDate,
  formatBusinessMonthLabel,
  isBusinessDate,
  startOfBusinessMonth,
  toBusinessDate,
} from './time';
export type { BusinessDate } from './time';
