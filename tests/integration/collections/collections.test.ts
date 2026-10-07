import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../../apps/api/src/app';
import { TEST_PASSWORD, createTestUser, loginAs, seedAccess } from '../helpers/auth';
import {
  createPlan,
  createServiceAccount,
  createSubscriber,
  seedCollectionArea,
  seedServiceTypes,
  serviceAddress,
} from '../helpers/catalog';
import { createTestDatabase, type TestDatabase } from '../helpers/database';

const ADMIN = 'collection.admin';
const SUPERVISOR = 'collection.supervisor';
const CASHIER = 'collection.cashier';

let testDatabase: TestDatabase;
let app: FastifyInstance;
let admin: Record<string, string>;
let supervisor: Record<string, string>;
let cashier: Record<string, string>;

beforeAll(async () => {
  testDatabase = await createTestDatabase();
  await seedAccess(testDatabase.pool);
  await seedServiceTypes(testDatabase.pool);
  await createTestUser(testDatabase.pool, { username: ADMIN, roleCode: 'OWNER' });
  await createTestUser(testDatabase.pool, {
    username: SUPERVISOR,
    roleCode: 'COLLECTION_SUPERVISOR',
  });
  await createTestUser(testDatabase.pool, { username: CASHIER, roleCode: 'CASHIER' });

  app = await buildApp({ logger: false });
  await app.ready();

  admin = await loginAs(app, ADMIN, TEST_PASSWORD);
  supervisor = await loginAs(app, SUPERVISOR, TEST_PASSWORD);
  cashier = await loginAs(app, CASHIER, TEST_PASSWORD);
});

afterAll(async () => {
  await app.close();
  await testDatabase.close();
});

