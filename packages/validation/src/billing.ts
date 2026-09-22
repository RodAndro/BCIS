import { DISPLAY_INVOICE_STATUSES, STORED_INVOICE_STATUSES } from '@bcis/shared';
import { z } from 'zod';

import { paginationQuerySchema } from './pagination';
import {
  businessDateSchema,
  centavosSchema,
  idSchema,
  reasonSchema,
  signedCentavosSchema,
} from './primitives';

/**
 * Billing and ledger contracts.
 *
 * ── WHY THE ENUMS COME FROM @bcis/domain ────────────────────────────────────
 * The stored invoice statuses and the derived display statuses are defined once,
 * in the pure rules package, and both the Zod schema and the SQL CHECK
 * constraint are written against the same list. A status added in one place
 * cannot be silently missing in another.
 */

export const storedInvoiceStatusSchema = z.enum([...STORED_INVOICE_STATUSES] as [
  string,
  ...string[],
]);

export const displayInvoiceStatusSchema = z.enum([...DISPLAY_INVOICE_STATUSES] as [
  string,
  ...string[],
]);

export type StoredInvoiceStatusValue = z.infer<typeof storedInvoiceStatusSchema>;
export type DisplayInvoiceStatusValue = z.infer<typeof displayInvoiceStatusSchema>;

export const billingCycleStatusSchema = z.enum([
  'OPEN',
  'GENERATING',
  'GENERATED',
  'CLOSED',
  'LOCKED',
]);

/** A billing month, `YYYY-MM`. */
export const billingMonthSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Enter a billing month as YYYY-MM, for example 2026-09.');

export const billingCycleSummarySchema = z.object({
  id: idSchema,
  periodStart: businessDateSchema,
  periodEnd: businessDateSchema,
  dueDate: businessDateSchema,
  label: z.string(),
  status: billingCycleStatusSchema,
  generatedAt: z.string().nullable(),
  invoiceCount: z.number().int().nonnegative(),
  /** The sum of every live invoice in the cycle. */
  billedCentavos: centavosSchema,
});

export type BillingCycleSummary = z.infer<typeof billingCycleSummarySchema>;

/**
 * Generate billing, or ask what it would do.
 *
 * `dryRun` is the default. A preview is the safe thing to reach for, so the
 * destructive option is the one that has to be asked for explicitly.
 */
export const generateBillingSchema = z.object({
  month: billingMonthSchema,
  dryRun: z.boolean().default(true),
  /** Create the invoices unposted, so a human can review before posting. */
  asDraft: z.boolean().default(false),
  /** Narrow the run to one collection area. */
  collectionAreaId: idSchema.optional(),
  /** Narrow the run to specific accounts, for a re-run after a fix. */
  serviceAccountIds: z.array(idSchema).max(500).optional(),
});

export type GenerateBillingInput = z.infer<typeof generateBillingSchema>;

export const invoiceItemSchema = z.object({
  id: idSchema,
  itemType: z.enum([
    'SUBSCRIPTION',
    'INSTALLATION',
    'RECONNECTION',
    'DISCOUNT',
    'PENALTY',
    'ADJUSTMENT',
  ]),
  direction: z.enum(['DEBIT', 'CREDIT']),
  description: z.string(),
  quantity: z.number().int().positive(),
  /** The rate snapshotted when this line was priced. Never joined live. */
  unitPriceCentavos: centavosSchema,
  /** A positive magnitude; `direction` says which way it moves the total. */
  amountCentavos: centavosSchema,
});

export type InvoiceItem = z.infer<typeof invoiceItemSchema>;

/** One prospective invoice, as shown in a preview. */
export const billingPreviewLineSchema = z.object({
  serviceAccountId: idSchema,
  accountNumber: z.string(),
  subscriberAccountNumber: z.string(),
  subscriberName: z.string(),
  planCode: z.string(),
  planName: z.string(),
  issueDate: businessDateSchema,
  dueDate: businessDateSchema,
  items: z.array(
    z.object({
      itemType: z.enum(['SUBSCRIPTION', 'INSTALLATION', 'RECONNECTION']),
      description: z.string(),
      quantity: z.number().int().positive(),
      unitPriceCentavos: centavosSchema,
      amountCentavos: centavosSchema,
    }),
  ),
  totalCentavos: centavosSchema,
});

export type BillingPreviewLine = z.infer<typeof billingPreviewLineSchema>;

/** An account the run will not bill, and why. */
export const billingSkipSchema = z.object({
  serviceAccountId: idSchema,
  accountNumber: z.string(),
  subscriberName: z.string(),
  reason: z.string(),
});

