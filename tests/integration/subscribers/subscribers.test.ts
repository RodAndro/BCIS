import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../../apps/api/src/app';
import { TEST_PASSWORD, createTestUser, loginAs, seedAccess } from '../helpers/auth';
import {
  createPlan,
  createServiceAccount,
  createSubscriber,
  mobileContact,
  seedCollectionArea,
  seedServiceTypes,
  serviceAddress,
} from '../helpers/catalog';
import { createTestDatabase, type TestDatabase } from '../helpers/database';

/**
 * Subscribers.
 *
 * The properties under test are the ones the specification calls out: a unique
 * account number, one subscriber with several services and several addresses,
 * an inactive subscriber, and the guard that keeps an archived customer from
 * having live service.
 */

const ADMIN = 'sub.admin';
const CASHIER = 'sub.cashier';
const TECHNICIAN = 'sub.technician';

let testDatabase: TestDatabase;
let app: FastifyInstance;
let admin: Record<string, string>;
let cashier: Record<string, string>;
let technician: Record<string, string>;
let areaId: number;

beforeAll(async () => {
  testDatabase = await createTestDatabase();
  await seedAccess(testDatabase.pool);
  await seedServiceTypes(testDatabase.pool);
  areaId = await seedCollectionArea(testDatabase.pool, 'TA-AREA', 'Test Area');

  await createTestUser(testDatabase.pool, { username: ADMIN, roleCode: 'OWNER' });
  await createTestUser(testDatabase.pool, { username: CASHIER, roleCode: 'CASHIER' });
  await createTestUser(testDatabase.pool, { username: TECHNICIAN, roleCode: 'TECHNICIAN' });

  app = await buildApp({ logger: false });
  await app.ready();

  admin = await loginAs(app, ADMIN, TEST_PASSWORD);
  cashier = await loginAs(app, CASHIER, TEST_PASSWORD);
  technician = await loginAs(app, TECHNICIAN, TEST_PASSWORD);
});

afterAll(async () => {
  await app.close();
  await testDatabase.close();
});

describe('registration', () => {
  it('registers a subscriber with several addresses and contacts', async () => {
    const subscriber = await createSubscriber(app, admin, {
      displayName: 'Multi Address Customer',
      collectionAreaId: areaId,
      addresses: [
        serviceAddress('101 Rizal Street', 'Poblacion'),
        { addressType: 'BILLING', line1: 'P.O. Box 12', barangay: 'Poblacion', isPrimary: true },
      ],
      contacts: [mobileContact('09171234567')],
    });

    expect(subscriber.accountNumber).toMatch(/^SUB-\d{6}$/);
    expect(subscriber.addresses).toHaveLength(2);
    expect(subscriber.contacts).toHaveLength(1);

    // A lone MOBILE contact is promoted to primary, so the list column is not
    // blank for a customer who plainly has a number.
    expect(subscriber.contacts[0]?.value).toBe('09171234567');

    const detail = await app.inject({
      method: 'GET',
      url: `/subscribers/${String(subscriber.id)}`,
      headers: admin,
    });
    expect(detail.statusCode).toBe(200);
  });

  it('allocates a different number to every subscriber', async () => {
    const first = await createSubscriber(app, admin, { displayName: 'Numbering One' });
    const second = await createSubscriber(app, admin, { displayName: 'Numbering Two' });

    expect(first.accountNumber).not.toBe(second.accountNumber);
  });

  it('accepts an account number when migrating an existing subscriber, but not twice', async () => {
    await createSubscriber(app, admin, {
      displayName: 'Migrated Customer',
      accountNumber: 'LEGACY-0001',
    });

    const duplicate = await app.inject({
      method: 'POST',
      url: '/subscribers',
      headers: admin,
      payload: { displayName: 'Another Migrated Customer', accountNumber: 'LEGACY-0001' },
    });

    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json<{ error: { message: string } }>().error.message).toMatch(
      /already in use/i,
    );
  });

  it('is refused by the database even if a duplicate reaches it', async () => {
    // The service-layer check can be raced; the unique index cannot. This
    // asserts the index exists rather than trusting the check above.
    await expect(
      testDatabase.pool.query(
        `INSERT INTO subscribers (account_number, display_name) VALUES ('LEGACY-0001', 'Sneaky')`,
      ),
    ).rejects.toThrow();
  });

  it('requires the display name', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/subscribers',
      headers: admin,
      payload: { displayName: '' },
    });

    expect(response.statusCode).toBe(422);
  });

  it('rejects a mobile number that is not a Philippine mobile', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/subscribers',
      headers: admin,
      payload: {
        displayName: 'Bad Mobile',
        contacts: [{ contactType: 'MOBILE', value: '12345' }],
      },
    });

    expect(response.statusCode).toBe(422);
  });

  it('rejects two primaries of the same address type', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/subscribers',
      headers: admin,
      payload: {
        displayName: 'Two Primaries',
        addresses: [
          { addressType: 'SERVICE', line1: 'One', isPrimary: true },
          { addressType: 'SERVICE', line1: 'Two', isPrimary: true },
        ],
      },
    });

    expect(response.statusCode).toBe(422);
  });

  it('rejects a collection area that does not exist', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/subscribers',
      headers: admin,
      payload: { displayName: 'Bad Area', collectionAreaId: 999_999 },
    });

    expect(response.statusCode).toBe(422);
  });
});