describe('Phase 6 collections', () => {
  it('creates a batch, prints a route sheet, and records a balanced remittance', async () => {
    const areaId = await seedCollectionArea(testDatabase.pool, 'R1', 'Route 1');
    const plan = await createPlan(app, admin, {
      code: 'COL-BATCH-PLAN',
      serviceTypeCode: 'INTERNET',
      name: 'Collection Batch Plan',
      monthlyFeeCentavos: 1_500_00,
      effectiveFrom: '2026-01-01',
    });

    const subscriber1 = await createSubscriber(app, admin, {
      displayName: 'Batch Customer One',
      collectionAreaId: areaId,
      addresses: [serviceAddress('10 Main Street', 'Poblacion')],
    });
    const subscriber2 = await createSubscriber(app, admin, {
      displayName: 'Batch Customer Two',
      collectionAreaId: areaId,
      addresses: [serviceAddress('20 Main Street', 'Poblacion')],
    });

    const account1 = await createServiceAccount(app, admin, {
      subscriberId: subscriber1.id,
      servicePlanId: plan.id,
      activationDate: '2026-02-01',
    });
    const account2 = await createServiceAccount(app, admin, {
      subscriberId: subscriber2.id,
      servicePlanId: plan.id,
      activationDate: '2026-02-01',
    });

    const batchResponse = await app.inject({
      method: 'POST',
      url: '/collection-batches',
      headers: supervisor,
      payload: {
        collectorUserId: Number(
          Object.values(
            (await app.inject({ method: 'GET', url: '/collectors', headers: supervisor })).json()
              .data ?? [],
          )[0]?.id ?? 1,
        ),
        collectionAreaId: areaId,
        batchDate: '2026-09-21',
        serviceAccountIds: [account1.id, account2.id],
        expectedReceivableCentavos: 20_000,
      },
    });

    expect(batchResponse.statusCode).toBe(201);
    const batch = batchResponse.json<{
      data: {
        id: number;
        status: string;
        expectedReceivableCentavos: number;
        varianceCentavos?: number;
      };
    }>().data;
    expect(batch.status).toBe('OPEN');
    expect(batch.expectedReceivableCentavos).toBe(20_000);

    const invalidRemitResponse = await app.inject({
      method: 'POST',
      url: `/collection-batches/${String(batch.id)}/remit`,
      headers: supervisor,
      payload: { remittedCashCentavos: 20_000, receivedByUserId: 1 },
    });
    expect(invalidRemitResponse.statusCode).toBe(409);

    const startResponse = await app.inject({
      method: 'PATCH',
      url: `/collection-batches/${String(batch.id)}/start`,
      headers: supervisor,
    });
    expect(startResponse.statusCode).toBe(200);

    const submitResponse = await app.inject({
      method: 'PATCH',
      url: `/collection-batches/${String(batch.id)}/submit`,
      headers: supervisor,
      payload: {
        cashCollectedCentavos: 20_000,
        nonCashCollectedCentavos: 0,
        uncollectedCentavos: 0,
      },
    });
    expect(submitResponse.statusCode).toBe(200);
    expect(
      submitResponse.json<{ data: { status: string; totalCollectedCentavos: number } }>().data,
    ).toMatchObject({
      status: 'SUBMITTED',
      totalCollectedCentavos: 20_000,
    });

    const routeSheet = await app.inject({
      method: 'GET',
      url: `/collection-batches/${String(batch.id)}/route-sheet`,
      headers: supervisor,
    });

    expect(routeSheet.statusCode).toBe(200);
    const routeData = routeSheet.json<{
      data: {
        entries: Array<{
          accountNumber: string;
          subscriber: string;
          collector: string;
          totalDueCentavos: number;
        }>;
      };
    }>().data;
    expect(routeData.entries.length).toBe(2);
    expect(routeData.entries[0]?.collector).toBeTruthy();
    expect(routeData.entries[0]?.totalDueCentavos).toBeGreaterThan(0);

    const remitResponse = await app.inject({
      method: 'POST',
      url: `/collection-batches/${String(batch.id)}/remit`,
      headers: supervisor,
      payload: {
        remittedCashCentavos: 20_000,
        receivedByUserId: Number(
          Object.values(
            (await app.inject({ method: 'GET', url: '/collectors', headers: supervisor })).json()
              .data ?? [],
          )[0]?.id ?? 1,
        ),
      },
    });

    expect(remitResponse.statusCode).toBe(200);
    const remittance = remitResponse.json<{
      data: { varianceCentavos: number; varianceType: string };
    }>().data;
    expect(remittance.varianceCentavos).toBe(0);
    expect(remittance.varianceType).toBe('BALANCED');

    const reconcileResponse = await app.inject({
      method: 'POST',
      url: `/collection-batches/${String(batch.id)}/reconcile`,
      headers: admin,
      payload: {
        expectedCashCentavos: 20_000,
        actualCashCentavos: 20_000,
        reason: 'Collector remitted the expected cash.',
      },
    });

    expect(reconcileResponse.statusCode).toBe(200);
    const reconciled = reconcileResponse.json<{
      data: { differenceCentavos: number; status: string };
    }>().data;
    expect(reconciled.differenceCentavos).toBe(0);
    expect(reconciled.status).toBe('RECONCILED');

    const reconciliationView = await app.inject({
      method: 'GET',
      url: `/collection-batches/${String(batch.id)}/reconciliation`,
      headers: supervisor,
    });
    expect(reconciliationView.statusCode).toBe(200);
    expect(
      reconciliationView.json<{ data: { batchStatus: string; actualCashCentavos: number } }>().data,
    ).toMatchObject({
      batchStatus: 'RECONCILED',
      actualCashCentavos: 20_000,
    });

    const closeResponse = await app.inject({
      method: 'PATCH',
      url: `/collection-batches/${String(batch.id)}/close`,
      headers: supervisor,
      payload: {},
    });
    expect(closeResponse.statusCode).toBe(200);
    expect(closeResponse.json<{ data: { status: string } }>().data.status).toBe('CLOSED');
  });

  it('rejects a shortage remittance and requires an approver before closure', async () => {
    const areaId = await seedCollectionArea(testDatabase.pool, 'R2', 'Route 2');
    const plan = await createPlan(app, admin, {
      code: 'COL-SHORT-PLAN',
      serviceTypeCode: 'INTERNET',
      name: 'Shortage Plan',
      monthlyFeeCentavos: 1_000_00,
      effectiveFrom: '2026-01-01',
    });

    const subscriber = await createSubscriber(app, admin, {
      displayName: 'Shortage Customer',
      collectionAreaId: areaId,
      addresses: [serviceAddress('30 Main Street', 'Poblacion')],
    });
    const account = await createServiceAccount(app, admin, {
      subscriberId: subscriber.id,
      servicePlanId: plan.id,
      activationDate: '2026-02-01',
    });

    const batchResponse = await app.inject({
      method: 'POST',
      url: '/collection-batches',
      headers: supervisor,
      payload: {
        collectorUserId: 1,
        collectionAreaId: areaId,
        batchDate: '2026-09-22',
        serviceAccountIds: [account.id],
        expectedReceivableCentavos: 20_000,
      },
    });
    expect(batchResponse.statusCode).toBe(201);
    const batchId = batchResponse.json<{ data: { id: number } }>().data.id;

    const invalidReconcileResponse = await app.inject({
      method: 'POST',
      url: `/collection-batches/${String(batchId)}/reconcile`,
      headers: admin,
      payload: { expectedCashCentavos: 20_000, actualCashCentavos: 20_000 },
    });
    expect(invalidReconcileResponse.statusCode).toBe(409);

    const submitResponse = await app.inject({
      method: 'PATCH',
      url: `/collection-batches/${String(batchId)}/submit`,
      headers: supervisor,
      payload: {
        cashCollectedCentavos: 20_000,
        nonCashCollectedCentavos: 0,
        uncollectedCentavos: 0,
      },
    });
    expect(submitResponse.statusCode).toBe(200);

    const remitResponse = await app.inject({
      method: 'POST',
      url: `/collection-batches/${String(batchId)}/remit`,
      headers: supervisor,
      payload: {
        remittedCashCentavos: 19_500,
        receivedByUserId: 1,
      },
    });

    expect(remitResponse.statusCode).toBe(200);
    const remittance = remitResponse.json<{
      data: { varianceCentavos: number; varianceType: string };
    }>().data;
    expect(remittance.varianceCentavos).toBe(-500);
    expect(remittance.varianceType).toBe('SHORTAGE');

    const duplicateRemitResponse = await app.inject({
      method: 'POST',
      url: `/collection-batches/${String(batchId)}/remit`,
      headers: supervisor,
      payload: { remittedCashCentavos: 19_500, receivedByUserId: 1 },
    });
    expect(duplicateRemitResponse.statusCode).toBe(409);

    const closeResponse = await app.inject({
      method: 'PATCH',
      url: `/collection-batches/${String(batchId)}/close`,
      headers: supervisor,
      payload: {
        reason: 'Closing while the remittance is short.',
      },
    });

    expect(closeResponse.statusCode).toBe(409);
    expect(closeResponse.json<{ error: { message: string } }>().error.message).toContain(
      'reconciled',
    );

    const unauthorizedReconcile = await app.inject({
      method: 'POST',
      url: `/collection-batches/${String(batchId)}/reconcile`,
      headers: cashier,
      payload: {
        expectedCashCentavos: 20_000,
        actualCashCentavos: 19_500,
        reason: 'Not authorized.',
      },
    });

    expect(unauthorizedReconcile.statusCode).toBe(403);

    const reconcileResponse = await app.inject({
      method: 'POST',
      url: `/collection-batches/${String(batchId)}/reconcile`,
      headers: admin,
      payload: {
        expectedCashCentavos: 20_000,
        actualCashCentavos: 19_500,
        reason: 'Shortage reviewed and approved by the supervisor.',
      },
    });
    expect(reconcileResponse.statusCode).toBe(200);

    // A shortage is not balanced away silently: the variance has to be
    // approved by someone holding `collection.variance.approve` first.
    const closeBeforeApproval = await app.inject({
      method: 'PATCH',
      url: `/collection-batches/${String(batchId)}/close`,
      headers: supervisor,
      payload: { reason: 'Closing after authorized reconciliation.' },
    });
    expect(closeBeforeApproval.statusCode).toBe(409);
    expect(closeBeforeApproval.json<{ error: { message: string } }>().error.message).toContain(
      'variance',
    );

    const cashierApproval = await app.inject({
      method: 'POST',
      url: `/collection-batches/${String(batchId)}/approve-variance`,
      headers: cashier,
      payload: { resolutionNotes: 'A cashier may not approve a collector variance.' },
    });
    expect(cashierApproval.statusCode).toBe(403);

    const approveResponse = await app.inject({
      method: 'POST',
      url: `/collection-batches/${String(batchId)}/approve-variance`,
      headers: supervisor,
      payload: {
        resolutionNotes: 'Shortage reviewed and approved by the collection supervisor.',
      },
    });
    expect(approveResponse.statusCode).toBe(200);

    const closeAfterReconcile = await app.inject({
      method: 'PATCH',
      url: `/collection-batches/${String(batchId)}/close`,
      headers: supervisor,
      payload: { reason: 'Closing after authorized reconciliation.' },
    });
    expect(closeAfterReconcile.statusCode).toBe(200);
  });

  it('serves the batch list, detail, assignments, and remittance read models', async () => {
    const areaId = await seedCollectionArea(testDatabase.pool, 'R3', 'Route 3');
    const plan = await createPlan(app, admin, {
      code: 'COL-READ-PLAN',
      serviceTypeCode: 'INTERNET',
      name: 'Read Model Plan',
      monthlyFeeCentavos: 1_200_00,
      effectiveFrom: '2026-01-01',
    });

    const subscriber = await createSubscriber(app, admin, {
      displayName: 'Read Model Customer',
      collectionAreaId: areaId,
      addresses: [serviceAddress('40 Main Street', 'Poblacion')],
    });
    const account = await createServiceAccount(app, admin, {
      subscriberId: subscriber.id,
      servicePlanId: plan.id,
      activationDate: '2026-02-01',
    });

    const collectorId = Number(
      Object.values(
        (await app.inject({ method: 'GET', url: '/collectors', headers: supervisor })).json()
          .data ?? [],
      )[0]?.id ?? 1,
    );

    const batchResponse = await app.inject({
      method: 'POST',
      url: '/collection-batches',
      headers: supervisor,
      payload: {
        collectorUserId: collectorId,
        collectionAreaId: areaId,
        batchDate: '2026-09-23',
        serviceAccountIds: [account.id],
        expectedReceivableCentavos: 12_000,
      },
    });
    expect(batchResponse.statusCode).toBe(201);
    const batchId = batchResponse.json<{ data: { id: number } }>().data.id;

    const listResponse = await app.inject({
      method: 'GET',
      url: '/collection-batches?pageSize=100',
      headers: supervisor,
    });
    expect(listResponse.statusCode).toBe(200);
    const batches = listResponse.json<{ data: { id: number; collectorName: string }[] }>().data;
    expect(batches.some((batch) => batch.id === batchId)).toBe(true);

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/collection-batches/${String(batchId)}`,
      headers: supervisor,
    });
    expect(detailResponse.statusCode).toBe(200);
    const detail = detailResponse.json<{
      data: { accounts: { accountNumber: string }[]; areaName: string };
    }>().data;
    expect(detail.accounts).toHaveLength(1);
    expect(detail.accounts[0]?.accountNumber).toBe(account.accountNumber);
    expect(detail.areaName).toBe('Route 3');

    const assignmentsResponse = await app.inject({
      method: 'GET',
      url: '/collection-assignments',
      headers: supervisor,
    });
    expect(assignmentsResponse.statusCode).toBe(200);

    const remittancesResponse = await app.inject({
      method: 'GET',
      url: '/collection-remittances',
      headers: supervisor,
    });
    expect(remittancesResponse.statusCode).toBe(200);
  });
});
