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
  PAYMENT_METHOD_SUMMARY: 'Payment Method Summary',
  REVENUE_BY_PLAN: 'Revenue by Plan/Service',
  PAYMENT_ADJUSTMENTS: 'Payment Adjustment/Reversal Report',
  VOIDED_RECEIPTS: 'Voided Receipt Report',
  USER_ACTIVITY: 'User Activity/Audit Report',
};

const EXPORT_COLORS = {
  navy: '06457F',
  blue: '0474C4',
  paleBlue: 'E8EEF7',
  border: 'D3E0F2',
  muted: '5379AE',
  white: 'FFFFFF',
} as const;

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

function formatColumnHeading(column: string): string {
  return column
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .replace(/\bCentavos\b/g, '(centavos)')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function wrapLongPdfText(value: unknown): string {
  return String(value ?? '').replace(/(\S{16})(?=\S)/g, '$1\u200b');
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
  workbook.creator = 'BCIS Subscription Billing and Collection System';
  workbook.created = new Date(report.generatedAt);
  const sheet = workbook.addWorksheet(report.title.slice(0, 31));
  const titleRow = sheet.addRow([report.title]);
  sheet.mergeCells(1, 1, 1, Math.max(report.columns.length, 1));
  titleRow.height = 28;
  titleRow.font = { name: 'Arial', size: 16, bold: true, color: { argb: EXPORT_COLORS.white } };
  titleRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: EXPORT_COLORS.navy },
  };
  titleRow.alignment = { vertical: 'middle' };

  const generatedRow = sheet.addRow([`Generated ${report.generatedAt}`]);
  sheet.mergeCells(2, 1, 2, Math.max(report.columns.length, 1));
  generatedRow.font = { name: 'Arial', size: 9, color: { argb: EXPORT_COLORS.muted } };
  generatedRow.height = 20;

  sheet.addRow([]);
  const displayColumns = report.columns.map(formatColumnHeading);
  const headerRow = sheet.addRow(displayColumns);
  headerRow.height = 22;
  headerRow.font = { name: 'Arial', size: 10, bold: true, color: { argb: EXPORT_COLORS.white } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: EXPORT_COLORS.blue },
  };
  headerRow.alignment = { vertical: 'middle', wrapText: true };
  for (const row of report.rows) sheet.addRow(report.columns.map((column) => row[column] ?? ''));

  sheet.columns = report.columns.map((column, index) => {
    const maxLength = Math.max(
      displayColumns[index]?.length ?? column.length,
      ...report.rows.map((row) => String(row[column] ?? '').length),
    );
    return { key: String(index), width: Math.min(Math.max(maxLength + 2, 12), 32) };
  });
  for (let rowIndex = 5; rowIndex <= sheet.rowCount; rowIndex += 1) {
    const row = sheet.getRow(rowIndex);
    row.font = { name: 'Arial', size: 10, color: { argb: EXPORT_COLORS.navy } };
    row.alignment = { vertical: 'middle' };
    if (rowIndex % 2 === 0) {
      row.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: EXPORT_COLORS.paleBlue },
      };
    }
    row.eachCell((cell) => {
      cell.border = { bottom: { style: 'hair', color: { argb: EXPORT_COLORS.border } } };
    });
  }
  sheet.autoFilter = {
    from: { row: 4, column: 1 },
    to: { row: 4, column: report.columns.length },
  };
  sheet.views = [{ state: 'frozen', ySplit: 4 }];
  sheet.pageSetup = {
    paperSize: 9,
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: {
      left: 1 / 4,
      right: 1 / 4,
      top: 1 / 2,
      bottom: 1 / 2,
      header: 1 / 5,
      footer: 1 / 5,
    },
  };
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
  const columnCount = Math.max(report.columns.length, 1);
  const columnWidth = Math.max(1, (790 - 12 * columnCount) / columnCount);
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
    pageSize: 'A4',
    pageOrientation: 'landscape',
    defaultStyle: { font: 'Roboto', fontSize: report.columns.length > 10 ? 6 : 8 },
    pageMargins: [24, 36, 24, 36],
    content: [
      { text: report.title, style: 'title' },
      { text: `Generated ${report.generatedAt}`, style: 'generated' },
      {
        table: {
          headerRows: 1,
          widths: report.columns.map(() => columnWidth),
          body: [
            report.columns.map((column) => ({
              text: formatColumnHeading(column),
              style: 'tableHeader',
            })),
            ...report.rows.map((row) =>
              report.columns.map((column) => wrapLongPdfText(row[column])),
            ),
          ],
          dontBreakRows: true,
          keepWithHeaderRows: 1,
        },
        layout: {
          hLineColor: () => `#${EXPORT_COLORS.border}`,
          vLineColor: () => `#${EXPORT_COLORS.border}`,
          fillColor: (rowIndex: number) =>
            rowIndex > 0 && rowIndex % 2 === 0 ? `#${EXPORT_COLORS.paleBlue}` : null,
          paddingLeft: () => 5,
          paddingRight: () => 5,
          paddingTop: () => 4,
          paddingBottom: () => 4,
        },
      },
    ],
    styles: {
      title: {
        fontSize: 16,
        bold: true,
        color: `#${EXPORT_COLORS.navy}`,
        margin: [0, 0, 0, 4],
      },
      generated: {
        fontSize: 8,
        color: `#${EXPORT_COLORS.muted}`,
        margin: [0, 0, 0, 12],
      },
      tableHeader: {
        bold: true,
        fontSize: report.columns.length > 10 ? 7 : 8,
        color: `#${EXPORT_COLORS.white}`,
        fillColor: `#${EXPORT_COLORS.blue}`,
      },
    },
    footer: (currentPage: number, pageCount: number) => ({
      text: `${currentPage} / ${pageCount}`,
      alignment: 'right',
      color: `#${EXPORT_COLORS.muted}`,
      fontSize: 8,
      margin: [0, 12, 32, 0],
    }),
  } as TDocumentDefinitions;
  return Buffer.from(await pdfMake.createPdf(definition).getBuffer());
}