describe('one subscriber, several services', () => {
  it('reports every service account and how many are active', async () => {
    const subscriber = await createSubscriber(app, admin, {
      displayName: 'Two Services Customer',
      addresses: [serviceAddress('55 Bonifacio Street')],
    });

    const internet = await createPlan(app, admin, {
      code: 'SUB-INT',
      serviceTypeCode: 'INTERNET',
      name: 'Subscriber Internet',
      monthlyFeeCentavos: 99_900,
      effectiveFrom: '2026-01-01',
    });
    const cable = await createPlan(app, admin, {
      code: 'SUB-CAB',
      serviceTypeCode: 'CABLE',
      name: 'Subscriber Cable',
      monthlyFeeCentavos: 55_000,
      channelCount: 100,
      effectiveFrom: '2026-01-01',
    });

    const first = await createServiceAccount(app, admin, {
      subscriberId: subscriber.id,
      servicePlanId: internet.id,
      activationDate: '2026-02-01',
    });
    const second = await createServiceAccount(app, admin, {
      subscriberId: subscriber.id,
      servicePlanId: cable.id,
      activationDate: '2026-02-01',
    });

    // Two accounts, two service types, two numbers.
    expect(first.accountNumber).not.toBe(second.accountNumber);
    expect(first.serviceTypeCode).toBe('INTERNET');
    expect(second.serviceTypeCode).toBe('CABLE');

    const list = await app.inject({
      method: 'GET',
      url: `/service-accounts?subscriberId=${String(subscriber.id)}`,
      headers: admin,
    });
    const page = list.json<{ data: unknown[]; meta: { total: number } }>();

    expect(page.meta.total).toBe(2);

    const detail = await app.inject({
      method: 'GET',
      url: `/subscribers/${String(subscriber.id)}`,
      headers: admin,
    });
    const summary = detail.json<{
      data: { serviceCount: number; activeServiceCount: number };
    }>().data;

    expect(summary.serviceCount).toBe(2);
    expect(summary.activeServiceCount).toBe(2);
  });
});

describe('status lifecycle', () => {
  it('allows INACTIVE without touching the service accounts', async () => {
    const subscriber = await createSubscriber(app, admin, { displayName: 'Inactive Customer' });

    const response = await app.inject({
      method: 'PATCH',
      url: `/subscribers/${String(subscriber.id)}/status`,
      headers: admin,
      payload: { status: 'INACTIVE', reason: 'Customer asked to pause the account.' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: { status: string } }>().data.status).toBe('INACTIVE');
  });

  it('refuses to archive a subscriber that still has live service', async () => {
    const subscriber = await createSubscriber(app, admin, {
      displayName: 'Archive Guard Customer',
      addresses: [serviceAddress('3 Serna Street')],
    });

    const plan = await createPlan(app, admin, {
      code: 'SUB-ARCHIVE',
      serviceTypeCode: 'INTERNET',
      name: 'Archive Guard Plan',
      monthlyFeeCentavos: 99_900,
      effectiveFrom: '2026-01-01',
    });

    const account = await createServiceAccount(app, admin, {
      subscriberId: subscriber.id,
      servicePlanId: plan.id,
      activationDate: '2026-02-01',
    });

    const refused = await app.inject({
      method: 'PATCH',
      url: `/subscribers/${String(subscriber.id)}/status`,
      headers: admin,
      payload: { status: 'ARCHIVED', reason: 'Closing the customer record.' },
    });

    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ error: { message: string } }>().error.message).toMatch(/active service/i);

    // Disconnect the service, and the archive is allowed.
    const disconnected = await app.inject({
      method: 'PATCH',
      url: `/service-accounts/${String(account.id)}/status`,
      headers: admin,
      payload: {
        status: 'DISCONNECTED',
        effectiveDate: '2026-03-01',
        reason: 'Customer requested disconnection.',
      },
    });
    expect(disconnected.statusCode).toBe(200);

    const archived = await app.inject({
      method: 'PATCH',
      url: `/subscribers/${String(subscriber.id)}/status`,
      headers: admin,
      payload: { status: 'ARCHIVED', reason: 'Closing the customer record.' },
    });

    expect(archived.statusCode).toBe(200);

    const body = archived.json<{ data: { status: string; archivedAt: string | null } }>().data;
    expect(body.status).toBe('ARCHIVED');
    // Archiving records WHEN, so a later report can say when the record closed.
    expect(body.archivedAt).not.toBeNull();
  });

  it('requires a reason for anything other than ACTIVE', async () => {
    const subscriber = await createSubscriber(app, admin, { displayName: 'No Reason Customer' });

    const response = await app.inject({
      method: 'PATCH',
      url: `/subscribers/${String(subscriber.id)}/status`,
      headers: admin,
      payload: { status: 'INACTIVE' },
    });

    expect(response.statusCode).toBe(422);
  });
});

