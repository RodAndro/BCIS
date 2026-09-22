import type { FastifyInstance } from 'fastify';

import type { TestPool } from './auth';

/**
 * Fixtures for the Phase 3 suites.
 *
 * ── WHY SERVICE TYPES AND AREAS ARE SEEDED WITH SQL ─────────────────────────
 * Service types have no create endpoint: they are reference data seeded with
 * the application, and the plan form only ever selects from them. Tests insert
 * them directly for the same reason the real seed does.
 *
 * Everything else — plans, subscribers, service accounts — is created through
 * the API, so a test failure means the API is wrong rather than the fixture.
 */

export async function seedServiceTypes(pool: TestPool): Promise<void> {
  const types: readonly (readonly [string, string])[] = [
    ['INTERNET', 'Internet'],
    ['CABLE', 'Cable TV'],
    ['COMBO', 'Internet + Cable'],
  ];

  for (const [code, name] of types) {
    await pool.query(
      `INSERT INTO service_types (code, name) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING`,
      [code, name],
    );
  }
}

export async function seedCollectionArea(
  pool: TestPool,
  code: string,
  name: string,
): Promise<number> {
  const rows = await pool.query<{ id: number }>(
    `INSERT INTO collection_areas (code, name)
     VALUES ($1, $2)
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [code, name],
  );

  const id = rows.rows[0]?.id;
  if (id === undefined) throw new Error(`Seeding collection area ${code} returned no id.`);
  return id;
}

interface InjectionResult<T> {
  readonly status: number;
  readonly data: T;
  readonly body: string;
}

async function inject<T>(
  app: FastifyInstance,
  method: 'POST' | 'PUT' | 'PATCH' | 'GET',
  url: string,
  headers: Record<string, string>,
  payload?: unknown,
): Promise<InjectionResult<T>> {
  const response = await app.inject({
    method,
    url,
    headers,
    ...(payload === undefined ? {} : { payload }),
  });

  let data: unknown = null;
  try {
    const parsed = response.json<{ data?: unknown }>();
    data = parsed.data ?? parsed;
  } catch {
    data = null;
  }

  return { status: response.statusCode, data: data as T, body: response.body };
}

export interface PlanFixture {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly monthlyFeeCentavos: number;
  readonly serviceTypeCode: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly status: string;
  readonly isCurrent: boolean;
}

export async function createPlan(
  app: FastifyInstance,
  headers: Record<string, string>,
  input: {
    readonly code: string;
    readonly serviceTypeCode: string;
    readonly name: string;
    readonly monthlyFeeCentavos: number;
    readonly effectiveFrom?: string;
    readonly speedMbps?: number | null;
    readonly channelCount?: number | null;
    readonly installationFeeCentavos?: number;
    readonly reconnectionFeeCentavos?: number;
  },
): Promise<PlanFixture> {
  const result = await inject<PlanFixture>(app, 'POST', '/plans', headers, {
    code: input.code,
    serviceTypeCode: input.serviceTypeCode,
    name: input.name,
    monthlyFeeCentavos: input.monthlyFeeCentavos,
    effectiveFrom: input.effectiveFrom ?? '2026-01-01',
    ...(input.speedMbps === undefined ? {} : { speedMbps: input.speedMbps }),
    ...(input.channelCount === undefined ? {} : { channelCount: input.channelCount }),
    ...(input.installationFeeCentavos === undefined
      ? {}
      : { installationFeeCentavos: input.installationFeeCentavos }),
    ...(input.reconnectionFeeCentavos === undefined
      ? {}
      : { reconnectionFeeCentavos: input.reconnectionFeeCentavos }),
  });

  if (result.status !== 201) {
    throw new Error(`createPlan failed: HTTP ${String(result.status)} ${result.body}`);
  }
  return result.data;
}

export interface SubscriberFixture {
  readonly id: number;
  readonly accountNumber: string;
  readonly displayName: string;
  readonly status: string;
  readonly serviceCount: number;
  readonly addresses: readonly { id: number; addressType: string; line1: string }[];
  readonly contacts: readonly { id: number; contactType: string; value: string }[];
}

export async function createSubscriber(
  app: FastifyInstance,
  headers: Record<string, string>,
  input: {
    readonly displayName: string;
    readonly accountNumber?: string;
    readonly collectionAreaId?: number;
    readonly subscriberType?: string;
    readonly billingDay?: number;
    readonly dueDay?: number;
    readonly addresses?: readonly Record<string, unknown>[];
    readonly contacts?: readonly Record<string, unknown>[];
  },
): Promise<SubscriberFixture> {
  const result = await inject<SubscriberFixture>(app, 'POST', '/subscribers', headers, {
    displayName: input.displayName,
    ...(input.accountNumber === undefined ? {} : { accountNumber: input.accountNumber }),
    ...(input.collectionAreaId === undefined ? {} : { collectionAreaId: input.collectionAreaId }),
    ...(input.subscriberType === undefined ? {} : { subscriberType: input.subscriberType }),
    ...(input.billingDay === undefined ? {} : { billingDay: input.billingDay }),
    ...(input.dueDay === undefined ? {} : { dueDay: input.dueDay }),
    addresses: input.addresses ?? [],
    contacts: input.contacts ?? [],
  });

  if (result.status !== 201) {
    throw new Error(`createSubscriber failed: HTTP ${String(result.status)} ${result.body}`);
  }
  return result.data;
}

export interface ServiceAccountFixture {
  readonly id: number;
  readonly accountNumber: string;
  readonly status: string;
  readonly currentPlanPriceCentavos: number;
  readonly planCurrentPriceCentavos: number;
  readonly serviceTypeCode: string;
  readonly events: readonly {
    eventType: string;
    fromValue: string | null;
    toValue: string | null;
  }[];
}

export async function createServiceAccount(
  app: FastifyInstance,
  headers: Record<string, string>,
  input: {
    readonly subscriberId: number;
    readonly servicePlanId: number;
    readonly installationAddressId?: number | null;
    readonly status?: 'PENDING' | 'ACTIVE';
    readonly activationDate?: string;
  },
): Promise<ServiceAccountFixture> {
  const result = await inject<ServiceAccountFixture>(app, 'POST', '/service-accounts', headers, {
    subscriberId: input.subscriberId,
    servicePlanId: input.servicePlanId,
    ...(input.installationAddressId === undefined
      ? {}
      : { installationAddressId: input.installationAddressId }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.activationDate === undefined ? {} : { activationDate: input.activationDate }),
  });

  if (result.status !== 201) {
    throw new Error(`createServiceAccount failed: HTTP ${String(result.status)} ${result.body}`);
  }
  return result.data;
}

/** A one-line SERVICE address, the shape most fixtures need. */
export function serviceAddress(line1: string, barangay = 'Poblacion'): Record<string, unknown> {
  return {
    addressType: 'SERVICE',
    line1,
    barangay,
    cityMunicipality: 'Malaybalay',
    province: 'Bukidnon',
    isPrimary: true,
  };
}

export function mobileContact(value: string): Record<string, unknown> {
  return { contactType: 'MOBILE', value, isPrimary: true };
}

export { inject };
