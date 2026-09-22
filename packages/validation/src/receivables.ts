import { z } from 'zod';

import {
  businessDateSchema,
  centavosSchema,
  idSchema,
  noteSchema,
  reasonSchema,
} from './primitives';
import { paginationQuerySchema } from './pagination';

export const agingBucketSchema = z.enum(['CURRENT', '1_30', '31_60', '61_90', '90_PLUS']);
export type AgingBucket = z.infer<typeof agingBucketSchema>;

export const receivableListQuerySchema = paginationQuerySchema.extend({
  collectorId: idSchema.optional(),
  collectionAreaId: idSchema.optional(),
  servicePlanId: idSchema.optional(),
  serviceTypeCode: z.enum(['INTERNET', 'CABLE', 'COMBO']).optional(),
  agingBucket: agingBucketSchema.optional(),
  overdueOnly: z.coerce.boolean().default(false),
});
export type ReceivableListQuery = z.infer<typeof receivableListQuerySchema>;

export const suspensionCandidateQuerySchema = receivableListQuerySchema;
export type SuspensionCandidateQuery = z.infer<typeof suspensionCandidateQuerySchema>;

export const suspendServiceSchema = z.object({
  effectiveDate: businessDateSchema,
  reason: reasonSchema,
  notes: noteSchema.optional(),
});
export type SuspendServiceInput = z.infer<typeof suspendServiceSchema>;

export const reconnectionRequestSchema = z.object({
  requestDate: businessDateSchema,
  qualifyingPaymentId: idSchema,
  technicianUserId: idSchema.optional(),
  notes: noteSchema.optional(),
});
export type ReconnectionRequestInput = z.infer<typeof reconnectionRequestSchema>;

export const reconnectionScheduleSchema = z.object({
  technicianUserId: idSchema,
  notes: noteSchema.optional(),
});
export type ReconnectionScheduleInput = z.infer<typeof reconnectionScheduleSchema>;

export const reconnectionCompleteSchema = z.object({
  completionDate: businessDateSchema,
  notes: noteSchema.optional(),
});
export type ReconnectionCompleteInput = z.infer<typeof reconnectionCompleteSchema>;

export const reconnectionIdParamSchema = z.object({ id: z.coerce.number().int().positive() });

export const agingSummarySchema = z.object({
  currentCentavos: centavosSchema,
  bucket1To30Centavos: centavosSchema,
  bucket31To60Centavos: centavosSchema,
  bucket61To90Centavos: centavosSchema,
  bucket90PlusCentavos: centavosSchema,
  totalOutstandingCentavos: centavosSchema,
});
export type AgingSummary = z.infer<typeof agingSummarySchema>;

export const receivableSummarySchema = z.object({
  serviceAccountId: idSchema,
  accountNumber: z.string(),
  subscriberId: idSchema,
  subscriber: z.string(),
  servicePlanId: idSchema,
  plan: z.string(),
  serviceTypeCode: z.enum(['INTERNET', 'CABLE', 'COMBO']),
  area: z.string().nullable(),
  collector: z.string().nullable(),
  monthsUnpaid: z.number().int().nonnegative(),
  oldestUnpaidInvoice: businessDateSchema.nullable(),
  lastPayment: z.string().nullable(),
  totalArrearsCentavos: centavosSchema,
  agingBucket: agingBucketSchema,
});
export type ReceivableSummary = z.infer<typeof receivableSummarySchema>;

export const suspensionCandidateSchema = receivableSummarySchema.extend({
  eligible: z.boolean(),
  thresholdDaysOverdue: z.number().int().nonnegative(),
  thresholdMonthsUnpaid: z.number().int().nonnegative(),
});
export type SuspensionCandidate = z.infer<typeof suspensionCandidateSchema>;

export const suspensionRecordSchema = z.object({
  id: idSchema,
  serviceAccountId: idSchema,
  reason: z.string(),
  effectiveDate: businessDateSchema,
  approvedBy: idSchema,
  notes: z.string().nullable(),
  createdAt: z.string(),
});
export type SuspensionRecord = z.infer<typeof suspensionRecordSchema>;

export const reconnectionRecordSchema = z.object({
  id: idSchema,
  serviceAccountId: idSchema,
  requestDate: businessDateSchema,
  qualifyingPaymentId: idSchema.nullable(),
  reconnectionFeeCentavos: centavosSchema,
  technicianUserId: idSchema.nullable(),
  completionDate: businessDateSchema.nullable(),
  status: z.enum(['REQUESTED', 'APPROVED', 'SCHEDULED', 'COMPLETED', 'CANCELLED']),
  notes: z.string().nullable(),
  createdAt: z.string(),
});
export type ReconnectionRecord = z.infer<typeof reconnectionRecordSchema>;
