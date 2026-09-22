import { z } from 'zod';

import { paginationQuerySchema } from './pagination';
import {
  businessDateSchema,
  centavosSchema,
  idSchema,
  noteSchema,
  reasonSchema,
  shortTextSchema,
} from './primitives';

/**
 * Service types and plans.
 *
 * ── THE RULE THESE SCHEMAS PROTECT ──────────────────────────────────────────
 * A plan's PRICE is not editable. Changing it is `changePlanPriceSchema`, which
 * creates a new version and leaves the old row intact. Renaming, re-describing,
 * or correcting the speed of the current version is an ordinary update — those
 * do not change what anybody was billed.
 *
 * Keeping the two operations as separate schemas rather than one "update plan"
 * is what makes that distinction hard to lose: there is no field on the update
 * schema that can change a price.
 */

export const serviceTypeCodeSchema = z.enum(['INTERNET', 'CABLE', 'COMBO']);
export type ServiceTypeCode = z.infer<typeof serviceTypeCodeSchema>;

export const planStatusSchema = z.enum(['ACTIVE', 'RETIRED']);

/** A plan version as it appears in a list or a picker. */
export const planSummarySchema = z.object({
  id: idSchema,
  code: z.string(),
  serviceTypeCode: serviceTypeCodeSchema,
  serviceTypeName: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  speedMbps: z.number().int().nullable(),
  channelCount: z.number().int().nullable(),
  monthlyFeeCentavos: centavosSchema,
  installationFeeCentavos: centavosSchema,
  reconnectionFeeCentavos: centavosSchema,
  effectiveFrom: businessDateSchema,
  effectiveTo: businessDateSchema.nullable(),
  status: planStatusSchema,
  /** True for the version with no `effectiveTo` — the one a new account gets. */
  isCurrent: z.boolean(),
  /** How many service accounts are billed on THIS version. */
  serviceAccountCount: z.number().int().nonnegative(),
  createdAt: z.string(),
});

export type PlanSummary = z.infer<typeof planSummarySchema>;

/**
 * Cross-field rule: an attribute that belongs to another service type is a
 * mistake, not a preference. A Cable plan with a download speed would be
 * printed on a statement and mean nothing.
 */
function assertAttributesMatchServiceType(
  value: {
    serviceTypeCode: ServiceTypeCode;
    speedMbps?: number | null | undefined;
    channelCount?: number | null | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  if (value.speedMbps != null && value.serviceTypeCode === 'CABLE') {
    ctx.addIssue({
      code: 'custom',
      path: ['speedMbps'],
      message: 'A Cable plan does not have a download speed.',
    });
  }

  if (value.channelCount != null && value.serviceTypeCode === 'INTERNET') {
    ctx.addIssue({
      code: 'custom',
      path: ['channelCount'],
      message: 'An Internet plan does not have a channel count.',
    });
  }
}

const planAttributes = {
  name: shortTextSchema,
  description: noteSchema.optional(),
  speedMbps: z.number().int().positive().max(100_000).nullable().optional(),
  channelCount: z.number().int().positive().max(10_000).nullable().optional(),
  monthlyFeeCentavos: centavosSchema,
  installationFeeCentavos: centavosSchema.default(0),
  reconnectionFeeCentavos: centavosSchema.default(0),
};

/** Create the first (and only) open-ended version of a plan. */
export const createPlanSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(2, 'A plan code needs at least 2 characters.')
      .max(30)
      .regex(/^[A-Za-z0-9-]+$/, 'Use letters, digits, and hyphens only.'),
    serviceTypeCode: serviceTypeCodeSchema,
    effectiveFrom: businessDateSchema,
    ...planAttributes,
  })
  .superRefine(assertAttributesMatchServiceType);

export type CreatePlanInput = z.infer<typeof createPlanSchema>;

/**
 * What a CALLER may send.
 *
 * ── WHY THIS IS NOT `CreatePlanInput` ───────────────────────────────────────
 * `z.infer` is the schema's OUTPUT type, where a field with `.default(0)` is
 * required. A caller should not have to state a default it is happy to accept,
 * so the desktop bridge is typed with `z.input`, which marks those fields
 * optional. The main process parses the request into the output type before it
 * becomes an HTTP body.
 */
export type CreatePlanRequest = z.input<typeof createPlanSchema>;

/**
 * Edit the current version's non-price attributes.
 *
 * There is deliberately no fee field here. A price change is a new version, so
 * there is no field on this schema that can alter what anyone is billed.
 */
export const updatePlanSchema = z.object({
  name: shortTextSchema,
  description: noteSchema.optional(),
  speedMbps: z.number().int().positive().max(100_000).nullable().optional(),
  channelCount: z.number().int().positive().max(10_000).nullable().optional(),
});

export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;

/**
 * Change the price — by creating a new version.
 *
 * `reason` is required: a price change is a commercial decision, and "why did
 * this customer's bill go up?" is answered from the audit log.
 */
export const changePlanPriceSchema = z
  .object({
    effectiveFrom: businessDateSchema,
    reason: reasonSchema,
    name: shortTextSchema.optional(),
    monthlyFeeCentavos: centavosSchema,
    installationFeeCentavos: centavosSchema.optional(),
    reconnectionFeeCentavos: centavosSchema.optional(),
  })
  .strict();

export type ChangePlanPriceInput = z.infer<typeof changePlanPriceSchema>;

/** Retire a plan so no new account can be opened on it. Existing accounts keep it. */
export const retirePlanSchema = z.object({
  reason: reasonSchema,
});

export type RetirePlanInput = z.infer<typeof retirePlanSchema>;

/**
 * A boolean that arrives as a query-string literal.
 *
 * ── WHY NOT `z.coerce.boolean()` ────────────────────────────────────────────
 * `z.coerce.boolean()` applies JavaScript truthiness, so the string `"false"`
 * coerces to `true` — the one value a caller is most likely to send. This
 * parses the literal text instead, and a value that is neither is rejected
 * rather than silently interpreted.
 */
const queryBoolean = (defaultValue: boolean) =>
  z
    .enum(['true', 'false'])
    .default(defaultValue ? 'true' : 'false')
    .transform((value) => value === 'true');

/** Filters for the plan list. `currentOnly` hides superseded versions. */
export const planListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(120).optional(),
  serviceType: serviceTypeCodeSchema.optional(),
  status: planStatusSchema.optional(),
  currentOnly: queryBoolean(true),
});

export type PlanListQuery = z.infer<typeof planListQuerySchema>;

export const planIdParamSchema = z.object({ id: z.coerce.number().int().positive() });

export const serviceTypeSummarySchema = z.object({
  id: idSchema,
  code: serviceTypeCodeSchema,
  name: z.string(),
  description: z.string().nullable(),
  planCount: z.number().int().nonnegative(),
});

export type ServiceTypeSummary = z.infer<typeof serviceTypeSummarySchema>;
