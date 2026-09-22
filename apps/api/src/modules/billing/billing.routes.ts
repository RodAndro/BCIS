import { PERMISSIONS } from '@bcis/shared';
import {
  applyPenaltiesSchema,
  createAdjustmentSchema,
  finalizeInvoiceSchema,
  generateBillingSchema,
  invoiceIdParamSchema,
  invoiceListQuerySchema,
  paginatedBody,
  successBody,
  voidInvoiceSchema,
} from '@bcis/validation';
import type { FastifyPluginAsync } from 'fastify';

import { actorContextOf } from '../../shared/request-context';
import { parseInput } from '../../shared/validate';
import {
  generateBilling,
  getBillingDashboard,
  listBillingCycles,
  previewBilling,
} from './billing.service';
import {
  applyPenalties,
  finalizeInvoice,
  getInvoice,
  listInvoices,
  postAdjustment,
  voidInvoice,
} from './invoices.service';

/**
 * Billing endpoints.
 *
 * ── PERMISSIONS ─────────────────────────────────────────────────────────────
 * Reading needs `billing.view`: a Cashier must be able to look up what a
 * customer owes. Generating, finalizing, voiding and adjusting need
 * `billing.generate`, `billing.void` and `billing.adjust` — the three
 * operations that create or change a financial document.
 *
 * Note that the preview is deliberately NOT behind the generate permission: a
 * preview writes nothing, and requiring the permission to look would push
 * people towards pressing the button that bills.
 */
export const billingRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/billing/dashboard',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.BILLING_VIEW } } },
    async (_request, reply) => {
      return reply.send(successBody(await getBillingDashboard(app.db)));
    },
  );

  app.get(
    '/billing/cycles',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.BILLING_VIEW } } },
    async (_request, reply) => {
      return reply.send(successBody(await listBillingCycles(app.db)));
    },
  );

  app.get(
    '/billing/preview',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.BILLING_VIEW } } },
    async (request, reply) => {
      const input = parseInput(generateBillingSchema, {
        ...(request.query as object),
        dryRun: true,
      });
      return reply.send(successBody(await previewBilling(app.db, input)));
    },
  );

  app.post(
    '/billing/generate',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.BILLING_GENERATE } } },
    async (request, reply) => {
      const input = parseInput(generateBillingSchema, request.body);

      return reply.send(successBody(await generateBilling(app.db, input, actorContextOf(request))));
    },
  );

  app.get(
    '/invoices',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.BILLING_VIEW } } },
    async (request, reply) => {
      const query = parseInput(invoiceListQuerySchema, request.query);
      const page = await listInvoices(app.db, query);

      return reply.send(paginatedBody(page.invoices, query.page, query.pageSize, page.total));
    },
  );

  app.get(
    '/invoices/:id',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.BILLING_VIEW } } },
    async (request, reply) => {
      const { id } = parseInput(invoiceIdParamSchema, request.params);
      return reply.send(successBody(await getInvoice(app.db, id)));
    },
  );

  app.post(
    '/invoices/:id/finalize',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.BILLING_GENERATE } } },
    async (request, reply) => {
      const { id } = parseInput(invoiceIdParamSchema, request.params);
      const input = parseInput(finalizeInvoiceSchema, request.body ?? {});

      return reply.send(
        successBody(await finalizeInvoice(app.db, id, input, actorContextOf(request))),
      );
    },
  );

  app.post(
    '/invoices/:id/void',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.BILLING_VOID } } },
    async (request, reply) => {
      const { id } = parseInput(invoiceIdParamSchema, request.params);
      const input = parseInput(voidInvoiceSchema, request.body);

      return reply.send(successBody(await voidInvoice(app.db, id, input, actorContextOf(request))));
    },
  );

  app.post(
    '/invoices/:id/adjustments',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.BILLING_ADJUST } } },
    async (request, reply) => {
      const { id } = parseInput(invoiceIdParamSchema, request.params);
      const input = parseInput(createAdjustmentSchema, request.body);

      return reply
        .code(201)
        .send(successBody(await postAdjustment(app.db, id, input, actorContextOf(request))));
    },
  );

  app.post(
    '/billing/apply-penalties',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.BILLING_ADJUST } } },
    async (request, reply) => {
      const input = parseInput(applyPenaltiesSchema, request.body ?? {});
      return reply.send(successBody(await applyPenalties(app.db, input, actorContextOf(request))));
    },
  );
};
