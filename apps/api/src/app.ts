import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import { env, isDevelopment } from './config/env';
import { healthRoutes } from './modules/health/health.routes';
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

  // Registration order matters. Errors must be handled before any plugin can
  // throw, and the database must exist before a route uses it.
  await app.register(errorHandlerPlugin);
  await app.register(databasePlugin);
  await app.register(healthRoutes);

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
     * Phase 2 adds the session token header; Phase 5 adds payment reference
     * numbers, which are sensitive in the same way a bank reference is.
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
