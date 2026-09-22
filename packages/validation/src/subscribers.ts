import { z } from 'zod';

import { paginationQuerySchema } from './pagination';
import { idSchema, noteSchema, reasonSchema, shortTextSchema } from './primitives';

/**
 * Subscribers, addresses, and contacts.
 *
 * ── CONTACT VALIDATION IS NOT DECORATION ────────────────────────────────────
 * A collection route needs a phone number that reaches somebody. A mistyped
 * mobile is discovered at the door, not at data entry, so the mobile format is
 * validated here rather than accepted as free text.
 */

export const subscriberTypeSchema = z.enum(['RESIDENTIAL', 'COMMERCIAL', 'GOVERNMENT']);
export const subscriberStatusSchema = z.enum(['ACTIVE', 'INACTIVE', 'TERMINATED', 'ARCHIVED']);
export const addressTypeSchema = z.enum(['SERVICE', 'BILLING', 'MAILING']);
export const contactTypeSchema = z.enum(['MOBILE', 'LANDLINE', 'EMAIL']);

export type SubscriberType = z.infer<typeof subscriberTypeSchema>;
export type SubscriberStatus = z.infer<typeof subscriberStatusSchema>;
export type AddressType = z.infer<typeof addressTypeSchema>;
export type ContactType = z.infer<typeof contactTypeSchema>;

/** Philippine mobile: 09xxxxxxxxx, +639xxxxxxxxx, or 639xxxxxxxxx. */
const PH_MOBILE = /^(?:\+?63|0)9\d{9}$/;
/** Landline with an optional area code: (088) 123-4567, 0881234, etc. */
const LANDLINE = /^[0-9()+\-\s]{7,20}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * The address fields, without an id.
 *
 * ── WHY THE BASE OBJECT IS SEPARATE ─────────────────────────────────────────
 * Zod 4 refuses `.extend()` that overwrites a key on a schema carrying a
 * refinement. The with-id and returned variants are therefore built by adding
 * `id` to this base rather than by replacing it on a refined schema.
 */
const addressBaseSchema = z.object({
  addressType: addressTypeSchema,
  label: z.string().trim().max(60).optional(),
  line1: shortTextSchema,
  line2: z.string().trim().max(120).optional(),
  barangay: z.string().trim().max(80).optional(),
  cityMunicipality: z.string().trim().max(80).optional(),
  province: z.string().trim().max(80).optional(),
  postalCode: z.string().trim().max(10).optional(),
  isPrimary: z.boolean().default(false),
});

export const addressInputSchema = addressBaseSchema;

export type AddressInput = z.infer<typeof addressInputSchema>;

const contactBaseSchema = z.object({
  contactType: contactTypeSchema,
  value: z.string().trim().min(1, 'Enter the contact detail.').max(120),
  isPrimary: z.boolean().default(false),
});

/** A contact value must look like the kind of contact it claims to be. */
function refineContactValue(
  value: { readonly contactType: string; readonly value: string },
  ctx: z.RefinementCtx,
): void {
  const compact = value.value.replaceAll(/[\s-]/g, '');

  if (value.contactType === 'MOBILE' && !PH_MOBILE.test(compact)) {
    ctx.addIssue({
      code: 'custom',
      path: ['value'],
      message: 'Enter a Philippine mobile number, for example 09171234567.',
    });
  }

  if (value.contactType === 'LANDLINE' && !LANDLINE.test(value.value)) {
    ctx.addIssue({
      code: 'custom',
      path: ['value'],
      message: 'Enter a landline number, for example (088) 123-4567.',
    });
  }

  if (value.contactType === 'EMAIL' && !EMAIL.test(value.value)) {
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'Enter a valid email address.' });
  }
}

export const contactInputSchema = contactBaseSchema.superRefine(refineContactValue);

export type ContactInput = z.infer<typeof contactInputSchema>;

/** At most one primary per address type — mirrors the partial unique index. */
function assertSinglePrimaryPerType(
  items: readonly {
    readonly addressType?: string;
    readonly contactType?: string;
    readonly isPrimary: boolean;
  }[],
  key: 'addressType' | 'contactType',
  ctx: z.RefinementCtx,
  path: (string | number)[],
): void {
  const seen = new Set<string>();

  items.forEach((item, index) => {
    if (!item.isPrimary) return;

    const type = item[key];
    if (type === undefined) return;

    if (seen.has(type)) {
      ctx.addIssue({
        code: 'custom',
        path: [...path, index, 'isPrimary'],
        message: `Only one ${type.toLowerCase()} entry can be the primary one.`,
      });
    }
    seen.add(type);
  });
}

/**
 * Register a subscriber.
 *
 * `accountNumber` is optional: the API allocates one when it is absent, and
 * accepts one when migrating subscribers that already have a number from a
 * previous system. Either way it must be unique, which the database enforces.
 */
export const createSubscriberSchema = z
  .object({
    accountNumber: z
      .string()
      .trim()
      .min(3, 'An account number needs at least 3 characters.')
      .max(30)
      .regex(/^[A-Za-z0-9-]+$/, 'Use letters, digits, and hyphens only.')
      .optional(),
    displayName: shortTextSchema,
    subscriberType: subscriberTypeSchema.default('RESIDENTIAL'),
    collectionAreaId: idSchema.nullable().optional(),
    assignedCollectorId: idSchema.nullable().optional(),
    billingDay: z.number().int().min(1).max(28).default(1),
    dueDay: z.number().int().min(1).max(28).default(15),
    notes: noteSchema.optional(),
    addresses: z.array(addressInputSchema).max(10).default([]),
    contacts: z.array(contactInputSchema).max(10).default([]),
  })
  .superRefine((value, ctx) => {
    assertSinglePrimaryPerType(value.addresses, 'addressType', ctx, ['addresses']);
    assertSinglePrimaryPerType(value.contacts, 'contactType', ctx, ['contacts']);
  });

