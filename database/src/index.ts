/**
 * @bcis/database — Drizzle schema, connection management, and migration tools.
 *
 * ── LAYERING ────────────────────────────────────────────────────────────────
 * Only `apps/api` may import from this package. The Electron renderer must
 * never see it: the architecture requires that all database access goes
 * through the API, so the renderer cannot leak credentials and cannot bypass
 * authorization.
 *
 * Repositories in `apps/api/src/modules/*` own the queries. This package owns
 * the schema definition, the pool, and the migration runner.
 */

export {
  checkDatabaseHealth,
  createDatabase,
  createPool,
  type CreatePoolOptions,
  type Database,
  type DatabaseHealth,
} from './client';

export {
  inspectMigrationState,
  readMigrationJournal,
  runMigrations,
  type MigrationState,
} from './migrations';

export * as schema from './schema';

export {
  DEFAULT_SETTINGS,
  DEV_USERS,
  SEED_PLAN_EFFECTIVE_FROM,
  createRandom,
  createSeededRandom,
  demoBillingMonths,
  passwordSourceFor,
  permissionCategory,
  permissionDescription,
  seedAccessControl,
  seedBilling,
  seedCatalog,
  seedCollections,
  seedDemoData,
  seedDevUsers,
  seedPayments,
  type AccessControlSeedResult,
  type BillingSeedResult,
  type CatalogSeedResult,
  type CollectionsSeedResult,
  type DemoDataSeedResult,
  type DevUserSeedResult,
  type DevUserSpec,
  type DevUserStatus,
  type PaymentsSeedResult,
  type Random,
  type SeededDevUser,
} from './seeds';
