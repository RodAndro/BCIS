import { z } from 'zod';

import { roleCodeSchema } from './auth';
import { paginationQuerySchema } from './pagination';
import {
  businessDateSchema,
  centavosSchema,
  idSchema,
  noteSchema,
  shortTextSchema,
} from './primitives';

/**
 * Collection areas and the collector picker.
 *
 * Phase 6 owns the collection module — routes, assignments, batches,
 * remittance. What is here is what a subscriber or a service account needs in
 * order to be routed: the area it belongs to, and the list of people it could
 * be assigned to.
 */

export const collectionAreaSummarySchema = z.object({
  id: idSchema,
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isActive: z.boolean(),
  /** How many subscribers are routed to this area. */
  subscriberCount: z.number().int().nonnegative(),
});

export type CollectionAreaSummary = z.infer<typeof collectionAreaSummarySchema>;

export const createCollectionAreaSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, 'An area code needs at least 2 characters.')
    .max(20)
    .regex(/^[A-Za-z0-9-]+$/, 'Use letters, digits, and hyphens only.'),
  name: shortTextSchema,
  description: noteSchema.optional(),
  isActive: z.boolean().default(true),
});

export type CreateCollectionAreaInput = z.infer<typeof createCollectionAreaSchema>;

/** What a caller may send: `isActive` defaults to true on the way in. */
export type CreateCollectionAreaRequest = z.input<typeof createCollectionAreaSchema>;

export const updateCollectionAreaSchema = z.object({
  name: shortTextSchema,
  description: noteSchema.optional(),
  isActive: z.boolean(),
});

export type UpdateCollectionAreaInput = z.infer<typeof updateCollectionAreaSchema>;

export const collectionAreaIdParamSchema = z.object({ id: z.coerce.number().int().positive() });

export const collectorAssignmentSchema = z.object({
  collectorUserId: idSchema,
  effectiveFrom: businessDateSchema,
});

export const batchStatusSchema = z.enum([
  'OPEN',
  'IN_PROGRESS',
  'SUBMITTED',
  'REMITTED',
  'RECONCILED',
  'CLOSED',
]);

export const routeSheetEntrySchema = z.object({
  accountId: idSchema,
  accountNumber: z.string(),
  subscriber: z.string(),
  address: z.string(),
  currentBillCentavos: centavosSchema,
  arrearsCentavos: centavosSchema,
  totalDueCentavos: centavosSchema,
  collector: z.string(),
});

export type RouteSheetEntry = z.infer<typeof routeSheetEntrySchema>;

export const createCollectionBatchSchema = z.object({
  collectorUserId: idSchema,
  collectionAreaId: idSchema,
  batchDate: businessDateSchema,
  serviceAccountIds: z.array(idSchema).min(1, 'At least one account must be assigned.'),
  expectedReceivableCentavos: centavosSchema,
  notes: noteSchema.optional(),
});

export type CreateCollectionBatchInput = z.infer<typeof createCollectionBatchSchema>;

export const submitCollectionBatchSchema = z.object({
  cashCollectedCentavos: centavosSchema,
  nonCashCollectedCentavos: centavosSchema,
  uncollectedCentavos: centavosSchema,
});

export type SubmitCollectionBatchInput = z.infer<typeof submitCollectionBatchSchema>;

export const collectionBatchIdParamSchema = z.object({ id: z.coerce.number().int().positive() });

export const batchRemittanceSchema = z.object({
  remittedCashCentavos: centavosSchema,
  receivedByUserId: idSchema,
  resolutionNotes: noteSchema.optional(),
});

export type BatchRemittanceInput = z.infer<typeof batchRemittanceSchema>;

export const batchReconciliationSchema = z.object({
  expectedCashCentavos: centavosSchema,
  actualCashCentavos: centavosSchema,
  reason: noteSchema.optional(),
});

export type BatchReconciliationInput = z.infer<typeof batchReconciliationSchema>;

export const closeCollectionBatchSchema = z.object({
  reason: noteSchema.optional(),
});

export type CloseCollectionBatchInput = z.infer<typeof closeCollectionBatchSchema>;

/**
 * A person who can be assigned to collect.
 *
 * Roles are returned so the picker can show why someone is in the list — the
 * definition of "a collector" is still an open question (roadmap A9 / Phase 6)
 * and the UI should not imply more certainty than the data has.
 */
export const collectorSummarySchema = z.object({
  id: idSchema,
  username: z.string(),
  fullName: z.string(),
  roles: z.array(roleCodeSchema),
});

export type CollectorSummary = z.infer<typeof collectorSummarySchema>;

/** An active collector assignment, for the Areas & Routes view. */
export const collectorAssignmentSummarySchema = z.object({
  id: idSchema,
  collectionAreaId: idSchema,
  areaCode: z.string(),
  areaName: z.string(),
  collectorUserId: idSchema,
  collectorName: z.string(),
  effectiveFrom: businessDateSchema,
  effectiveTo: businessDateSchema.nullable(),
});
export type CollectorAssignmentSummary = z.infer<typeof collectorAssignmentSummarySchema>;

export const collectionBatchListQuerySchema = paginationQuerySchema.extend({
  status: batchStatusSchema.optional(),
  collectorUserId: z.coerce.number().int().positive().optional(),
  collectionAreaId: z.coerce.number().int().positive().optional(),
});
export type CollectionBatchListQuery = z.infer<typeof collectionBatchListQuerySchema>;

export const collectionBatchSummarySchema = z.object({
  id: idSchema,
  batchNumber: z.string(),
  collectorUserId: idSchema,
  collectorName: z.string(),
  collectionAreaId: idSchema,
  areaName: z.string(),
  batchDate: businessDateSchema,
  status: batchStatusSchema,
  expectedReceivableCentavos: centavosSchema,
  cashCollectedCentavos: centavosSchema,
  nonCashCollectedCentavos: centavosSchema,
  uncollectedCentavos: centavosSchema,
  remittedCashCentavos: centavosSchema,
  shortageCentavos: centavosSchema,
  overageCentavos: centavosSchema,
  submittedAt: z.string().nullable(),
  reconciledAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type CollectionBatchSummary = z.infer<typeof collectionBatchSummarySchema>;

export const collectionBatchAccountSchema = z.object({
  serviceAccountId: idSchema,
  accountNumber: z.string(),
  subscriberName: z.string(),
  expectedAmountCentavos: centavosSchema,
  collectedAmountCentavos: centavosSchema,
  outcome: z.enum(['COLLECTED', 'PARTIAL', 'PROMISE_TO_PAY', 'NOT_HOME', 'REFUSED', 'CLOSED']),
  notes: z.string().nullable(),
});
export type CollectionBatchAccount = z.infer<typeof collectionBatchAccountSchema>;

export const collectionBatchDetailSchema = collectionBatchSummarySchema.extend({
  accounts: z.array(collectionBatchAccountSchema),
});
export type CollectionBatchDetail = z.infer<typeof collectionBatchDetailSchema>;

export const remittanceSummarySchema = z.object({
  id: idSchema,
  batchId: idSchema,
  batchNumber: z.string(),
  collectorName: z.string(),
  areaName: z.string(),
  batchDate: businessDateSchema,
  remittedCashCentavos: centavosSchema,
  varianceCentavos: centavosSchema,
  varianceType: z.enum(['BALANCED', 'SHORTAGE', 'OVERAGE']),
  remittedAt: z.string(),
  receivedByName: z.string().nullable(),
  resolutionNotes: z.string().nullable(),
  approvedByName: z.string().nullable(),
});
export type RemittanceSummary = z.infer<typeof remittanceSummarySchema>;
