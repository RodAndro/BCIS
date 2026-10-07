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
        /*
         * AR aging reconciles with outstanding invoice balances.
         *
         * The aging buckets are computed from allocation-derived balances; the
         * stored `balance_centavos` is the maintained cache the list screens
         * read. If the two totals ever diverge, the aging report and the
         * invoice list are telling an operator different stories, so the
         * comparison is the check.
         */
        app.db.execute(
          sql`select count(*)::int as failures from (
                select
                  coalesce(sum(greatest(invoice.total_centavos - coalesce(alloc.sum_alloc, 0), 0)), 0) as derived,
                  coalesce(sum(invoice.balance_centavos), 0) as cached
                from invoices invoice
                left join (
                  select allocation.invoice_id,
                         sum(case when allocation.is_reversal then -allocation.amount_centavos else allocation.amount_centavos end) as sum_alloc
                  from payment_allocations allocation
                  group by allocation.invoice_id
                ) alloc on alloc.invoice_id = invoice.id
                where invoice.status <> 'VOID'
              ) balances
              where balances.derived <> balances.cached`,
        ),
      ]);
      const names = [
        'invoice_total_identity',
        'invoice_balance_identity',
        'ledger_exactly_one_side',
        'payment_allocation_positive',
        'aging_reconciles_with_outstanding',
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
