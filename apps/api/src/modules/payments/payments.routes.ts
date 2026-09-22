import { PERMISSIONS } from '@bcis/shared';
import {
  createPaymentSchema,
  paginatedBody,
  paymentIdParamSchema,
  paymentListQuerySchema,
  reversePaymentSchema,
  successBody,
  verifyPaymentSchema,
} from '@bcis/validation';
import type { FastifyPluginAsync } from 'fastify';

import { actorContextOf } from '../../shared/request-context';
import { parseInput } from '../../shared/validate';
import {
  capturePayment,
  getPayment,
  listPayments,
  previewPayment,
  reversePayment,
  verifyPayment,
} from './payments.service';

/**
 * Payment endpoints.
 *
 * ── PERMISSIONS ─────────────────────────────────────────────────────────────
 * Reading needs `payment.view`. Capturing needs `payment.create`. The GCash
 * verification queue and approve/reject need `payment.verify.gcash`, and
 * reversal needs `payment.reverse`.
 */
export const paymentsRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/payments',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.PAYMENT_VIEW } } },
    async (request, reply) => {
      const query = parseInput(paymentListQuerySchema, request.query);
      const page = await listPayments(app.db, query);
      return reply.send(paginatedBody(page.payments, query.page, query.pageSize, page.total));
    },
  );

  app.get(
    '/payments/pending-verification',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.PAYMENT_VERIFY_GCASH } } },
    async (request, reply) => {
      const query = parseInput(paymentListQuerySchema, {
        ...(request.query as object),
        status: 'PENDING_VERIFICATION',
      });
      const page = await listPayments(app.db, query);
      return reply.send(paginatedBody(page.payments, query.page, query.pageSize, page.total));
    },
  );

  app.post(
    '/payments/preview',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.PAYMENT_CREATE } } },
    async (request, reply) => {
      const input = parseInput(createPaymentSchema, request.body);
      return reply.send(successBody(await previewPayment(app.db, input)));
    },
  );

  app.get(
    '/payments/:id',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.PAYMENT_VIEW } } },
    async (request, reply) => {
      const { id } = parseInput(paymentIdParamSchema, request.params);
      return reply.send(successBody(await getPayment(app.db, id)));
    },
  );

  app.post(
    '/payments',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.PAYMENT_CREATE } } },
    async (request, reply) => {
      const input = parseInput(createPaymentSchema, request.body);
      return reply.code(201).send(successBody(await capturePayment(app.db, input, actorContextOf(request))));
    },
  );

  app.post(
    '/payments/:id/verify',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.PAYMENT_VERIFY_GCASH } } },
    async (request, reply) => {
      const { id } = parseInput(paymentIdParamSchema, request.params);
      const input = parseInput(verifyPaymentSchema, request.body);
      return reply.send(successBody(await verifyPayment(app.db, id, input, actorContextOf(request))));
    },
  );

  app.post(
    '/payments/:id/reverse',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.PAYMENT_REVERSE } } },
    async (request, reply) => {
      const { id } = parseInput(paymentIdParamSchema, request.params);
      const input = parseInput(reversePaymentSchema, request.body);
      return reply.send(successBody(await reversePayment(app.db, id, input, actorContextOf(request))));
    },
  );
};
