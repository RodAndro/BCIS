import { buildApp } from './app';
import { env } from './config/env';

/**
 * API entrypoint.
 *
 * This is the only file that binds a port. Everything else is reachable from
 * `buildApp()` so it can be tested without touching the network.
 */

const app = await buildApp();

/**
 * Graceful shutdown.
 *
 * A payment posting holds a database transaction open. Killing the process
 * mid-transaction rolls it back — which is safe, because the transaction is
 * atomic — but it also drops in-flight requests for the other two clients.
 * Closing the server first lets Fastify finish the requests it has already
 * accepted, and the `onClose` hook in the database plugin then drains the pool.
 */
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  app.log.info({ signal }, 'shutting down');

  try {
    await app.close();
    process.exit(0);
  } catch (error) {
    app.log.error({ err: error }, 'error during shutdown');
    process.exit(1);
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

try {
  await app.listen({ host: env.API_HOST, port: env.API_PORT });
} catch (error) {
  app.log.error({ err: error }, 'failed to start');
  process.exit(1);
}
