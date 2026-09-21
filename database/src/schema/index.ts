/**
 * Drizzle schema — Phase 1 baseline.
 *
 * ── PHASE STATUS ────────────────────────────────────────────────────────────
 * This file is intentionally close to empty. Phase 1 establishes the
 * toolchain, the migration pipeline, and connectivity. Domain tables
 * (users, subscribers, invoices, payments, and so on) arrive in Phases 2-7,
 * each with its own migration.
 *
 * The only Phase 1 database change is a custom SQL migration that enables the
 * extensions the later phases depend on. That migration exists so the
 * migration pipeline is proven end to end rather than assumed to work.
 *
 * ── CONVENTIONS FOR EVERY TABLE ADDED HERE ──────────────────────────────────
 *   - Primary keys:      bigint('id').primaryKey().generatedAlwaysAsIdentity()
 *   - Money:             bigint('*_centavos', { mode: 'number' }), never numeric,
 *                        never real, never double precision
 *   - Instants:          timestamp('*', { withTimezone: true })
 *   - Calendar dates:    date('*') computed in Asia/Manila (see @bcis/shared/time)
 *   - Column names:      written out explicitly in snake_case. No automatic
 *                        casing transform, so the SQL in a migration always
 *                        matches the TypeScript that produced it.
 *   - Audit columns:     created_at, created_by, updated_at, updated_by on
 *                        mutable tables
 *   - Financial and subscriber history is never hard deleted. Use status
 *    columns, voided_at, or archived_at.
 */

export {};