export type BillingSkip = z.infer<typeof billingSkipSchema>;

export const billingPreviewSchema = z.object({
  period: z.object({
    periodStart: businessDateSchema,
    periodEnd: businessDateSchema,
    label: z.string(),
  }),
  cycle: billingCycleSummarySchema.nullable(),
  willInvoice: z.array(billingPreviewLineSchema),
  willSkip: z.array(billingSkipSchema),
  totalCentavos: centavosSchema,
});

export type BillingPreview = z.infer<typeof billingPreviewSchema>;

export const billingRunResultSchema = z.object({
  dryRun: z.boolean(),
  asDraft: z.boolean(),
  period: z.object({
    periodStart: businessDateSchema,
    periodEnd: businessDateSchema,
    label: z.string(),
  }),
  invoicesCreated: z.number().int().nonnegative(),
  accountsSkipped: z.number().int().nonnegative(),
  totalCentavos: centavosSchema,
  invoiceNumbers: z.array(z.string()),
  skipped: z.array(billingSkipSchema),
});

export type BillingRunResult = z.infer<typeof billingRunResultSchema>;

/** An invoice as it appears in a list. */
export const invoiceSummarySchema = z.object({
  id: idSchema,
  invoiceNumber: z.string(),
  subscriberId: idSchema,
  subscriberAccountNumber: z.string(),
  subscriberName: z.string(),
  serviceAccountId: idSchema,
  serviceAccountNumber: z.string(),
  planCode: z.string(),
  billingPeriodStart: businessDateSchema,
  billingPeriodEnd: businessDateSchema,
  issueDate: businessDateSchema,
  dueDate: businessDateSchema,
  subtotalCentavos: centavosSchema,
  discountCentavos: centavosSchema,
  penaltyCentavos: centavosSchema,
  adjustmentCentavos: signedCentavosSchema,
  taxCentavos: centavosSchema,
  totalCentavos: centavosSchema,
  paidCentavos: centavosSchema,
  balanceCentavos: centavosSchema,
  /** The stored lifecycle state. */
  status: storedInvoiceStatusSchema,
  /** The same plus OVERDUE, derived from the due date and the balance. */
  displayStatus: displayInvoiceStatusSchema,
  finalizedAt: z.string().nullable(),
  voidedAt: z.string().nullable(),
  voidReason: z.string().nullable(),
  createdAt: z.string(),
});

export type InvoiceSummary = z.infer<typeof invoiceSummarySchema>;

export const invoiceDetailSchema = invoiceSummarySchema.extend({
  /** Which plan version priced the recurring charge. */
  servicePlanId: idSchema,
  items: z.array(invoiceItemSchema),
  adjustments: z.array(
    z.object({
      id: idSchema,
      adjustmentType: z.enum(['DEBIT', 'CREDIT']),
      reasonCode: z.string(),
      amountCentavos: centavosSchema,
      memo: z.string(),
      status: z.string(),
      createdAt: z.string(),
      createdByUsername: z.string().nullable(),
    }),
  ),
});

export type InvoiceDetail = z.infer<typeof invoiceDetailSchema>;

/**
 * Draft the invoice for review, or post it now.
 *
 * Posting is what writes the ledger debit, which is why it is a separate call
 * rather than a flag on creation: the two steps are different decisions.
 */
export const finalizeInvoiceSchema = z.object({
  /** Optional override for the business date the ledger entry falls on. */
  entryDate: businessDateSchema.optional(),
});

export type FinalizeInvoiceInput = z.infer<typeof finalizeInvoiceSchema>;

/**
 * Void an invoice.
 *
 * A reason is mandatory. Voiding does not erase the invoice: the number stays
 * reserved, the original lines stay readable, and the ledger is balanced by a
 * reversing credit rather than by a deletion.
 */
export const voidInvoiceSchema = z.object({
  reason: reasonSchema,
});

export type VoidInvoiceInput = z.infer<typeof voidInvoiceSchema>;

/** Stable reason vocabulary for adjustments, so reports can group them. */
export const ADJUSTMENT_REASON_CODES = [
  'BILLING_ERROR',
  'GOODWILL',
  'SERVICE_OUTAGE',
  'STATUTORY_DISCOUNT',
  'PROMOTIONAL_DISCOUNT',
  'RECONNECTION_FEE_WAIVER',
  'LATE_FEE_WAIVER',
  /** Written only by the penalty run, never by hand. */
  'LATE_FEE',
  'OTHER',
] as const;

