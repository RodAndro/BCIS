import {
  SERVICE_ACCOUNT_STATUSES,
  SERVICE_EVENT_TYPES,
  type ServiceAccountStatus,
} from '@bcis/shared';
import { z } from 'zod';

import { planSummarySchema } from './catalog';
import { paginationQuerySchema } from './pagination';
import {
  businessDateSchema,
  centavosSchema,
  idSchema,
  noteSchema,
  reasonSchema,
  shortTextSchema,
} from './primitives';
import { addressTypeSchema } from './subscribers';

/**
 * Service accounts and their history.
 *
 * ── WHAT IS NOT HERE ────────────────────────────────────────────────────────
 * There is no field for the account's current rate and none for its service
 * type. The rate is set from the plan version at creation and changed only by
 * `applyPlanRateSchema`; the service type is read from the plan. Both are
 * derived facts that a client must not be able to assert.
 */

export const serviceAccountStatusSchema = z.enum(SERVICE_ACCOUNT_STATUSES);
export const serviceEventTypeSchema = z.enum(SERVICE_EVENT_TYPES);

export type { ServiceAccountStatus };

/**
 * Create an account.
 *
 * Defaults to `ACTIVE` with today's activation date, because the common case at
 * a counter is "the installer already went". `PENDING` is for a scheduled
 * installation, and the database refuses a PENDING account that carries an
 * activation date.
 */
export const createServiceAccountSchema = z
  .object({
    subscriberId: idSchema,
    servicePlanId: idSchema,
    installationAddressId: idSchema.nullable().optional(),
    status: z.enum(['PENDING', 'ACTIVE']).default('ACTIVE'),
    activationDate: businessDateSchema.nullable().optional(),
    billingStartDate: businessDateSchema.optional(),
    billingDay: z.number().int().min(1).max(28).optional(),
    dueDay: z.number().int().min(1).max(28).optional(),
    assignedCollectorId: idSchema.nullable().optional(),
    notes: noteSchema.optional(),
  })
  .refine((value) => value.status === 'ACTIVE' || value.activationDate == null, {
    message: 'A pending account must not have an activation date.',
    path: ['activationDate'],
  });

export type CreateServiceAccountInput = z.infer<typeof createServiceAccountSchema>;

/** What a caller may send: `status` defaults to ACTIVE on the way in. */
export type CreateServiceAccountRequest = z.input<typeof createServiceAccountSchema>;

/** Edit the operational fields. Plan and subscriber are fixed at creation. */
export const updateServiceAccountSchema = z.object({
  installationAddressId: idSchema.nullable().optional(),
  billingDay: z.number().int().min(1).max(28),
  dueDay: z.number().int().min(1).max(28),
  assignedCollectorId: idSchema.nullable().optional(),
  notes: noteSchema.optional(),
});

export type UpdateServiceAccountInput = z.infer<typeof updateServiceAccountSchema>;

/**
 * Change status.
 *
 * Whether the move is legal is decided by `canTransitionServiceStatus` in
 * `@bcis/shared` against the account's CURRENT status, which only the server
 * knows — so this schema validates shape, and the service validates the rule.
 */
export const setServiceAccountStatusSchema = z.object({
  status: serviceAccountStatusSchema,
  effectiveDate: businessDateSchema,
  reason: reasonSchema,
});

export type SetServiceAccountStatusInput = z.infer<typeof setServiceAccountStatusSchema>;

/**
 * Apply the plan's current price to this account.
 *
 * ── WHY THIS IS A SEPARATE, EXPLICIT ACTION ─────────────────────────────────
 * Changing a plan's price deliberately does NOT reprice the customers already
 * on it. That would raise bills silently, months after the decision. Moving an
 * account onto the current rate is this call: one account at a time (or by an
 * explicit batch in a later phase), with a reason and a service event.
 */
export const applyPlanRateSchema = z.object({
  effectiveDate: businessDateSchema,
  reason: reasonSchema,
});

export type ApplyPlanRateInput = z.infer<typeof applyPlanRateSchema>;

/** Change the plan an account is billed on. Snapshots the new plan's rate. */
export const changeServiceAccountPlanSchema = z.object({
  servicePlanId: idSchema,
  effectiveDate: businessDateSchema,
  reason: reasonSchema,
  applyPlanRate: z.boolean().default(true),
});

export type ChangeServiceAccountPlanInput = z.infer<typeof changeServiceAccountPlanSchema>;

export const serviceEventSchema = z.object({
  id: idSchema,
  eventType: serviceEventTypeSchema,
  fromValue: z.string().nullable(),
  toValue: z.string().nullable(),
  effectiveDate: businessDateSchema,
  reason: z.string().nullable(),
  actorUsername: z.string().nullable(),
  createdAt: z.string(),
});

export type ServiceEvent = z.infer<typeof serviceEventSchema>;

/** A service account as it appears in a list. */
export const serviceAccountSummarySchema = z.object({
  id: idSchema,
  accountNumber: z.string(),
  subscriberId: idSchema,
  subscriberAccountNumber: z.string(),
  subscriberName: z.string(),
  servicePlanId: idSchema,
  planCode: z.string(),
  planName: z.string(),
  serviceTypeCode: z.enum(['INTERNET', 'CABLE', 'COMBO']),
  serviceTypeName: z.string(),
  status: serviceAccountStatusSchema,
  activationDate: businessDateSchema.nullable(),
  billingStartDate: businessDateSchema,
  billingDay: z.number().int(),
  dueDay: z.number().int(),
  /** The rate this account is charged — a snapshot, not a live plan price. */
  currentPlanPriceCentavos: centavosSchema,
  /** The plan version's price today, so a drift is visible rather than silent. */
  planCurrentPriceCentavos: centavosSchema,
  assignedCollectorId: z.number().int().positive().nullable(),
  assignedCollectorName: z.string().nullable(),
  createdAt: z.string(),
});

export type ServiceAccountSummary = z.infer<typeof serviceAccountSummarySchema>;

export const serviceAccountDetailSchema = serviceAccountSummarySchema.extend({
  notes: z.string().nullable(),
  plan: planSummarySchema,
  installationAddress: z
    .object({
      id: idSchema,
      addressType: addressTypeSchema,
      label: z.string().nullable(),
      line1: z.string(),
      line2: z.string().nullable(),
      barangay: z.string().nullable(),
      cityMunicipality: z.string().nullable(),
      province: z.string().nullable(),
      postalCode: z.string().nullable(),
    })
    .nullable(),
  events: z.array(serviceEventSchema),
});

export type ServiceAccountDetail = z.infer<typeof serviceAccountDetailSchema>;

export const serviceAccountListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(120).optional(),
  status: serviceAccountStatusSchema.optional(),
  subscriberId: z.coerce.number().int().positive().optional(),
  serviceType: z.enum(['INTERNET', 'CABLE', 'COMBO']).optional(),
});

export type ServiceAccountListQuery = z.infer<typeof serviceAccountListQuerySchema>;

export const serviceAccountIdParamSchema = z.object({ id: z.coerce.number().int().positive() });

/** Free-text note appended to the history. */
export const serviceNoteSchema = z.object({
  effectiveDate: businessDateSchema,
  note: shortTextSchema,
});
