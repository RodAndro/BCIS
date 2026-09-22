import { customType } from 'drizzle-orm/pg-core';

/**
 * Shared column helpers for the schema.
 *
 * ── WHY A CUSTOM citext TYPE ────────────────────────────────────────────────
 * `citext` is not one of Drizzle's built-in column types. Defining it here as a
 * custom type (rather than writing raw SQL in every migration) keeps the
 * TypeScript schema and the generated SQL in agreement, which is what makes
 * `pnpm db:generate` trustworthy.
 *
 * The extension itself is enabled by the baseline migration, so the type is
 * available before any table that uses it is created.
 */
export const citext = customType<{ data: string; driverData: string }>({
  dataType: () => 'citext',
});
