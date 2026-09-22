import type { Database } from '@bcis/database';

/**
 * Query-executor types.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * A repository function should be usable from inside a transaction and from
 * outside one, and the two handles are different types in Drizzle. Deriving the
 * transaction type from `Database` itself keeps Drizzle's generic transaction
 * signature out of every repository file; it appears exactly once, here.
 *
 * The rule the types support: a service that performs more than one write runs
 * them inside `db.transaction(...)`, so a partial financial or privilege change
 * is impossible.
 */

/** The top-level handle, attached to the Fastify instance by the database plugin. */
export type Db = Database;

/** The handle received inside `db.transaction(...)`. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Either handle. Read-only helpers accept this so they work in both contexts. */
export type Executor = Db | Tx;
