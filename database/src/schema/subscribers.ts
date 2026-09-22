import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { collectionAreas } from './catalog';
import { users } from './identity';

const id = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();

/**
 * Subscribers.
 *
 * ── NO DESTRUCTIVE DELETE ───────────────────────────────────────────────────
 * A subscriber is never removed. Leaving the business, or being terminated for
 * non-payment, is a STATUS (`INACTIVE`, `TERMINATED`, `ARCHIVED`) recorded with
 * `archived_at`. Deleting the row would delete the reason a historical invoice,
 * payment, or collector remittance belongs to somebody — which is the one thing
 * a receivables system cannot afford.
 *
 * `billing_day` and `due_day` are capped at 28 so a subscriber can be billed in
 * February. A "31st" billing day is a question nobody wants to answer in
 * production, and the roadmap settles it in the same way.
 */
export const subscribers = pgTable(
  'subscribers',
  {
    id: id(),
    /** Human-readable and unique, e.g. `SUB-000123`. Allocated, never typed. */
    accountNumber: text('account_number').notNull(),
    /**
     * The name as it appears on a statement. A single field rather than
     * first/last: many Philippine consumer accounts are a household or a
     * business, and "Dela Cruz Residence" has no meaningful first name.
     */
    displayName: text('display_name').notNull(),

    subscriberType: text('subscriber_type').notNull().default('RESIDENTIAL'),
    status: text('status').notNull().default('ACTIVE'),

    collectionAreaId: bigint('collection_area_id', { mode: 'number' }).references(
      () => collectionAreas.id,
      { onDelete: 'set null' },
    ),
    /** Default collector for this subscriber's accounts. Phase 6 owns the history. */
    assignedCollectorId: bigint('assigned_collector_id', { mode: 'number' }).references(
      () => users.id,
      { onDelete: 'set null' },
    ),

    /** 1–28. Day of month the statement is issued. */
    billingDay: smallint('billing_day').notNull().default(1),
    /** 1–28. Day of month payment is due. */
    dueDay: smallint('due_day').notNull().default(15),

    notes: text('notes'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: bigint('created_by', { mode: 'number' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: bigint('updated_by', { mode: 'number' }),
  },
  (table) => [
    uniqueIndex('uq_subscribers_account_number').on(table.accountNumber),
    index('ix_subscribers_status').on(table.status),
    index('ix_subscribers_collection_area').on(table.collectionAreaId),
    index('ix_subscribers_collector').on(table.assignedCollectorId),
    check(
      'ck_subscribers_type',
      sql`${table.subscriberType} IN ('RESIDENTIAL', 'COMMERCIAL', 'GOVERNMENT')`,
    ),
    check(
      'ck_subscribers_status',
      sql`${table.status} IN ('ACTIVE', 'INACTIVE', 'TERMINATED', 'ARCHIVED')`,
    ),
    // 1–28 so every month has the day. See the note above.
    check('ck_subscribers_billing_day', sql`${table.billingDay} BETWEEN 1 AND 28`),
    check('ck_subscribers_due_day', sql`${table.dueDay} BETWEEN 1 AND 28`),
  ],
);

/**
 * Subscriber addresses.
 *
 * A subscriber has many addresses (the service location and the billing
 * address are frequently different), so this is a table and not four columns on
 * `subscribers`.
 */
export const subscriberAddresses = pgTable(
  'subscriber_addresses',
  {
    id: id(),
    subscriberId: bigint('subscriber_id', { mode: 'number' })
      .notNull()
      .references(() => subscribers.id, { onDelete: 'cascade' }),

    addressType: text('address_type').notNull().default('SERVICE'),
    /** Optional free label, e.g. "House 2, back gate". */
    label: text('label'),

    line1: text('line1').notNull(),
    line2: text('line2'),
    barangay: text('barangay'),
    cityMunicipality: text('city_municipality'),
    province: text('province'),
    postalCode: text('postal_code'),

    /** The address used unless another is chosen. One per type per subscriber. */
    isPrimary: boolean('is_primary').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: bigint('created_by', { mode: 'number' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: bigint('updated_by', { mode: 'number' }),
  },
  (table) => [
    index('ix_subscriber_addresses_subscriber').on(table.subscriberId),
    // Enforces "at most one primary per type" in the database rather than in a
    // service that could race against itself.
    uniqueIndex('uq_subscriber_addresses_primary')
      .on(table.subscriberId, table.addressType)
      .where(sql`${table.isPrimary}`),
    check(
      'ck_subscriber_addresses_type',
      sql`${table.addressType} IN ('SERVICE', 'BILLING', 'MAILING')`,
    ),
  ],
);

/**
 * Subscriber contacts.
 *
 * Typed and independently flagged primary, so a subscriber can have a primary
 * mobile AND a primary landline — which is exactly what a collection route
 * needs when the mobile does not answer.
 */
export const subscriberContacts = pgTable(
  'subscriber_contacts',
  {
    id: id(),
    subscriberId: bigint('subscriber_id', { mode: 'number' })
      .notNull()
      .references(() => subscribers.id, { onDelete: 'cascade' }),

    contactType: text('contact_type').notNull(),
    value: text('value').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: bigint('created_by', { mode: 'number' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: bigint('updated_by', { mode: 'number' }),
  },
  (table) => [
    index('ix_subscriber_contacts_subscriber').on(table.subscriberId),
    uniqueIndex('uq_subscriber_contacts_primary')
      .on(table.subscriberId, table.contactType)
      .where(sql`${table.isPrimary}`),
    check(
      'ck_subscriber_contacts_type',
      sql`${table.contactType} IN ('MOBILE', 'LANDLINE', 'EMAIL')`,
    ),
  ],
);
