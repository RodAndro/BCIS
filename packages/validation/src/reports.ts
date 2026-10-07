import { z } from 'zod';

import { businessDateSchema, centavosSchema, idSchema } from './primitives';
import { paginationQuerySchema } from './pagination';

export const reportTypeSchema = z.enum([
  'DAILY_COLLECTION',
  'WEEKLY_COLLECTION',
  'MONTHLY_COLLECTION',
  'ANNUAL_COLLECTION',
  'BILLING_VS_COLLECTION',
  'AR_AGING',
  'OVERDUE_SUBSCRIBERS',
  'SUBSCRIBER_MASTER',
  'SUBSCRIBER_LEDGER',
  'STATEMENT_OF_ACCOUNT',
  'COLLECTOR_COLLECTION',
  'COLLECTOR_REMITTANCE',
  'COLLECTOR_VARIANCE',
  'COLLECTOR_PERFORMANCE',
  'PAYMENT_METHOD_SUMMARY',
  'REVENUE_BY_PLAN',
  'PAYMENT_ADJUSTMENTS',
  'VOIDED_RECEIPTS',
  'USER_ACTIVITY',
]);
export type ReportType = z.infer<typeof reportTypeSchema>;

export const reportFormatSchema = z.enum(['json', 'xlsx', 'pdf', 'csv']).default('json');
export type ReportFormat = z.infer<typeof reportFormatSchema>;

/** The formats a report may be written to a file as. `json` is view-only. */
export const reportExportFormatSchema = z.enum(['xlsx', 'pdf', 'csv']);
export type ReportExportFormat = z.infer<typeof reportExportFormatSchema>;

export const reportQuerySchema = paginationQuerySchema.extend({
  type: reportTypeSchema,
  from: businessDateSchema.optional(),
  to: businessDateSchema.optional(),
  collectorId: idSchema.optional(),
  collectionAreaId: idSchema.optional(),
  servicePlanId: idSchema.optional(),
  serviceTypeCode: z.enum(['INTERNET', 'CABLE', 'COMBO']).optional(),
  paymentMethod: z.enum(['CASH', 'GCASH', 'BANK_TRANSFER', 'CHEQUE', 'OTHER']).optional(),
  subscriberId: idSchema.optional(),
  serviceAccountId: idSchema.optional(),
  format: reportFormatSchema,
});
export type ReportQuery = z.infer<typeof reportQuerySchema>;

/**
 * A request to write a report to a file.
 *
 * The same filters as a report view, but the format must be one that can be
 * saved — a JSON export would be a file nobody can open.
 */
export const reportExportSchema = reportQuerySchema.extend({
  format: reportExportFormatSchema,
});
export type ReportExportRequest = z.infer<typeof reportExportSchema>;

export const receiptIdParamSchema = z.object({ id: z.coerce.number().int().positive() });

export const reportRowSchema = z.record(z.string(), z.unknown());
export const reportResultSchema = z.object({
  type: reportTypeSchema,
  title: z.string(),
  columns: z.array(z.string()),
  rows: z.array(reportRowSchema),
  totals: z.record(z.string(), centavosSchema),
  generatedAt: z.string(),
});
export type ReportResult = z.infer<typeof reportResultSchema>;

export const dashboardSchema = z.object({
  currentReceivableCentavos: centavosSchema,
  overdueReceivableCentavos: centavosSchema,
  overdueSubscribers: z.number().int().nonnegative(),
  billedThisPeriodCentavos: centavosSchema,
  collectedThisPeriodCentavos: centavosSchema,
  paymentMethods: z.array(z.object({ method: z.string(), amountCentavos: centavosSchema })),
  aging: z.object({
    currentCentavos: centavosSchema,
    bucket1To30Centavos: centavosSchema,
    bucket31To60Centavos: centavosSchema,
    bucket61To90Centavos: centavosSchema,
    bucket90PlusCentavos: centavosSchema,
  }),
  overdueAlerts: z.number().int().nonnegative(),
});
export type Dashboard = z.infer<typeof dashboardSchema>;