export const adjustmentReasonCodeSchema = z.enum(ADJUSTMENT_REASON_CODES);

/**
 * Post an adjustment against an invoice.
 *
 * `amountCentavos` is a positive magnitude and `adjustmentType` says which side
 * it lands on, so a credit can never be smuggled in as a negative debit.
 */
export const createAdjustmentSchema = z.object({
  adjustmentType: z.enum(['DEBIT', 'CREDIT']),
  amountCentavos: centavosSchema.refine((value) => value > 0, 'Enter an amount greater than zero.'),
  reasonCode: adjustmentReasonCodeSchema,
  memo: reasonSchema,
});

export type CreateAdjustmentInput = z.infer<typeof createAdjustmentSchema>;

/**
 * Apply penalties to the invoices that are past their grace period.
 *
 * Off by default: `billing.penalty_enabled` is false in the seeded settings, so
 * this is an explicit commercial decision rather than something that happens
 * because a month went by.
 */
export const applyPenaltiesSchema = z.object({
  asOf: businessDateSchema.optional(),
  dryRun: z.boolean().default(true),
});

export type ApplyPenaltiesInput = z.infer<typeof applyPenaltiesSchema>;

export const invoiceListQuerySchema = paginationQuerySchema.extend({
  /** Matches invoice number, subscriber account number, or subscriber name. */
  search: z.string().trim().max(120).optional(),
  status: storedInvoiceStatusSchema.optional(),
  /** Filter by the derived state, which is what an operator actually asks for. */
  displayStatus: displayInvoiceStatusSchema.optional(),
  month: billingMonthSchema.optional(),
  subscriberId: z.coerce.number().int().positive().optional(),
  serviceAccountId: z.coerce.number().int().positive().optional(),
});

export type InvoiceListQuery = z.infer<typeof invoiceListQuerySchema>;

export const invoiceIdParamSchema = z.object({ id: z.coerce.number().int().positive() });

/** One line of a subscriber's statement. */
export const ledgerEntrySchema = z.object({
  id: idSchema,
  entryDate: businessDateSchema,
  entryType: z.enum([
    'INVOICE',
    'PAYMENT',
    'ADJUSTMENT',
    'REVERSAL',
    'CREDIT_APPLIED',
    'CREDIT_ISSUED',
  ]),
  sourceType: z.string(),
  sourceId: z.number().int().positive(),
  referenceNo: z.string().nullable(),
  description: z.string(),
  debitCentavos: centavosSchema,
  creditCentavos: centavosSchema,
  /** Derived from the entries before it. Never stored. */
  balanceCentavos: signedCentavosSchema,
  createdAt: z.string(),
});

export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;

export const ledgerStatementSchema = z.object({
  subscriber: z.object({
    id: idSchema,
    accountNumber: z.string(),
    displayName: z.string(),
  }),
  serviceAccount: z
    .object({
      id: idSchema,
      accountNumber: z.string(),
      planName: z.string(),
    })
    .nullable(),
  entries: z.array(ledgerEntrySchema),
  openingBalanceCentavos: signedCentavosSchema,
  closingBalanceCentavos: signedCentavosSchema,
  totalDebitCentavos: centavosSchema,
  totalCreditCentavos: centavosSchema,
});

export type LedgerStatement = z.infer<typeof ledgerStatementSchema>;

export const ledgerQuerySchema = paginationQuerySchema.extend({
  subscriberId: z.coerce.number().int().positive().optional(),
  serviceAccountId: z.coerce.number().int().positive().optional(),
  /** Inclusive business-date bounds on the entry date. */
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
});

export type LedgerQuery = z.infer<typeof ledgerQuerySchema>;

/** The dashboard's headline figures. Billing only — AR aging arrives in Phase 7. */
export const billingDashboardSchema = z.object({
  currentPeriod: z.object({
    periodStart: businessDateSchema,
    periodEnd: businessDateSchema,
    label: z.string(),
  }),
  invoicesThisPeriod: z.number().int().nonnegative(),
  billedThisPeriodCentavos: centavosSchema,
  openInvoices: z.number().int().nonnegative(),
  outstandingCentavos: centavosSchema,
  overdueInvoices: z.number().int().nonnegative(),
  overdueCentavos: centavosSchema,
  draftInvoices: z.number().int().nonnegative(),
  lastCycles: z.array(billingCycleSummarySchema),
});

export type BillingDashboard = z.infer<typeof billingDashboardSchema>;
