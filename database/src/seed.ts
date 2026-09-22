import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  createPool,
  DEV_USERS,
  demoBillingMonths,
  passwordSourceFor,
  seedAccessControl,
  seedBilling,
  seedCatalog,
  seedCollections,
  seedDemoData,
  seedDevUsers,
  seedPayments,
} from '@bcis/database';

/**
 * Seed runner — `pnpm db:seed`.
 *
 * Four stages, in dependency order:
 *
 *   1. Access control (permissions, roles, grants, default settings). Master
 *      data that a production database also legitimately needs, so it runs
 *      everywhere.
 *   2. Development accounts. Refused under NODE_ENV=production by
 *      `seedDevUsers` itself; skipped here with a clear message so a production
 *      run is not reported as a failure.
 *   3. Catalog: service types, the seven plans, three collection areas.
 *   4. Demo subscribers and service accounts — the dataset the acceptance
 *      demonstration runs against.
 *
 * Stages 2–4 are development-only. Idempotent: running it twice leaves the same
 * state. Passwords are read from the environment when the SEED_* variables are
 * set, otherwise the documented development defaults are used. The password
 * itself is never printed.
 */

const packageRoot = resolve(import.meta.dirname, '..');
const rootEnvPath = resolve(packageRoot, '..', '.env');

if (existsSync(rootEnvPath)) {
  process.loadEnvFile(rootEnvPath);
}

const connectionString = process.env.DATABASE_URL;

if (connectionString === undefined || connectionString.length === 0) {
  process.stderr.write(
    'DATABASE_URL is not set.\n' +
      'Start the local cluster with `pnpm pg:start`, then copy .env.example to .env.\n',
  );
  process.exit(1);
}

const pool = createPool({ connectionString });

try {
  process.stdout.write('Seeding access control (permissions, roles, settings)...\n');
  const access = await seedAccessControl(pool);
  process.stdout.write(
    `  permissions: ${String(access.permissions)}, roles: ${String(access.roles)}, ` +
      `grants: ${String(access.rolePermissions)}, settings: ${String(access.settings)}\n`,
  );

  if (process.env.NODE_ENV === 'production') {
    process.stdout.write(
      'NODE_ENV=production: skipping development accounts. ' +
        'Create the first Owner through the documented deployment step.\n',
    );
  } else {
    process.stdout.write('Seeding development accounts...\n');
    const dev = await seedDevUsers(pool);

    for (const user of dev.users) {
      process.stdout.write(
        `  ${user.username.padEnd(22)} ${user.role.padEnd(22)} ${user.status}\n`,
      );
    }

    process.stdout.write(
      '\nPasswords are the documented development defaults ' +
        '(see README "Development accounts"), unless overridden by the SEED_* variables:\n',
    );
    for (const spec of DEV_USERS) {
      process.stdout.write(`  ${spec.passwordEnv.padEnd(28)} ${passwordSourceFor(spec)}\n`);
    }
    if (dev.usedDefaultPasswords) {
      process.stdout.write(
        '\nWARNING: development defaults in use. Never run this seed against production data.\n',
      );
    }

    process.stdout.write('\nSeeding catalog (service types, plans, collection areas)...\n');
    const catalog = await seedCatalog(pool);
    process.stdout.write(
      `  service types: ${String(catalog.serviceTypes)}, plans: ${String(catalog.plans)}, ` +
        `collection areas: ${String(catalog.collectionAreas)}\n`,
    );

    process.stdout.write('Seeding demo subscribers and service accounts...\n');
    const demo = await seedDemoData(pool);
    process.stdout.write(
      `  subscribers created: ${String(demo.subscribers)}, ` +
        `service accounts created: ${String(demo.serviceAccounts)}, ` +
        `addresses: ${String(demo.addresses)}, contacts: ${String(demo.contacts)}\n`,
    );

    process.stdout.write('Seeding billing history (cycles, invoices, ledger)...\n');
    const billing = await seedBilling(pool);
    process.stdout.write(
      `  months: ${demoBillingMonths().join(', ')}, cycles created: ${String(billing.cycles)}, ` +
        `invoices created: ${String(billing.invoices)}, billed: ${String(billing.totalCentavos)} centavos\n`,
    );

    process.stdout.write('Seeding payments (posted cash and a GCash queue)...\n');
    const payments = await seedPayments(pool);
    process.stdout.write(
      `  payments: ${String(payments.payments)}, receipts: ${String(payments.receipts)}, ` +
        `pending verification: ${String(payments.pendingVerification)}\n`,
    );

    process.stdout.write('Seeding collections (batches and a remittance)...\n');
    const collections = await seedCollections(pool);
    process.stdout.write(
      `  batches: ${String(collections.batches)}, remittances: ${String(collections.remittances)}\n`,
    );
  }

  process.stdout.write('\nSeed complete.\n');
} catch (error) {
  process.stderr.write(`Seed failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
