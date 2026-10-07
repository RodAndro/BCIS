import { PAYMENT_METHODS, PAYMENT_STATUSES } from '@bcis/shared';
import type { PaymentMethod, PaymentStatus } from '@bcis/shared';
import { z } from 'zod';

import { paginationQuerySchema } from './pagination';
import {
  businessDateSchema,
  centavosSchema,
  idSchema,
  noteSchema,
  reasonSchema,
} from './primitives';

/**
 * Payment contracts.
 *
 * ── WHY THE METHOD / STATUS ENUMS COME FROM @bcis/shared ─────────────────────
 * The same list feeds the SQL CHECK constraints in `payments`, the service
 * rules, and these schemas, so a state cannot exist in one layer and be missing
 * from another.
 */

export const paymentMethodSchema = z.enum([...PAYMENT_METHODS] as [
  PaymentMethod,
  ...PaymentMethod[],
]);
export const paymentStatusSchema = z.enum([...PAYMENT_STATUSES] as [
  PaymentStatus,
  ...PaymentStatus[],
]);

/** Reversal reason codes, shared with `ck_payment_reversals_reason_code`. */
export const paymentReversalReasonCodeSchema = z.enum([
  'WRONG_AMOUNT',
  'WRONG_SUBSCRIBER',
  'DUPLICATE_ENTRY',
  'DISHONOURED_CHEQUE',
  'GCASH_REVERSED',
  'UNAPPLIED_IN_ERROR',
  'OTHER',
]);
export type PaymentReversalReasonCode = z.infer<typeof paymentReversalReasonCodeSchema>;

export const paymentListQuerySchema = paginationQuerySchema.extend({
  status: paymentStatusSchema.optional(),
  paymentMethod: paymentMethodSchema.optional(),
  subscriberId: z.coerce.number().int().positive().optional(),
  serviceAccountId: z.coerce.number().int().positive().optional(),
  search: z.string().trim().max(100).optional(),
  from: businessDateSchema.optional(),
  to: businessDateSchema.optional(),
});
export type PaymentListQuery = z.infer<typeof paymentListQuerySchema>;

/** One invoice a payment (or a preview) will settle. */
export const paymentAllocationSchema = z.object({
  invoiceId: idSchema,
  invoiceNumber: z.string(),
  amountCentavos: centavosSchema,
});
export type PaymentAllocation = z.infer<typeof paymentAllocationSchema>;

export const paymentSummarySchema = z.object({
  id: idSchema,
  receiptNumber: z.string().nullable(),
  subscriberId: idSchema,
  subscriberAccountNumber: z.string(),
  subscriberName: z.string(),
  serviceAccountId: idSchema,
  serviceAccountNumber: z.string(),
  paymentDate: z.string(),
  paymentMethod: paymentMethodSchema,
  amountCentavos: centavosSchema,
  appliedCentavos: centavosSchema,
  unappliedCentavos: centavosSchema,
  status: paymentStatusSchema,
  referenceNumber: z.string().nullable(),
  senderName: z.string().nullable(),
  senderMobile: z.string().nullable(),
  receivedByUsername: z.string().nullable(),
  verifiedAt: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  postedAt: z.string().nullable(),
  reversedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type PaymentSummary = z.infer<typeof paymentSummarySchema>;

export const paymentDetailSchema = paymentSummarySchema.extend({
  allocations: z.array(paymentAllocationSchema),
});
export type PaymentDetail = z.infer<typeof paymentDetailSchema>;

/** A directed allocation line a caller may supply for a manual allocation. */
const directedAllocationSchema = z.object({
  invoiceId: idSchema,
  amountCentavos: centavosSchema.refine((value) => value > 0, 'Allocations must be positive.'),
});

export const createPaymentSchema = z.object({
  subscriberId: idSchema,
  serviceAccountId: idSchema,
  paymentMethod: paymentMethodSchema,
  amountCentavos: centavosSchema.refine((value) => value > 0, 'Enter an amount greater than zero.'),
  referenceNumber: z.string().trim().max(100).optional(),
  senderName: z.string().trim().max(120).optional(),
  senderMobile: z.string().trim().max(30).optional(),
  notes: noteSchema.optional(),
  /** When absent the payment is allocated oldest-first; otherwise as directed. */
  allocations: z.array(directedAllocationSchema).optional(),
});
export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;

/** The preview a cashier approves before posting — computed, never written. */
export const paymentPreviewSchema = z.object({
  appliedCentavos: centavosSchema,
  unappliedCentavos: centavosSchema,
  allocations: z.array(paymentAllocationSchema),
});
export type PaymentPreview = z.infer<typeof paymentPreviewSchema>;

export const verifyPaymentSchema = z
  .object({
    approve: z.boolean(),
    rejectionReason: z.string().trim().max(500).optional(),
  })
  .refine((value) => value.approve || (value.rejectionReason ?? '').trim().length >= 10, {
    message: 'Give a rejection reason of at least 10 characters.',
    path: ['rejectionReason'],
  });
export type VerifyPaymentInput = z.infer<typeof verifyPaymentSchema>;

export const reversePaymentSchema = z.object({
  reasonCode: paymentReversalReasonCodeSchema,
  reason: reasonSchema,
});
export type ReversePaymentInput = z.infer<typeof reversePaymentSchema>;

export const paymentIdParamSchema = z.object({ id: z.coerce.number().int().positive() });
