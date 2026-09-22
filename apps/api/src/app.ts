import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import { env, isDevelopment } from './config/env';
import { auditRoutes } from './modules/audit/audit.routes';
import { authRoutes } from './modules/auth/auth.routes';
import { catalogRoutes } from './modules/catalog/catalog.routes';
import { collectionRoutes } from './modules/collection/collection.routes';
import { healthRoutes } from './modules/health/health.routes';
import { rbacRoutes } from './modules/rbac/rbac.routes';
import { searchRoutes } from './modules/search/search.routes';
import { serviceAccountRoutes } from './modules/service-accounts/service-accounts.routes';
import { settingsRoutes } from './modules/settings/settings.routes';
import { subscriberRoutes } from './modules/subscribers/subscribers.routes';
import { userRoutes } from './modules/users/users.routes';
import { billingRoutes } from './modules/billing/billing.routes';
import { registerBillingSearchProviders } from './modules/billing/billing.search';
import { ledgerRoutes } from './modules/ledger/ledger.routes';
import { receivablesRoutes } from './modules/receivables/receivables.routes';
import { reportsRoutes } from './modules/reports/reports.routes';
import { backupRoutes } from './modules/backup/backup.routes';
import { integrityRoutes } from './modules/integrity/integrity.routes';
import { paymentsRoutes } from './modules/payments/payments.routes';
import authPlugin from './plugins/auth';
import databasePlugin from './plugins/database';
import errorHandlerPlugin from './plugins/error-handler';

/**
 * Application factory.
 *
 * ── WHY A FACTORY RATHER THAN A MODULE-LEVEL SERVER ─────────────────────────
 * `buildApp()` has no side effects: it does not listen on a port, does not
 * read global state beyond validated configuration, and returns an instance
 * that can be closed. Integration tests call it directly and use
 * `app.inject()` to exercise real routes against a real database without
 * binding a socket, so the test suite and production run the same code path.
 *
 * `server.ts` is the only place that calls `listen()`.
 */
/**
 * The non-undefined half of Fastify's logger option.
 *
 * `exactOptionalPropertyTypes` rejects assigning `undefined` to an optional
 * property, so the helper below must return a concrete value rather than
 * `FastifyServerOptions['logger']`, which includes `undefined`.
 */
type LoggerOption = NonNullable<FastifyServerOptions['logger']>;

export async function buildApp(options: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger === false ? false : buildLoggerOptions(),

    // The API sits behind a reverse proxy only in the Phase 9 deployment. Until
    // then, trusting a forwarded header would let a client spoof its own IP in
    // the audit log. It is enabled explicitly at deployment time instead.
    trustProxy: false,

    // Do not echo the schema back in error responses: a validation failure
    // should describe the field, not the internals of the server.
    ajv: { customOptions: { allErrors: true, removeAdditional: 'all' } },
  });

  // Registration order matters, and it is now load-bearing:
  //   1. Errors must be handled before any plugin can throw.
  //   2. The database must exist before anything queries it.
  //   3. The auth plugin installs the `onRoute` hook that refuses to start the
  //      server if a route below forgets to declare its policy. It therefore
  //      has to be registered BEFORE any route plugin.
  await app.register(errorHandlerPlugin);
  await app.register(databasePlugin);
  await app.register(authPlugin);

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(rbacRoutes);
  await app.register(auditRoutes);
  await app.register(settingsRoutes);
  await app.register(catalogRoutes);
  await app.register(collectionRoutes);
  await app.register(subscriberRoutes);
  await app.register(serviceAccountRoutes);
  await app.register(searchRoutes);
  await app.register(billingRoutes);
  await app.register(ledgerRoutes);
  await app.register(receivablesRoutes);
  await app.register(reportsRoutes);
  await app.register(backupRoutes);
  await app.register(integrityRoutes);
  await app.register(paymentsRoutes);

  // Billing makes invoice numbers searchable. Registering here rather than at
  // module scope keeps the registration tied to building an application, so a
  // test that builds one a hundred times does not accumulate providers.
  registerBillingSearchProviders();

  return app;
}

function buildLoggerOptions(): LoggerOption {
  const base = {
    level: env.LOG_LEVEL,

    /**
     * ── REDACTION ───────────────────────────────────────────────────────────
     * §16 requires that passwords and secrets never reach the log. Redaction
     * is configured here rather than trusted to callers, because the one time
     * someone logs a whole request object is the time it matters.
     *
     * Phase 2 adds the session token header and the credential-bearing bodies,
     * so the redaction list now covers those paths as well. Phase 5 adds
     * payment reference numbers, which are sensitive in the same way a bank
     * reference is.
     */
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        '*.password',
        '*.currentPassword',
        '*.newPassword',
        '*.passwordHash',
        '*.token',
        '*.sessionToken',
        '*.temporaryPassword',
        'req.body.password',
        'req.body.currentPassword',
        'req.body.newPassword',
      ],
      censor: '[redacted]',
    },
  };

  if (!isDevelopment) {
    // Structured JSON in test and production, where logs are consumed by a tool.
    return base;
  }

  return {
    ...base,
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss.l',
        ignore: 'pid,hostname',
      },
    },
  };
}
