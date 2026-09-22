import { PERMISSIONS } from '@bcis/shared';
import { receiptIdParamSchema, reportQuerySchema, successBody } from '@bcis/validation';
import type { FastifyPluginAsync } from 'fastify';

import { parseInput } from '../../shared/validate';
import { exportCsv, exportPdf, exportXlsx, getDashboard, getReport } from './reports.service';
import { receiptPrintData } from './reports.repository';

export const reportsRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/dashboard',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.REPORT_VIEW } } },
    async (_request, reply) => reply.send(successBody(await getDashboard(app.db))),
  );

  app.get(
    '/reports',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.REPORT_VIEW } } },
    async (request, reply) => {
      const query = parseInput(reportQuerySchema, request.query);
      return reply.send(successBody(await getReport(app.db, query)));
    },
  );

  app.get(
    '/reports/export',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.REPORT_EXPORT } } },
    async (request, reply) => {
      const query = parseInput(reportQuerySchema, request.query);
      if (query.format === 'json') return reply.send(successBody(await getReport(app.db, query)));
      const buffer =
        query.format === 'xlsx'
          ? await exportXlsx(app.db, query)
          : query.format === 'csv'
            ? await exportCsv(app.db, query)
            : await exportPdf(app.db, query);
      const contentType =
        query.format === 'xlsx'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : query.format === 'pdf'
            ? 'application/pdf'
            : 'text/csv; charset=utf-8';
      return reply
        .type(contentType)
        .header(
          'content-disposition',
          `attachment; filename="${query.type.toLowerCase()}.${query.format}"`,
        )
        .send(buffer);
    },
  );

  app.get(
    '/reports/statement-of-account/print',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.REPORT_VIEW } } },
    async (request, reply) => {
      const query = parseInput(reportQuerySchema, {
        ...(request.query as object),
        type: 'STATEMENT_OF_ACCOUNT',
      });
      const report = await getReport(app.db, query);
      return reply
        .type('text/html')
        .send(printableTable(report.title, report.columns, report.rows));
    },
  );

  app.get(
    '/receipts/:id/print',
    { config: { auth: { authenticated: true, permission: PERMISSIONS.PAYMENT_VIEW } } },
    async (request, reply) => {
      const { id } = parseInput(receiptIdParamSchema, request.params);
      const receipt = await receiptPrintData(app.db, id);
      if (receipt === null)
        return reply.code(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'That receipt does not exist.',
            requestId: request.id,
          },
        });
      return reply
        .type('text/html')
        .send(
          `<!doctype html><html><head><meta charset="utf-8"><title>Receipt ${escapeHtml(receipt.receiptNumber)}</title><style>body{font-family:system-ui,sans-serif;margin:2rem;max-width:34rem}dt{font-weight:700;margin-top:1rem}button{margin-bottom:1rem}@media print{button{display:none}}</style></head><body><button onclick="window.print()">Print</button><h1>Receipt ${escapeHtml(receipt.receiptNumber)}</h1><dl><dt>Subscriber</dt><dd>${escapeHtml(receipt.subscriber)} (${escapeHtml(receipt.subscriberAccountNumber)})</dd><dt>Service account</dt><dd>${escapeHtml(receipt.serviceAccountNumber)}</dd><dt>Amount</dt><dd>${String(receipt.amountCentavos)} centavos</dd><dt>Payment method</dt><dd>${escapeHtml(receipt.paymentMethod)}</dd><dt>Reference</dt><dd>${escapeHtml(receipt.referenceNumber ?? '—')}</dd><dt>Issued</dt><dd>${escapeHtml(receipt.issuedAt.toISOString())}</dd></dl></body></html>`,
        );
    },
  );
};

function printableTable(
  title: string,
  columns: readonly string[],
  rows: readonly Record<string, unknown>[],
): string {
  const header = columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('');
  const body = rows
    .map(
      (row) =>
        `<tr>${columns.map((column) => `<td>${escapeHtml(String(row[column] ?? '—'))}</td>`).join('')}</tr>`,
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font-family:system-ui,sans-serif;margin:2rem}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:.45rem;text-align:left}th{background:#eee}button{margin-bottom:1rem}@media print{button{display:none}}</style></head><body><button onclick="window.print()">Print</button><h1>${escapeHtml(title)}</h1><table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
