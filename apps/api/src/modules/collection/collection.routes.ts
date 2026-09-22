import { PERMISSIONS } from '@bcis/shared';
import {
  batchReconciliationSchema,
  batchRemittanceSchema,
  closeCollectionBatchSchema,
  collectionAreaIdParamSchema,
  collectionBatchIdParamSchema,
  collectionBatchListQuerySchema,
  collectorAssignmentSchema,
  createCollectionAreaSchema,
  createCollectionBatchSchema,
  paginatedBody,
  submitCollectionBatchSchema,
  successBody,
  updateCollectionAreaSchema,
} from '@bcis/validation';
import type { FastifyPluginAsync } from 'fastify';

import { actorContextOf } from '../../shared/request-context';
import { parseInput } from '../../shared/validate';
import {
  closeBatch,
  createArea,
  createBatch,
  createCollectorAssignment,
  getArea,
  getBatch,
  getReconciliationView,
  getRouteSheet,
  listAreas,
  listAssignments,
  listBatches,
  listCollectors,
  listRemittances,
  recordRemittance,
  reconcileBatch,
  submitBatch,
  startBatch,
  updateArea,
} from './collection.service';

/**
 * Collection areas and the collector picker.
 *
 * Reads need `collection.view`, writes need `collection.create`. Phase 6
 * revisits these guards when routes and batches exist; the permissions already
 * model them, so nothing here has to change then.
 */
