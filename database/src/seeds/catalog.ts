import type { Pool } from 'pg';

/**
 * Service types, plans, and collection areas.
 *
 * ── IDEMPOTENT BY CONFLICT ──────────────────────────────────────────────────
 * Every insert is `ON CONFLICT DO NOTHING` against the natural key, so running
 * the seed twice leaves one of each. The amounts are integers of centavos —
 * ₱999.00 is 99900 — and never a decimal, anywhere.
 */

interface ServiceTypeSeed {
  readonly code: string;
  readonly name: string;
  readonly description: string;
}

const SERVICE_TYPES: readonly ServiceTypeSeed[] = [
  { code: 'INTERNET', name: 'Internet', description: 'Broadband internet access.' },
  { code: 'CABLE', name: 'Cable TV', description: 'Cable television service.' },
  {
    code: 'COMBO',
    name: 'Internet + Cable',
    description: 'Bundled internet and cable television on one bill.',
  },
];

interface PlanSeed {
  readonly code: string;
  readonly serviceTypeCode: string;
  readonly name: string;
  readonly description: string;
  readonly speedMbps: number | null;
  readonly channelCount: number | null;
  readonly monthlyFeeCentavos: number;
  readonly installationFeeCentavos: number;
  readonly reconnectionFeeCentavos: number;
}

/**
 * Seven plans: three Internet, two Cable, two Combo — the mix §32 asks for.
 *
 * Prices are plausible for a Bukidnon cable-and-internet operator and are
 * deliberately round so a reviewer can verify a bill by hand.
 */
const PLANS: readonly PlanSeed[] = [
  {
    code: 'INT-50',
    serviceTypeCode: 'INTERNET',
    name: 'Fiber 50',
    description: '50 Mbps fiber line, suitable for a small household.',
    speedMbps: 50,
    channelCount: null,
    monthlyFeeCentavos: 99_900,
    installationFeeCentavos: 150_000,
    reconnectionFeeCentavos: 50_000,
  },
  {
    code: 'INT-100',
    serviceTypeCode: 'INTERNET',
    name: 'Fiber 100',
    description: '100 Mbps fiber line for a connected household.',
    speedMbps: 100,
    channelCount: null,
    monthlyFeeCentavos: 129_900,
    installationFeeCentavos: 150_000,
    reconnectionFeeCentavos: 50_000,
  },
  {
    code: 'INT-300',
    serviceTypeCode: 'INTERNET',
    name: 'Fiber 300',
    description: '300 Mbps fiber line for heavy use and small offices.',
    speedMbps: 300,
    channelCount: null,
    monthlyFeeCentavos: 199_900,
    installationFeeCentavos: 250_000,
    reconnectionFeeCentavos: 50_000,
  },
  {
    code: 'CAB-100',
    serviceTypeCode: 'CABLE',
    name: 'Cable 100',
    description: 'Cable television with 100 channels.',
    speedMbps: null,
    channelCount: 100,
    monthlyFeeCentavos: 55_000,
    installationFeeCentavos: 50_000,
    reconnectionFeeCentavos: 30_000,
  },
  {
    code: 'CAB-150',
    serviceTypeCode: 'CABLE',
    name: 'Cable 150',
    description: 'Cable television with 150 channels including premium channels.',
    speedMbps: null,
    channelCount: 150,
    monthlyFeeCentavos: 75_000,
    installationFeeCentavos: 50_000,
    reconnectionFeeCentavos: 30_000,
  },
  {
    code: 'CMB-100',
    serviceTypeCode: 'COMBO',
    name: 'Combo 100',
    description: '100 Mbps internet with 100-channel cable on one bill.',
    speedMbps: 100,
    channelCount: 100,
    monthlyFeeCentavos: 149_900,
    installationFeeCentavos: 200_000,
    reconnectionFeeCentavos: 50_000,
  },
  {
    code: 'CMB-200',
    serviceTypeCode: 'COMBO',
    name: 'Combo 200',
    description: '200 Mbps internet with 150-channel cable on one bill.',
    speedMbps: 200,
    channelCount: 150,
    monthlyFeeCentavos: 199_900,
    installationFeeCentavos: 200_000,
    reconnectionFeeCentavos: 50_000,
  },
];

/** The date every seeded plan starts. Fixed, so versioning is reproducible. */
export const SEED_PLAN_EFFECTIVE_FROM = '2026-01-01';

interface AreaSeed {
  readonly code: string;
  readonly name: string;
  readonly description: string;
}

/** Three areas, named after real barangays so a route sheet reads plausibly. */
const COLLECTION_AREAS: readonly AreaSeed[] = [
  { code: 'AREA-01', name: 'Poblacion', description: 'Town centre and immediate surroundings.' },
  {
    code: 'AREA-02',
    name: 'Casisang',
    description: 'Barangay Casisang and the national highway frontage.',
  },
  {
    code: 'AREA-03',
    name: 'Lumbo',
    description: 'Barangay Lumbo and the eastern residential streets.',
  },
];

export interface CatalogSeedResult {
  readonly serviceTypes: number;
  readonly plans: number;
  readonly collectionAreas: number;
}

export async function seedCatalog(pool: Pool): Promise<CatalogSeedResult> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (const type of SERVICE_TYPES) {
      await client.query(
        `INSERT INTO service_types (code, name, description)
         VALUES ($1, $2, $3)
         ON CONFLICT (code) DO NOTHING`,
        [type.code, type.name, type.description],
      );
    }

    for (const area of COLLECTION_AREAS) {
      await client.query(
        `INSERT INTO collection_areas (code, name, description)
         VALUES ($1, $2, $3)
         ON CONFLICT (code) DO NOTHING`,
        [area.code, area.name, area.description],
      );
    }

    for (const plan of PLANS) {
      const type = await client.query<{ id: number }>(
        'SELECT id FROM service_types WHERE code = $1',
        [plan.serviceTypeCode],
      );
      const serviceTypeId = type.rows[0]?.id;
      if (serviceTypeId === undefined) {
        throw new Error(`Seed failed: service type ${plan.serviceTypeCode} is missing.`);
      }

      await client.query(
        `INSERT INTO service_plans
           (code, service_type_id, name, description, speed_mbps, channel_count,
            monthly_fee_centavos, installation_fee_centavos, reconnection_fee_centavos,
            effective_from, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'ACTIVE')
         ON CONFLICT (code, effective_from) DO NOTHING`,
        [
          plan.code,
          serviceTypeId,
          plan.name,
          plan.description,
          plan.speedMbps,
          plan.channelCount,
          plan.monthlyFeeCentavos,
          plan.installationFeeCentavos,
          plan.reconnectionFeeCentavos,
          SEED_PLAN_EFFECTIVE_FROM,
        ],
      );
    }

    await client.query('COMMIT');

    return {
      serviceTypes: SERVICE_TYPES.length,
      plans: PLANS.length,
      collectionAreas: COLLECTION_AREAS.length,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
