import ExcelJS from 'exceljs';
import { businessToday } from '@bcis/shared';
import { sql } from 'drizzle-orm';
import { resolve } from 'node:path';
import pdfMake from 'pdfmake';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import type { Dashboard, ReportQuery, ReportResult, ReportType } from '@bcis/validation';

import type { Db } from '../../shared/database';
import { getAgingSummary, listReceivables } from '../receivables/receivables.service';
import { subscriberStatement } from '../ledger/ledger.service';
import { getBillingDashboard } from '../billing/billing.service';
import { reportRows, type ReportData } from './reports.repository';

const TITLES: Record<ReportType, string> = {
  DAILY_COLLECTION: 'Daily Collection Report',
  WEEKLY_COLLECTION: 'Weekly Collection Report',
  MONTHLY_COLLECTION: 'Monthly Collection Report',
  ANNUAL_COLLECTION: 'Annual Collection Report',
  BILLING_VS_COLLECTION: 'Billing vs Collection Report',
  AR_AGING: 'Accounts Receivable Aging Report',
  OVERDUE_SUBSCRIBERS: 'Overdue Subscriber Report',
  SUBSCRIBER_MASTER: 'Subscriber Master List',
  SUBSCRIBER_LEDGER: 'Subscriber Ledger',
  STATEMENT_OF_ACCOUNT: 'Statement of Account',
  COLLECTOR_COLLECTION: 'Collector Collection Report',
  COLLECTOR_REMITTANCE: 'Collector Remittance Report',
  COLLECTOR_VARIANCE: 'Collector Shortage/Overage Report',
  COLLECTOR_PERFORMANCE: 'Collector Performance Report',
  PAYMENT_ADJUSTMENTS: 'Payment Adjustment/Reversal Report',
  VOIDED_RECEIPTS: 'Voided Receipt Report',
  USER_ACTIVITY: 'User Activity/Audit Report',
};

function serialise(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serialise);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serialise(item)]));
  }
  return value;
}

function totalsFor(rows: readonly Record<string, unknown>[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (key.endsWith('Centavos') && typeof value === 'number')
        totals[key] = (totals[key] ?? 0) + value;
    }
  }
  return totals;
}

async function dataForReport(db: Db, query: ReportQuery): Promise<ReportData> {
  if (query.type === 'AR_AGING') {
    const aging = await getAgingSummary(db);
    const row = { ...aging };
    return { columns: Object.keys(row), rows: [row] };
  }
  if (query.type === 'OVERDUE_SUBSCRIBERS') {
    const page = await listReceivables(db, { ...query, overdueOnly: true });
    const rows = page.receivables.map((row) => ({ ...row }));
    return { columns: Object.keys(rows[0] ?? { subscriber: '', totalArrearsCentavos: 0 }), rows };
  }
  if (query.type === 'SUBSCRIBER_LEDGER' || query.type === 'STATEMENT_OF_ACCOUNT') {
    if (query.subscriberId === undefined)
      throw new Error('subscriberId is required for this report.');
    const statement = await subscriberStatement(db, query.subscriberId, {
      from: query.from,
      to: query.to,
      page: query.page,
      pageSize: query.pageSize,
      ...(query.serviceAccountId === undefined ? {} : { serviceAccountId: query.serviceAccountId }),
    });
    const rows = statement.entries.map((entry) => ({ ...entry }));
    return {
      columns: Object.keys(rows[0] ?? { entryDate: '', description: '', balanceCentavos: 0 }),
      rows,
    };
  }
  return reportRows(db, query.type, query);
}

export async function getReport(db: Db, query: ReportQuery): Promise<ReportResult> {
  const data = await dataForReport(db, query);
  const rows = data.rows.map((row) => serialise(row) as Record<string, unknown>);
  return {
    type: query.type,
    title: TITLES[query.type],
    columns: [...data.columns],
    rows,
    totals: totalsFor(rows),
    generatedAt: new Date().toISOString(),
  };
}

