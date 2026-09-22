import {
  billingPeriodFor,
  chargeLine,
  computeInvoiceDates,
  computeInvoiceTotals,
  monthKeyOf,
  summariseLines,
  type InvoiceLine,
} from '@bcis/domain';
import { addBusinessMonths, businessToday, centavos } from '@bcis/shared';
import type { Pool, PoolClient } from 'pg';

/**
 * Demo billing data.
 *
 * ── WHY THIS USES THE SAME RULES AS THE API ─────────────────────────────────
 * Every amount, date and total here comes from `@bcis/domain` — the same pure
 * functions the billing service calls. A seed that reimplemented "what does this
 * month cost" would eventually disagree with the generator, and the demo
 * dataset would quietly stop matching what the system actually does.
 *
 * ── WHY THE MONTHS ARE RELATIVE TO TODAY ────────────────────────────────────
 * The three seeded months are the three immediately before the current one. A
 * fixed set of months would be in the future on a fresh clone and nothing would
 * demonstrate an overdue account — which is the point of seeding billing at all.
 * The randomness in the rest of the seed is still fixed (decision A16); only the
 * calendar is anchored to now.
 *
 * No payments are written: payment posting is Phase 5. Every seeded invoice is
 * therefore UNPAID, and the older ones are overdue by the time anyone looks.
 */

export interface BillingSeedResult {
  readonly cycles: number;
  readonly invoices: number;
  readonly totalCentavos: number;
}

interface BillableRow {
  readonly id: number;
  readonly subscriberId: number;
  readonly accountNumber: string;
  readonly planCode: string;
  readonly planName: string;
  readonly billingDay: number;
  readonly dueDay: number;
  readonly currentPlanPriceCentavos: number;
  readonly installationFeeCentavos: number;
  readonly installationFeeCharged: boolean;
}

/** The three billing months the demo covers, oldest first. */
export function demoBillingMonths(today = businessToday()): readonly string[] {
  const monthStart = `${monthKeyOf(today)}-01`;

  return [
    monthKeyOf(addBusinessMonths(monthStart, -3)),
    monthKeyOf(addBusinessMonths(monthStart, -2)),
    monthKeyOf(addBusinessMonths(monthStart, -1)),
  ];
}

