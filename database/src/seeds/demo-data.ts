import type { Pool, PoolClient } from 'pg';

import { createRandom } from './random';

/**
 * Synthetic subscribers and service accounts.
 *
 * ── SYNTHETIC ONLY (§32 / A16) ──────────────────────────────────────────────
 * Every name, number, and address here is invented or drawn from a fixed list.
 * No real subscriber, phone number, or GCash detail appears anywhere in this
 * file, and the generator is seeded, so the same fifty subscribers exist on
 * every machine and every run.
 *
 * ── WHY THE ACCOUNT NUMBERS ARE FIXED STRINGS ───────────────────────────────
 * The API allocates numbers from `document_sequences`. If the seed used the
 * same allocator, the demo accounts would depend on whatever had been created
 * before, and a re-run would renumber them. Instead the seed writes its own
 * fixed numbers and then advances the counters past them, so the first
 * subscriber registered through the API continues after the demo data rather
 * than colliding with it.
 */

const SEED = 20_260_101;
const SUBSCRIBER_COUNT = 50;

const FIRST_NAMES = [
  'Juan',
  'Maria',
  'Jose',
  'Ana',
  'Pedro',
  'Rosa',
  'Antonio',
  'Luz',
  'Ramon',
  'Carmen',
  'Nestor',
  'Elena',
  'Ricardo',
  'Gloria',
  'Mario',
  'Teresa',
] as const;

const SURNAMES = [
  'Dela Cruz',
  'Reyes',
  'Santos',
  'Bautista',
  'Villanueva',
  'Mendoza',
  'Garcia',
  'Torres',
  'Ramos',
  'Aquino',
  'Flores',
  'Gonzales',
  'Bacalso',
  'Sarmiento',
  'Tabios',
] as const;

const STREETS = [
  'Rizal Street',
  'Bonifacio Street',
  'Mabini Street',
  'Serna Street',
  'National Highway',
  'Purok 3',
  'Purok 5',
  'Sayre Highway',
] as const;

const COMMERCIAL_NAMES = [
  'Sunrise Sari-Sari Store',
  'Highway Carinderia',
  'Bukidnon Trading',
  'Green Valley Bakery',
  'Malaybalay Auto Supply',
  'Riverside Eatery',
] as const;

/** `2026-01-05` + n days, using UTC arithmetic so no local date can shift it. */
function addDays(isoDate: string, days: number): string {
  const parts = isoDate.split('-');
  const year = Number(parts[0] ?? '0');
  const month = Number(parts[1] ?? '1');
  const day = Number(parts[2] ?? '1');

  const shifted = new Date(Date.UTC(year, month - 1, day) + days * 86_400_000);
  return shifted.toISOString().slice(0, 10);
}

function padded(prefix: string, value: number): string {
  return `${prefix}-${String(value).padStart(6, '0')}`;
}

interface PlanLite {
  readonly id: number;
  readonly code: string;
  readonly monthlyFeeCentavos: number;
}

interface AreaLite {
  readonly id: number;
  readonly name: string;
}

export interface DemoDataSeedResult {
  readonly subscribers: number;
  readonly serviceAccounts: number;
  readonly addresses: number;
  readonly contacts: number;
}