export async function getDashboard(db: Db): Promise<Dashboard> {
  const today = businessToday();
  const [billing, aging, overdue, payments] = await Promise.all([
    getBillingDashboard(db),
    getAgingSummary(db),
    listReceivables(db, { page: 1, pageSize: 1000, overdueOnly: true }),
    db.execute<{
      method: string;
      amount_centavos: number;
    }>(sql`select payment_method as method, coalesce(sum(amount_centavos), 0)::bigint as amount_centavos
       from payments where status = 'POSTED' and payment_date >= date_trunc('month', ${today}::date)
       group by payment_method order by payment_method`),
  ]);
  const overdueSubscribers = new Set(overdue.receivables.map((row) => row.subscriberId)).size;
  const collectedThisPeriodCentavos = payments.rows.reduce(
    (sum, row) => sum + Number(row.amount_centavos),
    0,
  );
  return {
    currentReceivableCentavos: aging.totalOutstandingCentavos,
    overdueReceivableCentavos:
      aging.bucket1To30Centavos +
      aging.bucket31To60Centavos +
      aging.bucket61To90Centavos +
      aging.bucket90PlusCentavos,
    overdueSubscribers,
    billedThisPeriodCentavos: billing.billedThisPeriodCentavos,
    collectedThisPeriodCentavos,
    paymentMethods: payments.rows.map((row) => ({
      method: row.method,
      amountCentavos: Number(row.amount_centavos),
    })),
    aging: {
      currentCentavos: aging.currentCentavos,
      bucket1To30Centavos: aging.bucket1To30Centavos,
      bucket31To60Centavos: aging.bucket31To60Centavos,
      bucket61To90Centavos: aging.bucket61To90Centavos,
      bucket90PlusCentavos: aging.bucket90PlusCentavos,
    },
    overdueAlerts: overdue.total,
  };
}

export async function exportXlsx(db: Db, query: ReportQuery): Promise<Buffer> {
  const report = await getReport(db, query);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(report.title.slice(0, 31));
  sheet.addRow(report.columns);
  for (const row of report.rows) sheet.addRow(report.columns.map((column) => row[column] ?? ''));
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function exportCsv(db: Db, query: ReportQuery): Promise<Buffer> {
  const report = await getReport(db, query);
  const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return Buffer.from(
    [
      report.columns.map(escape).join(','),
      ...report.rows.map((row) => report.columns.map((column) => escape(row[column])).join(',')),
    ].join('\n'),
    'utf8',
  );
}

export async function exportPdf(db: Db, query: ReportQuery): Promise<Buffer> {
  const report = await getReport(db, query);
  pdfMake.addFonts({
    Roboto: {
      normal: resolve(
        import.meta.dirname,
        '../../../node_modules/pdfmake/build/fonts/Roboto/Roboto-Regular.ttf',
      ),
      bold: resolve(
        import.meta.dirname,
        '../../../node_modules/pdfmake/build/fonts/Roboto/Roboto-Medium.ttf',
      ),
      italics: resolve(
        import.meta.dirname,
        '../../../node_modules/pdfmake/build/fonts/Roboto/Roboto-Italic.ttf',
      ),
      bolditalics: resolve(
        import.meta.dirname,
        '../../../node_modules/pdfmake/build/fonts/Roboto/Roboto-MediumItalic.ttf',
      ),
    },
  });
  const definition = {
    defaultStyle: { font: 'Roboto', fontSize: 8 },
    content: [
      { text: report.title, style: 'header' },
      { text: `Generated ${report.generatedAt}`, margin: [0, 0, 0, 8] },
      {
        table: {
          headerRows: 1,
          widths: report.columns.map(() => '*'),
          body: [
            report.columns,
            ...report.rows.map((row) => report.columns.map((column) => String(row[column] ?? ''))),
          ],
        },
      },
    ],
    styles: { header: { fontSize: 14, bold: true, margin: [0, 0, 0, 8] } },
  } as TDocumentDefinitions;
  return Buffer.from(await pdfMake.createPdf(definition).getBuffer());
}