export async function seedBilling(pool: Pool): Promise<BillingSeedResult> {
  const client = await pool.connect();

  let cycles = 0;
  let invoicesCreated = 0;
  let totalCentavos = 0;

  try {
    await client.query('BEGIN');

    for (const month of demoBillingMonths()) {
      const period = billingPeriodFor(month);

      const existingCycle = await client.query<{ id: number }>(
        'SELECT id FROM billing_cycles WHERE period_start = $1',
        [period.periodStart],
      );

      let cycleId = existingCycle.rows[0]?.id;

      if (cycleId === undefined) {
        const inserted = await client.query<{ id: number }>(
          `INSERT INTO billing_cycles (period_start, period_end, due_date, label, status, generated_at)
           VALUES ($1, $2, $2, $3, 'GENERATED', now())
           RETURNING id`,
          [period.periodStart, period.periodEnd, period.label],
        );
        cycleId = inserted.rows[0]?.id;
        cycles += 1;
      }

      if (cycleId === undefined) {
        throw new Error(`Seed failed: no billing cycle for ${period.periodStart}.`);
      }

      const accounts = await loadBillableAccounts(client, period.periodEnd);

      for (const account of accounts) {
        const already = await client.query<{ id: number }>(
          `SELECT id FROM invoices
            WHERE service_account_id = $1 AND billing_period_start = $2 AND status <> 'VOID'`,
          [account.id, period.periodStart],
        );

        if (already.rows.length > 0) continue;

        const lines: InvoiceLine[] = [
          chargeLine({
            itemType: 'SUBSCRIPTION',
            description: `${period.label} — ${account.planCode} ${account.planName}`,
            unitPriceCentavos: centavos(account.currentPlanPriceCentavos),
          }),
        ];

        const billsInstallation =
          !account.installationFeeCharged && account.installationFeeCentavos > 0;
        if (billsInstallation) {
          lines.push(
            chargeLine({
              itemType: 'INSTALLATION',
              description: 'Installation fee (one-time)',
              unitPriceCentavos: centavos(account.installationFeeCentavos),
            }),
          );
        }

        const totals = computeInvoiceTotals({ ...summariseLines(lines) });
        const dates = computeInvoiceDates({
          periodStart: period.periodStart,
          billingDay: account.billingDay,
          dueDay: account.dueDay,
        });

        const periodYear = Number(period.periodStart.slice(0, 4));

        // The invoice number comes from the same row-locked counter the API
        // uses, so a seeded database and a billed one cannot collide.
        const sequence = await client.query<{ prefix: string; current_value: number }>(
          `INSERT INTO document_sequences (scope, period_year, prefix, current_value)
           VALUES ('INVOICE', $1, 'INV', 1)
           ON CONFLICT (scope, period_year) DO UPDATE
             SET current_value = document_sequences.current_value + 1, updated_at = now()
           RETURNING prefix, current_value`,
          [periodYear],
        );

        const seq = sequence.rows[0];
        if (seq === undefined) throw new Error('Seed failed: invoice numbering returned no row.');

        const invoiceNumber = `${seq.prefix}-${String(periodYear)}-${String(seq.current_value).padStart(6, '0')}`;

        // Created unposted, then its lines, then posted — the same order the
        // generator uses, and the order the immutability trigger requires.
        const inserted = await client.query<{ id: number }>(
          `INSERT INTO invoices
             (invoice_number, subscriber_id, service_account_id, billing_cycle_id,
              billing_period_start, billing_period_end, issue_date, due_date,
              subtotal_centavos, discount_centavos, penalty_centavos, adjustment_centavos,
              tax_centavos, total_centavos, paid_centavos, balance_centavos, status, finalized_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 0, $14,
                   'DRAFT', NULL)
           RETURNING id`,
          [
            invoiceNumber,
            account.subscriberId,
            account.id,
            cycleId,
            period.periodStart,
            period.periodEnd,
            dates.issueDate,
            dates.dueDate,
            totals.subtotalCentavos,
            totals.discountCentavos,
            totals.penaltyCentavos,
            totals.adjustmentCentavos,
            totals.taxCentavos,
            totals.totalCentavos,
          ],
        );

        const invoiceId = inserted.rows[0]?.id;
        if (invoiceId === undefined) {
          throw new Error('Seed failed: invoice insert returned no id.');
        }

        let sortOrder = 0;
        for (const line of lines) {
          await client.query(
            `INSERT INTO invoice_items
               (invoice_id, item_type, direction, description, quantity,
                unit_price_centavos, amount_centavos, service_account_id, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              invoiceId,
              line.itemType,
              line.direction,
              line.description,
              line.quantity,
              line.unitPriceCentavos,
              line.amountCentavos,
              account.id,
              sortOrder,
            ],
          );
          sortOrder += 1;
        }

        await client.query(
          `UPDATE invoices SET status = 'UNPAID', finalized_at = now() WHERE id = $1`,
          [invoiceId],
        );

        if (totals.totalCentavos > 0) {
          await client.query(
            `INSERT INTO ledger_entries
               (service_account_id, subscriber_id, entry_date, entry_type, source_type, source_id,
                reference_no, description, debit_centavos, credit_centavos)
             VALUES ($1, $2, $3, 'INVOICE', 'invoice', $4, $5, $6, $7, 0)`,
            [
              account.id,
              account.subscriberId,
              dates.issueDate,
              invoiceId,
              invoiceNumber,
              `${period.label} — ${account.planCode} ${account.planName}`,
              totals.totalCentavos,
            ],
          );
        }

        if (billsInstallation) {
          await client.query(
            'UPDATE service_accounts SET installation_fee_charged = true WHERE id = $1',
            [account.id],
          );
        }

        invoicesCreated += 1;
        totalCentavos += totals.totalCentavos;
      }
    }

    await client.query('COMMIT');

    return { cycles, invoices: invoicesCreated, totalCentavos };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** The same selection the billing generator uses: active, and started by period end. */
async function loadBillableAccounts(
  client: PoolClient,
  periodEnd: string,
): Promise<readonly BillableRow[]> {
  const rows = await client.query<{
    id: number;
    subscriber_id: number;
    account_number: string;
    plan_code: string;
    plan_name: string;
    billing_day: number;
    due_day: number;
    current_plan_price_centavos: number;
    installation_fee_centavos: number;
    installation_fee_charged: boolean;
  }>(
    `SELECT sa.id,
            sa.subscriber_id,
            sa.account_number,
            sp.code  AS plan_code,
            sp.name  AS plan_name,
            sa.billing_day,
            sa.due_day,
            sa.current_plan_price_centavos,
            sp.installation_fee_centavos,
            sa.installation_fee_charged
       FROM service_accounts sa
       JOIN service_plans sp ON sp.id = sa.service_plan_id
      WHERE sa.status = 'ACTIVE'
        AND sa.billing_start_date <= $1
      ORDER BY sa.account_number`,
    [periodEnd],
  );

  return rows.rows.map((row) => ({
    id: row.id,
    subscriberId: row.subscriber_id,
    accountNumber: row.account_number,
    planCode: row.plan_code,
    planName: row.plan_name,
    billingDay: row.billing_day,
    dueDay: row.due_day,
    currentPlanPriceCentavos: row.current_plan_price_centavos,
    installationFeeCentavos: row.installation_fee_centavos,
    installationFeeCharged: row.installation_fee_charged,
  }));
}