export async function seedDemoData(pool: Pool): Promise<DemoDataSeedResult> {
  const random = createRandom(SEED);
  const client = await pool.connect();

  let subscribersCreated = 0;
  let accountsCreated = 0;
  let addressesCreated = 0;
  let contactsCreated = 0;

  try {
    await client.query('BEGIN');

    const plans = await loadPlans(client);
    const areas = await loadAreas(client);
    const collectors = await loadCollectors(client);

    if (plans.length === 0 || areas.length === 0) {
      throw new Error('Seed failed: run the catalog seed before the demo data.');
    }

    for (let index = 0; index < SUBSCRIBER_COUNT; index += 1) {
      const plan = plans[index % plans.length];
      const area = areas[index % areas.length];
      const collector = collectors.length === 0 ? null : collectors[index % collectors.length];
      if (plan === undefined || area === undefined) {
        throw new Error('Seed failed: the catalog does not cover the demo range.');
      }

      // Every 10th subscriber is a business; one is a government account. The
      // mix exercises the subscriber-type filter and the statement wording.
      const subscriberType =
        index === 7 ? 'GOVERNMENT' : index % 10 === 4 ? 'COMMERCIAL' : 'RESIDENTIAL';

      // Two subscribers are inactive, one terminated, one archived. The
      // terminated and archived ones get no active service, which is what the
      // API's archive guard would require anyway.
      const status =
        index === 13
          ? 'INACTIVE'
          : index === 27
            ? 'INACTIVE'
            : index === 41
              ? 'TERMINATED'
              : index === 49
                ? 'ARCHIVED'
                : 'ACTIVE';

      const accountNumber = padded('SUB', index + 1);
      const displayName =
        subscriberType === 'RESIDENTIAL'
          ? `${random.pick(FIRST_NAMES)} ${random.pick(SURNAMES)}`
          : `${random.pick(COMMERCIAL_NAMES)}${index}`;

      const billingDay = [1, 8, 15, 22][index % 4] ?? 1;
      const dueDay = Math.min(28, billingDay + 10);
      const mobile = `09${String(random.int(100_000_000, 999_999_999))}`;

      const existing = await client.query<{ id: number }>(
        'SELECT id FROM subscribers WHERE account_number = $1',
        [accountNumber],
      );

      let subscriberId = existing.rows[0]?.id;

      if (subscriberId === undefined) {
        const inserted = await client.query<{ id: number }>(
          `INSERT INTO subscribers
             (account_number, display_name, subscriber_type, status, collection_area_id,
              assigned_collector_id, billing_day, due_day, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id`,
          [
            accountNumber,
            displayName,
            subscriberType,
            status,
            area.id,
            collector,
            billingDay,
            dueDay,
            status === 'ACTIVE' ? null : `Seeded demo account in status ${status}.`,
          ],
        );

        const id = inserted.rows[0]?.id;
        if (id === undefined) throw new Error('Seed failed: subscriber insert returned no id.');
        subscriberId = id;
        subscribersCreated += 1;
      }

      // Addresses and contacts are only written when the subscriber has none,
      // so re-running the seed does not duplicate them.
      const addressCount = await client.query<{ total: string }>(
        'SELECT count(*)::text AS total FROM subscriber_addresses WHERE subscriber_id = $1',
        [subscriberId],
      );

      let serviceAddressId: number | null = null;

      if (Number(addressCount.rows[0]?.total ?? '0') === 0) {
        const serviceAddress = await client.query<{ id: number }>(
          `INSERT INTO subscriber_addresses
             (subscriber_id, address_type, label, line1, barangay, city_municipality, province,
              postal_code, is_primary)
           VALUES ($1, 'SERVICE', 'Installation', $2, $3, 'Malaybalay', 'Bukidnon', '8700', true)
           RETURNING id`,
          [subscriberId, `${String(random.int(1, 250))} ${random.pick(STREETS)}`, area.name],
        );
        serviceAddressId = serviceAddress.rows[0]?.id ?? null;
        addressesCreated += 1;

        // A second, different address for every fifth subscriber: the service
        // address and the billing address are frequently not the same place.
        if (index % 5 === 0) {
          await client.query(
            `INSERT INTO subscriber_addresses
               (subscriber_id, address_type, line1, barangay, city_municipality, province,
                postal_code, is_primary)
             VALUES ($1, 'BILLING', $2, $3, 'Malaybalay', 'Bukidnon', '8700', true)`,
            [subscriberId, `P.O. Box ${String(random.int(1, 900))}`, area.name],
          );
          addressesCreated += 1;
        }
      }

      const contactCount = await client.query<{ total: string }>(
        'SELECT count(*)::text AS total FROM subscriber_contacts WHERE subscriber_id = $1',
        [subscriberId],
      );

      if (Number(contactCount.rows[0]?.total ?? '0') === 0) {
        await client.query(
          `INSERT INTO subscriber_contacts (subscriber_id, contact_type, value, is_primary)
           VALUES ($1, 'MOBILE', $2, true)`,
          [subscriberId, mobile],
        );
        contactsCreated += 1;

        if (subscriberType !== 'RESIDENTIAL') {
          await client.query(
            `INSERT INTO subscriber_contacts (subscriber_id, contact_type, value, is_primary)
             VALUES ($1, 'EMAIL', $2, true)`,
            [subscriberId, `billing${String(index + 1)}@example.com`],
          );
          contactsCreated += 1;
        }
      }

      // One account each, plus a second for every fourth subscriber: 50 + 13.
      const accountCount = index % 4 === 0 ? 2 : 1;

      for (let accountIndex = 0; accountIndex < accountCount; accountIndex += 1) {
        const servicePlan = plans[(index + accountIndex) % plans.length];
        if (servicePlan === undefined) continue;

        const serviceAccountNumber = padded('SA', accountsCreated + 1);

        const alreadyThere = await client.query<{ id: number }>(
          'SELECT id FROM service_accounts WHERE account_number = $1',
          [serviceAccountNumber],
        );
        if (alreadyThere.rows.length > 0) continue;

        const accountStatus =
          status === 'ARCHIVED'
            ? 'CLOSED'
            : status === 'TERMINATED'
              ? 'DISCONNECTED'
              : index % 11 === 0
                ? 'SUSPENDED'
                : 'ACTIVE';

        const activationDate = addDays('2026-01-05', index + accountIndex * 3);

        const accountInsert = await client.query<{ id: number }>(
          `INSERT INTO service_accounts
             (account_number, subscriber_id, service_plan_id, installation_address_id, status,
              activation_date, billing_start_date, billing_day, due_day,
              current_plan_price_centavos, assigned_collector_id)
           VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10)
           RETURNING id`,
          [
            serviceAccountNumber,
            subscriberId,
            servicePlan.id,
            serviceAddressId,
            accountStatus,
            activationDate,
            billingDay,
            dueDay,
            servicePlan.monthlyFeeCentavos,
            collector,
          ],
        );

        const serviceAccountId = accountInsert.rows[0]?.id;
        if (serviceAccountId === undefined) {
          throw new Error('Seed failed: service account insert returned no id.');
        }

        // History is never empty for an account that exists.
        await client.query(
          `INSERT INTO service_events
             (service_account_id, event_type, from_value, to_value, effective_date, reason)
           VALUES ($1, 'ACTIVATED', NULL, $2, $3, 'Seeded demo account.')`,
          [serviceAccountId, accountStatus, activationDate],
        );

        accountsCreated += 1;
      }
    }

    // Move the counters past the demo data so API-allocated numbers continue
    // after it. GREATEST means a re-run never lowers a counter.
    await client.query(
      `INSERT INTO document_sequences (scope, period_year, prefix, current_value)
       VALUES ('SUBSCRIBER', 0, 'SUB', $1)
       ON CONFLICT (scope, period_year) DO UPDATE
         SET current_value = GREATEST(document_sequences.current_value, EXCLUDED.current_value),
             updated_at = now()`,
      [SUBSCRIBER_COUNT],
    );

    await client.query(
      `INSERT INTO document_sequences (scope, period_year, prefix, current_value)
       VALUES ('SERVICE_ACCOUNT', 0, 'SA', $1)
       ON CONFLICT (scope, period_year) DO UPDATE
         SET current_value = GREATEST(document_sequences.current_value, EXCLUDED.current_value),
             updated_at = now()`,
      [accountsCreated],
    );

    await client.query('COMMIT');

    return {
      subscribers: subscribersCreated,
      serviceAccounts: accountsCreated,
      addresses: addressesCreated,
      contacts: contactsCreated,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * `PoolClient` rather than `ReturnType<Pool['connect']>`: `pg` overloads
 * `connect`, and the last overload returns `void`, so `ReturnType` resolves to
 * the wrong thing entirely.
 */
type Client = PoolClient;

async function loadPlans(client: Client): Promise<readonly PlanLite[]> {
  const rows = await client.query<{ id: number; code: string; monthly_fee_centavos: number }>(
    `SELECT id, code, monthly_fee_centavos
       FROM service_plans
      WHERE effective_to IS NULL AND status = 'ACTIVE'
      ORDER BY code`,
  );

  return rows.rows.map((row) => ({
    id: row.id,
    code: row.code,
    monthlyFeeCentavos: row.monthly_fee_centavos,
  }));
}

async function loadAreas(client: Client): Promise<readonly AreaLite[]> {
  const rows = await client.query<{ id: number; name: string }>(
    'SELECT id, name FROM collection_areas WHERE is_active ORDER BY code',
  );
  return rows.rows;
}

/**
 * The people routes are assigned to.
 *
 * Prefers the seeded field-staff accounts; falls back to any active user so the
 * demo data still seeds if the accounts were renamed.
 *
 * ── AN OPEN QUESTION, NOT A DECISION ────────────────────────────────────────
 * The seven roles include no "Collector", so which staff walk a route is still
 * unsettled (roadmap A9 / Phase 6). The seed therefore assigns the two active
 * operational accounts and leaves the real answer to the phase that owns
 * collector assignments.
 */
async function loadCollectors(client: Client): Promise<readonly number[]> {
  const preferred = await client.query<{ id: number }>(
    `SELECT id FROM users
      WHERE status = 'ACTIVE' AND username IN ('supervisor', 'administrator')
      ORDER BY username`,
  );

  if (preferred.rows.length > 0) {
    return preferred.rows.map((row) => row.id);
  }

  const fallback = await client.query<{ id: number }>(
    `SELECT id FROM users WHERE status = 'ACTIVE' ORDER BY id LIMIT 2`,
  );
  return fallback.rows.map((row) => row.id);
}
