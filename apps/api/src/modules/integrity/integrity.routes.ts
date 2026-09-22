import { sql } from 'drizzle-orm';
import { PERMISSIONS } from '@bcis/shared';
import type { FastifyPluginAsync } from 'fastify';

import { successBody } from '@bcis/validation';

export const integrityRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/integrity',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.INTEGRITY_CHECK_RUN } } },
    async (_request, reply) => {
      const checks = await Promise.all([
        app.db.execute(
          sql`select count(*)::int as failures from invoices where total_centavos <> subtotal_centavos - discount_centavos + penalty_centavos + adjustment_centavos + tax_centavos`,
        ),
        app.db.execute(
          sql`select count(*)::int as failures from invoices where balance_centavos <> total_centavos - paid_centavos`,
        ),
        app.db.execute(
          sql`select count(*)::int as failures from ledger_entries where (debit_centavos > 0 and credit_centavos > 0) or (debit_centavos = 0 and credit_centavos = 0)`,
        ),
        app.db.execute(
          sql`select count(*)::int as failures from payment_allocations allocation join invoices invoice on invoice.id = allocation.invoice_id where allocation.amount_centavos <= 0`,
        ),
      ]);
      const names = [
        'invoice_total_identity',
        'invoice_balance_identity',
        'ledger_exactly_one_side',
        'payment_allocation_positive',
      ];
      const results = checks.map((check, index) => ({
        name: names[index],
        failures: Number((check.rows[0] as { failures?: number } | undefined)?.failures ?? 0),
        ok: Number((check.rows[0] as { failures?: number } | undefined)?.failures ?? 0) === 0,
      }));
      return reply.send(successBody({ ok: results.every((result) => result.ok), checks: results }));
    },
  );
};
