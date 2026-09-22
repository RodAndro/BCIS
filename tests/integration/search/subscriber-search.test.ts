import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../../apps/api/src/app';
import { TEST_PASSWORD, createTestUser, loginAs, seedAccess } from '../helpers/auth';
import {
  createSubscriber,
  mobileContact,
  seedServiceTypes,
  serviceAddress,
} from '../helpers/catalog';
import { createTestDatabase, type TestDatabase } from '../helpers/database';

/**
 * Subscriber search.
 *
 * ── WHY THIS FILE EXISTS SEPARATELY ─────────────────────────────────────────
 * Search is the one part of Phase 3 designed to grow: Phase 4 adds invoice
 * numbers and Phase 5 adds receipt numbers and GCash references to the same
 * endpoint. These tests pin the CONTRACT — one query term matches across every
 * registered provider, results are paginated server-side, and the provider list
 * is served rather than hardcoded in the UI — so a later phase can add a
 * provider without changing any of it.
 */

const ADMIN = 'search.admin';
const CASHIER = 'search.cashier';

let testDatabase: TestDatabase;
let app: FastifyInstance;
let admin: Record<string, string>;
let cashier: Record<string, string>;

beforeAll(async () => {
  testDatabase = await createTestDatabase();
  await seedAccess(testDatabase.pool);
  await seedServiceTypes(testDatabase.pool);
  await createTestUser(testDatabase.pool, { username: ADMIN, roleCode: 'OWNER' });
  await createTestUser(testDatabase.pool, { username: CASHIER, roleCode: 'CASHIER' });

  app = await buildApp({ logger: false });
  await app.ready();
  admin = await loginAs(app, ADMIN, TEST_PASSWORD);
  cashier = await loginAs(app, CASHIER, TEST_PASSWORD);

  // Deliberately distinctive values so each provider can be exercised
  // independently of the others.
  await createSubscriber(app, admin, {
    displayName: 'Zara Zzyzx',
    accountNumber: 'SEARCH-ALPHA',
    addresses: [serviceAddress('12 Quixotic Street', 'Searchville')],
    contacts: [mobileContact('09171112222')],
  });

  await createSubscriber(app, admin, {
    displayName: 'Bruno Beta',
    accountNumber: 'SEARCH-BETA',
    addresses: [serviceAddress('34 Ordinary Street', 'Poblacion')],
    contacts: [mobileContact('09173334444')],
  });
});

afterAll(async () => {
  await app.close();
  await testDatabase.close();
});

interface SearchBody {
  readonly data: readonly { id: number; accountNumber: string; displayName: string }[];
  readonly meta: { total: number };
}

describe('the provider registry', () => {
  it('reports what the search box searches', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/search/providers',
      headers: admin,
    });

    expect(response.statusCode).toBe(200);

    const providers = response.json<{ data: { key: string; label: string }[] }>().data;
    const keys = providers.map((provider) => provider.key);

    // Phase 3 registered the first four. Phase 4 added `invoice-number` through
    // the same registry — the endpoint, the query, and the UI did not change,
    // which is exactly what the design was for.
    expect(keys).toEqual(['account-number', 'name', 'contact', 'address', 'invoice-number']);
    expect(providers.every((provider) => provider.label.length > 0)).toBe(true);
  });
});

describe('matching across providers', () => {
  it('finds a subscriber by a partial account number', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/search/subscribers?q=ALPHA',
      headers: admin,
    });

    const body = response.json<{ data: { accountNumber: string }[] }>();
    expect(body.data.map((row) => row.accountNumber)).toContain('SEARCH-ALPHA');
  });

  it('finds a subscriber by a partial name, case-insensitively', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/search/subscribers?q=zzyzx',
      headers: admin,
    });

    const body = response.json<{ data: { displayName: string }[] }>();
    expect(body.data.some((row) => row.displayName === 'Zara Zzyzx')).toBe(true);
  });

  it('finds a subscriber by a partial mobile number', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/search/subscribers?q=0917111',
      headers: admin,
    });

    const body = response.json<{ data: { displayName: string }[] }>();
    expect(body.data.some((row) => row.displayName === 'Zara Zzyzx')).toBe(true);
  });

  it('finds a subscriber by a partial street', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/search/subscribers?q=Quixotic',
      headers: admin,
    });

    const body = response.json<{ data: { displayName: string }[] }>();
    expect(body.data.some((row) => row.displayName === 'Zara Zzyzx')).toBe(true);
  });

  it('finds a subscriber by barangay', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/search/subscribers?q=Searchville',
      headers: admin,
    });

    const body = response.json<{ data: { displayName: string }[] }>();
    expect(body.data.some((row) => row.displayName === 'Zara Zzyzx')).toBe(true);
  });

  it('returns nothing for a term that matches nothing', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/search/subscribers?q=nothing-matches-this-term',
      headers: admin,
    });

    expect(response.json<{ data: unknown[] }>().data).toHaveLength(0);
  });
});

describe('the subscriber list uses the same registry', () => {
  it('filters by a contact number', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/subscribers?search=09173334444',
      headers: admin,
    });

    const body = response.json<SearchBody>();
    expect(body.meta.total).toBe(1);
    expect(body.data[0]?.displayName).toBe('Bruno Beta');
  });

  it('paginates server-side rather than returning everything', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/subscribers?search=SEARCH-&pageSize=1&page=1',
      headers: admin,
    });

    const body = response.json<SearchBody>();
    // Two match; the page carries one and the total says so, which is what
    // lets the UI render a pager without loading the table.
    expect(body.meta.total).toBe(2);
    expect(body.data).toHaveLength(1);
  });

  it('caps the page size', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/subscribers?pageSize=10000',
      headers: admin,
    });

    expect(response.statusCode).toBe(422);
  });
});

describe('wildcard safety', () => {
  it('does not treat a percent sign as "match everything"', async () => {
    // Unescaped, `%` is a LIKE wildcard and this would return the whole table.
    const response = await app.inject({
      method: 'GET',
      url: '/search/subscribers?q=%25',
      headers: admin,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: unknown[] }>().data).toHaveLength(0);
  });

  it('does not treat an underscore as a single-character wildcard', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/search/subscribers?q=SEARCH_ALPHA',
      headers: admin,
    });

    expect(response.json<{ data: unknown[] }>().data).toHaveLength(0);
  });

  it('rejects an empty term rather than returning the table', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/search/subscribers?q=',
      headers: admin,
    });

    expect(response.statusCode).toBe(422);
  });
});

describe('authorization', () => {
  it('lets a Cashier search, because serving a customer needs it', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/search/subscribers?q=ALPHA',
      headers: cashier,
    });

    expect(response.statusCode).toBe(200);
  });

  it('refuses an unauthenticated search', async () => {
    expect(
      (await app.inject({ method: 'GET', url: '/search/subscribers?q=ALPHA' })).statusCode,
    ).toBe(401);
  });
});