describe('addresses', () => {
  it('refuses to remove an address a service account is installed at', async () => {
    const subscriber = await createSubscriber(app, admin, {
      displayName: 'Address Guard Customer',
      addresses: [serviceAddress('88 Sayre Highway')],
    });

    const plan = await createPlan(app, admin, {
      code: 'SUB-ADDR',
      serviceTypeCode: 'INTERNET',
      name: 'Address Guard Plan',
      monthlyFeeCentavos: 99_900,
      effectiveFrom: '2026-01-01',
    });

    await createServiceAccount(app, admin, {
      subscriberId: subscriber.id,
      servicePlanId: plan.id,
      installationAddressId: subscriber.addresses[0]?.id ?? null,
      activationDate: '2026-02-01',
    });

    // Replacing the set with a DIFFERENT address would drop the one in use.
    const response = await app.inject({
      method: 'PUT',
      url: `/subscribers/${String(subscriber.id)}/addresses`,
      headers: admin,
      payload: { addresses: [serviceAddress('99 Different Street')] },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { message: string } }>().error.message).toMatch(
      /installation address/i,
    );
  });

  it('updates an address in place when its id is sent back', async () => {
    const subscriber = await createSubscriber(app, admin, {
      displayName: 'Address Update Customer',
      addresses: [serviceAddress('1 Old Street')],
    });

    const addressId = subscriber.addresses[0]?.id;
    expect(addressId).toBeDefined();

    const response = await app.inject({
      method: 'PUT',
      url: `/subscribers/${String(subscriber.id)}/addresses`,
      headers: admin,
      payload: {
        addresses: [
          {
            id: addressId,
            addressType: 'SERVICE',
            line1: '1 New Street',
            barangay: 'Poblacion',
            isPrimary: true,
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json<{ data: { addresses: { id: number; line1: string }[] } }>().data;
    // Same row, changed text — not a delete and a reinsert.
    expect(body.addresses).toHaveLength(1);
    expect(body.addresses[0]?.id).toBe(addressId);
    expect(body.addresses[0]?.line1).toBe('1 New Street');
  });
});

describe('authorization', () => {
  it('lets a Cashier read the subscriber list', async () => {
    const response = await app.inject({ method: 'GET', url: '/subscribers', headers: cashier });
    expect(response.statusCode).toBe(200);
  });

  it('lets a Technician read subscribers', async () => {
    const response = await app.inject({ method: 'GET', url: '/subscribers', headers: technician });
    expect(response.statusCode).toBe(200);
  });

  it('refuses a Cashier registering a subscriber', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/subscribers',
      headers: cashier,
      payload: { displayName: 'Cashier Attempt' },
    });

    expect(response.statusCode).toBe(403);
  });

  it('refuses a Technician registering a subscriber', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/subscribers',
      headers: technician,
      payload: { displayName: 'Technician Attempt' },
    });

    expect(response.statusCode).toBe(403);
  });

  it('refuses an unauthenticated request', async () => {
    expect((await app.inject({ method: 'GET', url: '/subscribers' })).statusCode).toBe(401);
  });
});
