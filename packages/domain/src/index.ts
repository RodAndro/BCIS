/**
 * @bcis/domain — pure business rules.
 *
 * NOTHING in this package may import Fastify, Drizzle, React, Electron, or any
 * I/O. That restriction is what makes these rules unit-testable in isolation
 * and quotable during a defense: `allocation.ts` states the oldest-first rule
 * in readable code with no infrastructure in the way.
 *
 * Rules live here when they are pure. Rules that need to read or write the
 * database live in `apps/api/src/modules/<module>/*.service.ts`, which calls
 * into this package for the calculation.
 */

export {
  AllocationError,
  allocateAsDirected,
  allocateOldestFirst,
  assertAllocationsWithinBalances,
  compareInvoicePriority,
} from './allocation';
export type { AllocatableInvoice, AllocationLine, AllocationResult } from './allocation';

export {
  BillingError,
  DISPLAY_INVOICE_STATUSES,
  STORED_INVOICE_STATUSES,
  adjustmentLine,
  billingPeriodFor,
  chargeLine,
  computeInvoiceDates,
  computeInvoiceTotals,
  discountLine,
  displayStatusFor,
  isOpenInvoice,
  isPenaltyDue,
  monthKeyOf,
  occurredWithin,
  penaltyThreshold,
  summariseLines,
} from './billing';
export type {
  BillingPeriod,
  DisplayInvoiceStatus,
  InvoiceDates,
  InvoiceItemDirection,
  InvoiceItemType,
  InvoiceLine,
  InvoiceTotals,
  LineTotals,
  StoredInvoiceStatus,
} from './billing';

export { computeBatchTotals, computeRemittanceVariance, remittanceCloseBlockers } from './variance';
export type { BatchTotals, BatchTotalsInput, RemittanceVariance, VarianceType } from './variance';
