import { sql } from 'drizzle-orm';
import { bigint, check, index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

const id = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();

/**
 * Application settings — §5.9 of the roadmap.
 *
 * ── WHY A TABLE AND NOT CONSTANTS ───────────────────────────────────────────
 * The grace period before a penalty, the suspension threshold, and the
 * reconnection fee are commercial decisions, not code. Keeping them in rows
 * means an Owner changes a policy without a release, and every change is an
 * auditable UPDATE rather than a code review.
 *
 * Values are stored as text with a `valueType` describing how to read them.
 * That is deliberate: a settings table with one column per type is four
 * nullable columns and three of them are always wrong.
 */
export const applicationSettings = pgTable(
  'application_settings',
  {
    id: id(),
    /** Dotted key, e.g. `billing.grace_period_days`. */
    key: text('key').notNull(),
    value: text('value').notNull(),
    valueType: text('value_type').notNull().default('string'),
    /** Grouping for the settings screen, e.g. `billing`, `collections`. */
    category: text('category').notNull().default('general'),
    description: text('description'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: bigint('updated_by', { mode: 'number' }),
  },
  (table) => [
    uniqueIndex('uq_application_settings_key').on(table.key),
    index('ix_application_settings_category').on(table.category),
    check(
      'ck_application_settings_value_type',
      sql`${table.valueType} IN ('string', 'integer', 'boolean', 'decimal', 'json')`,
    ),
  ],
);