export type CreateSubscriberInput = z.infer<typeof createSubscriberSchema>;

/** What a caller may send: defaults are optional on the way in. */
export type CreateSubscriberRequest = z.input<typeof createSubscriberSchema>;

/** Edit a subscriber's own fields. Addresses and contacts have their own routes. */
export const updateSubscriberSchema = z.object({
  displayName: shortTextSchema,
  subscriberType: subscriberTypeSchema,
  collectionAreaId: idSchema.nullable().optional(),
  assignedCollectorId: idSchema.nullable().optional(),
  billingDay: z.number().int().min(1).max(28),
  dueDay: z.number().int().min(1).max(28),
  notes: noteSchema.optional(),
});

export type UpdateSubscriberInput = z.infer<typeof updateSubscriberSchema>;

/**
 * Change status.
 *
 * A reason is required for anything other than ACTIVE, because "why is this
 * customer's service off?" is a question the audit log must answer.
 */
export const setSubscriberStatusSchema = z
  .object({
    status: subscriberStatusSchema,
    reason: reasonSchema.optional(),
  })
  .refine((value) => value.status === 'ACTIVE' || value.reason !== undefined, {
    message: 'Give a reason for changing the account status.',
    path: ['reason'],
  });

export type SetSubscriberStatusInput = z.infer<typeof setSubscriberStatusSchema>;

/** An address as it is sent back for replacement: the same shape, plus the id of the row it updates. */
export const subscriberAddressInputSchema = addressBaseSchema.extend({
  id: idSchema.optional(),
});

export const subscriberContactInputSchema = contactBaseSchema
  .extend({ id: idSchema.optional() })
  .superRefine(refineContactValue);

/** An address as it is returned. Always carries an id. */
export const subscriberAddressSchema = addressBaseSchema.extend({
  id: idSchema,
});

export const subscriberContactSchema = contactBaseSchema
  .extend({ id: idSchema })
  .superRefine(refineContactValue);

export type SubscriberAddressInput = z.infer<typeof subscriberAddressInputSchema>;
export type SubscriberContactInput = z.infer<typeof subscriberContactInputSchema>;

/**
 * Replace the whole address set.
 *
 * ── WHY EACH ROW CARRIES AN ID ──────────────────────────────────────────────
 * Delete-everything-then-reinsert is the obvious implementation and it is
 * wrong: `service_accounts.installation_address_id` references these rows, so
 * reinserting would null out where every customer's service is installed —
 * silently, and only discovered when a technician is sent to the wrong place.
 *
 * Sending the id back lets the service update in place, insert the genuinely
 * new, and REFUSE to remove an address an account still depends on.
 */
export const replaceAddressesSchema = z
  .object({
    addresses: z.array(subscriberAddressInputSchema).max(10),
  })
  .superRefine((value, ctx) => {
    assertSinglePrimaryPerType(value.addresses, 'addressType', ctx, ['addresses']);
  });

export const replaceContactsSchema = z
  .object({
    contacts: z.array(subscriberContactInputSchema).max(10),
  })
  .superRefine((value, ctx) => {
    assertSinglePrimaryPerType(value.contacts, 'contactType', ctx, ['contacts']);
  });

/** A subscriber as it appears in the list. No addresses or contacts. */
export const subscriberSummarySchema = z.object({
  id: idSchema,
  accountNumber: z.string(),
  displayName: z.string(),
  subscriberType: subscriberTypeSchema,
  status: subscriberStatusSchema,
  collectionAreaId: z.number().int().positive().nullable(),
  collectionAreaName: z.string().nullable(),
  assignedCollectorId: z.number().int().positive().nullable(),
  assignedCollectorName: z.string().nullable(),
  billingDay: z.number().int(),
  dueDay: z.number().int(),
  /** Every service account, whatever its status. */
  serviceCount: z.number().int().nonnegative(),
  /** The ones currently delivering service. */
  activeServiceCount: z.number().int().nonnegative(),
  /** The primary mobile, or the primary of any type. Shown so a caller can dial. */
  primaryContact: z.string().nullable(),
  createdAt: z.string(),
  archivedAt: z.string().nullable(),
});

export type SubscriberSummary = z.infer<typeof subscriberSummarySchema>;

export const subscriberDetailSchema = subscriberSummarySchema.extend({
  notes: z.string().nullable(),
  addresses: z.array(subscriberAddressSchema),
  contacts: z.array(subscriberContactSchema),
});

export type SubscriberDetail = z.infer<typeof subscriberDetailSchema>;

export const subscriberListQuerySchema = paginationQuerySchema.extend({
  /** Matched across account number, name, contact value, and address. */
  search: z.string().trim().max(120).optional(),
  status: subscriberStatusSchema.optional(),
  subscriberType: subscriberTypeSchema.optional(),
  collectionAreaId: z.coerce.number().int().positive().optional(),
});

export type SubscriberListQuery = z.infer<typeof subscriberListQuerySchema>;

export const subscriberIdParamSchema = z.object({ id: z.coerce.number().int().positive() });
