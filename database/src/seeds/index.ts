/**
 * Seed modules.
 *
 * Exported from `@bcis/database` so the CLI runner and the integration tests
 * seed through exactly the same code. A test that seeded by hand could pass
 * while the shipped seed was broken.
 */

export {
  DEFAULT_SETTINGS,
  permissionCategory,
  permissionDescription,
  seedAccessControl,
  type AccessControlSeedResult,
} from './access-control';

export {
  DEV_USERS,
  passwordSourceFor,
  seedDevUsers,
  type DevUserSeedResult,
  type DevUserSpec,
  type DevUserStatus,
  type SeededDevUser,
} from './dev-users';

export { SEED_PLAN_EFFECTIVE_FROM, seedCatalog, type CatalogSeedResult } from './catalog';

export { seedDemoData, type DemoDataSeedResult } from './demo-data';

export { demoBillingMonths, seedBilling, type BillingSeedResult } from './billing';

export { seedPayments, type PaymentsSeedResult } from './payments';

export { seedCollections, type CollectionsSeedResult } from './collections';

export { createRandom, createSeededRandom, type Random } from './random';
