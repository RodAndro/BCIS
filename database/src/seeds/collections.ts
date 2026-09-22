import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

/**
 * Demo collections.
 *
 * Creates one OPEN collection batch per seeded area (so the batch list is not
 * empty) and advances one batch through a balanced remittance (so the
 * remittance screen shows a real, reconciled record).
 */

export interface CollectionsSeedResult {
  readonly batches: number;
  readonly remittances: number;
}

export async function seedCollections(pool: Pool): Promise<CollectionsSeedResult> {
  const client = await pool.connect();

  let batches = 0;
  let remittances = 0;

  try {
    await client.query('BEGIN');

    const areas = await client.query<{ id: number }>(
      'SELECT id FROM collection_areas WHERE is_active ORDER BY code LIMIT 2',
    );
    const collectorId = await firstActiveCollector(client);

    if (collectorId !== null) {
      for (const [index, area] of areas.rows.entries()) {
        const accounts = await client.query<{ id: number }>(
          `SELECT sa.id
             FROM service_accounts sa
             JOIN subscribers s ON s.id = sa.subscriber_id
            WHERE s.collection_area_id = $1 AND sa.status = 'ACTIVE'
            ORDER BY sa.id
            LIMIT 5`,
          [area.id],
        );

        if (accounts.rows.length === 0) continue;

        const batchDate = new Date().toISOString().slice(0, 10);
        const batchNumber = `CB-${batchDate.replaceAll('-', '')}-${randomUUID().slice(0, 8).toUpperCase()}`;
        const expected = 50_000 * accounts.rows.length;

        const batch = await client.query<{ id: number }>(
          `INSERT INTO collection_batches
             (batch_number, collector_user_id, collection_area_id, batch_date, status,
              expected_receivable_centavos)
           VALUES ($1, $2, $3, $4, 'OPEN', $5)
           RETURNING id`,
          [batchNumber, collectorId, area.id, batchDate, expected],
        );
        const batchId = batch.rows[0]?.id;
        if (batchId === undefined) continue;

        for (const account of accounts.rows) {
          await client.query(
            `INSERT INTO collection_batch_accounts
               (batch_id, service_account_id, expected_amount_centavos, collected_amount_centavos, outcome)
             VALUES ($1, $2, 50000, 0, 'NOT_HOME')`,
            [batchId, account.id],
          );
        }

        batches += 1;

        // Advance the first batch through a balanced remittance.
        if (index === 0) {
          await client.query(
            `UPDATE collection_batches
                SET status = 'SUBMITTED', cash_collected_centavos = $2, submitted_at = now()
              WHERE id = $1`,
            [batchId, expected],
          );

          await client.query(
            `INSERT INTO collector_remittances
               (batch_id, remitted_cash_centavos, variance_centavos, variance_type, remitted_at, received_by, approved_by)
             VALUES ($1, $2, 0, 'BALANCED', now(), $3, $3)`,
            [batchId, expected, collectorId],
          );

          await client.query(
            `UPDATE collection_batches SET status = 'REMITTED', remitted_cash_centavos = $2 WHERE id = $1`,
            [batchId, expected],
          );

          remittances += 1;
        }
      }
    }

    await client.query('COMMIT');

    return { batches, remittances };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function firstActiveCollector(client: PoolClient): Promise<number | null> {
  const rows = await client.query<{ id: number }>(
    `SELECT id FROM users
      WHERE status = 'ACTIVE' AND username IN ('supervisor', 'administrator', 'cashier')
      ORDER BY username
      LIMIT 1`,
  );
  return rows.rows[0]?.id ?? null;
}