export const collectionRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/collection-batches',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.COLLECTION_VIEW } } },
    async (request, reply) => {
      const query = parseInput(collectionBatchListQuerySchema, request.query);
      const page = await listBatches(app.db, query);
      return reply.send(paginatedBody(page.batches, query.page, query.pageSize, page.total));
    },
  );

  app.get(
    '/collection-batches/:id',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.COLLECTION_VIEW } } },
    async (request, reply) => {
      const { id } = parseInput(collectionBatchIdParamSchema, request.params);
      return reply.send(successBody(await getBatch(app.db, id)));
    },
  );

  app.get(
    '/collection-remittances',
    {
      config: { auth: { authenticated: true, permission: PERMISSIONS.COLLECTION_REMITTANCE_VIEW } },
    },
    async (_request, reply) => {
      return reply.send(successBody(await listRemittances(app.db)));
    },
  );

  app.get(
    '/collection-assignments',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.COLLECTION_VIEW } } },
    async (_request, reply) => {
      return reply.send(successBody(await listAssignments(app.db)));
    },
  );

  app.get(
    '/collection-areas',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.COLLECTION_VIEW } } },
    async (_request, reply) => {
      return reply.send(successBody(await listAreas(app.db)));
    },
  );

  app.patch(
    '/collection-batches/:id/start',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.COLLECTION_SUBMIT } } },
    async (request, reply) => {
      const { id } = parseInput(collectionBatchIdParamSchema, request.params);
      return reply.send(successBody(await startBatch(app.db, id, actorContextOf(request))));
    },
  );

  app.patch(
    '/collection-batches/:id/submit',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.COLLECTION_SUBMIT } } },
    async (request, reply) => {
      const { id } = parseInput(collectionBatchIdParamSchema, request.params);
      const input = parseInput(submitCollectionBatchSchema, request.body);
      return reply.send(successBody(await submitBatch(app.db, id, input, actorContextOf(request))));
    },
  );

  app.get(
    '/collection-areas/:id',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.COLLECTION_VIEW } } },
    async (request, reply) => {
      const { id } = parseInput(collectionAreaIdParamSchema, request.params);
      return reply.send(successBody(await getArea(app.db, id)));
    },
  );

  app.post(
    '/collection-areas',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.COLLECTION_CREATE } } },
    async (request, reply) => {
      const input = parseInput(createCollectionAreaSchema, request.body);
      const created = await createArea(app.db, input, actorContextOf(request));

      return reply.code(201).send(successBody(created));
    },
  );

  app.put(
    '/collection-areas/:id',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.COLLECTION_CREATE } } },
    async (request, reply) => {
      const { id } = parseInput(collectionAreaIdParamSchema, request.params);
      const input = parseInput(updateCollectionAreaSchema, request.body);

      return reply.send(successBody(await updateArea(app.db, id, input, actorContextOf(request))));
    },
  );

  app.get(
    '/collectors',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.COLLECTION_VIEW } } },
    async (_request, reply) => {
      return reply.send(successBody(await listCollectors(app.db)));
    },
  );

  app.post(
    '/collection-areas/:id/assign-collector',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.COLLECTION_CREATE } } },
    async (request, reply) => {
      const { id } = parseInput(collectionAreaIdParamSchema, request.params);
      const body = parseInput(collectorAssignmentSchema, request.body);
      return reply.send(
        successBody(
          await createCollectorAssignment(
            app.db,
            id,
            body.collectorUserId,
            body.effectiveFrom,
            actorContextOf(request),
          ),
        ),
      );
    },
  );

  app.post(
    '/collection-batches',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.COLLECTION_CREATE } } },
    async (request, reply) => {
      const input = parseInput(createCollectionBatchSchema, request.body);
      return reply
        .code(201)
        .send(successBody(await createBatch(app.db, input, actorContextOf(request))));
    },
  );

  app.get(
    '/collection-batches/:id/route-sheet',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.COLLECTION_VIEW } } },
    async (request, reply) => {
      const { id } = parseInput(collectionBatchIdParamSchema, request.params);
      return reply.send(successBody(await getRouteSheet(app.db, id)));
    },
  );

  app.get(
    '/collection-batches/:id/route-sheet/print',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.COLLECTION_VIEW } } },
    async (request, reply) => {
      const { id } = parseInput(collectionBatchIdParamSchema, request.params);
      const routeSheet = await getRouteSheet(app.db, id);
      const rows = routeSheet.entries
        .map(
          (entry) => `<tr>
            <td>${escapeHtml(entry.accountNumber)}</td>
            <td>${escapeHtml(entry.subscriber)}</td>
            <td>${escapeHtml(entry.address)}</td>
            <td>${String(entry.currentBillCentavos)}</td>
            <td>${String(entry.arrearsCentavos)}</td>
            <td>${String(entry.totalDueCentavos)}</td>
            <td>${escapeHtml(entry.collector)}</td>
          </tr>`,
        )
        .join('');

      return reply.type('text/html').send(`<!doctype html>
        <html><head><meta charset="utf-8"><title>Collection Route Sheet</title>
        <style>body{font-family:system-ui,sans-serif;margin:2rem}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:.45rem;text-align:left}th{background:#eee}@media print{button{display:none}}</style>
        </head><body><button onclick="window.print()">Print</button>
        <h1>Collection Route Sheet</h1><table><thead><tr><th>Account</th><th>Subscriber</th><th>Address</th><th>Current bill</th><th>Arrears</th><th>Total due</th><th>Collector</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);
    },
  );

  app.get(
    '/collection-batches/:id/reconciliation',
    {
      config: { auth: { authenticated: true, permission: PERMISSIONS.COLLECTION_REMITTANCE_VIEW } },
    },
    async (request, reply) => {
      const { id } = parseInput(collectionBatchIdParamSchema, request.params);
      return reply.send(successBody(await getReconciliationView(app.db, id)));
    },
  );

  app.post(
    '/collection-batches/:id/remit',
    {
      config: {
        auth: { authenticated: true, permission: PERMISSIONS.COLLECTION_REMITTANCE_RECORD },
      },
    },
    async (request, reply) => {
      const { id } = parseInput(collectionBatchIdParamSchema, request.params);
      const input = parseInput(batchRemittanceSchema, request.body);
      return reply.send(
        successBody(await recordRemittance(app.db, id, input, actorContextOf(request))),
      );
    },
  );

  app.post(
    '/collection-batches/:id/reconcile',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.COLLECTION_RECONCILE } } },
    async (request, reply) => {
      const { id } = parseInput(collectionBatchIdParamSchema, request.params);
      const input = parseInput(batchReconciliationSchema, request.body);
      return reply.send(
        successBody(await reconcileBatch(app.db, id, input, actorContextOf(request))),
      );
    },
  );

  app.patch(
    '/collection-batches/:id/close',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.COLLECTION_RECONCILE } } },
    async (request, reply) => {
      const { id } = parseInput(collectionBatchIdParamSchema, request.params);
      const input = parseInput(closeCollectionBatchSchema, request.body ?? {});
      return reply.send(successBody(await closeBatch(app.db, id, input, actorContextOf(request))));
    },
  );
};

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
