import type {
  Dashboard,
  ReportExportFormat,
  ReportQuery,
  ReportResult,
  ReportType,
} from '@bcis/validation';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@renderer/components/ui/button';
import { Alert, MetricCard, PageHeader, SectionCard } from '@renderer/components/ui/feedback';
import { Select } from '@renderer/components/ui/form';
import { DataTable, EmptyRow, Td, Th, Tr } from '@renderer/components/ui/table';
import { useAuth } from '@renderer/features/auth/auth-context';
import { formatMoney } from '@renderer/lib/money';
import type { JSX } from 'react';
import { useState } from 'react';
import { DashboardCharts } from './dashboard-charts';
import { ReportTypeSelect } from './report-type-select';

const EXPORT_FORMATS: readonly { value: ReportExportFormat; label: string }[] = [
  { value: 'xlsx', label: 'Excel (.xlsx)' },
  { value: 'pdf', label: 'PDF (.pdf)' },
  { value: 'csv', label: 'CSV (.csv)' },
];

export function ReportsScreen(): JSX.Element {
  const { can } = useAuth();
  const canExport = can('report.export');

  const [type, setType] = useState<ReportType>('MONTHLY_COLLECTION');
  const [exportFormat, setExportFormat] = useState<ReportExportFormat>('xlsx');
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState<{
    readonly tone: 'success' | 'danger';
    readonly text: string;
  } | null>(null);

  const dashboard = useQuery({
    queryKey: ['phase8-dashboard'],
    queryFn: () => window.bcis.reports.dashboard(),
  });
  const reportQuery: ReportQuery = { type, format: 'json', page: 1, pageSize: 100 };
  const report = useQuery({
    queryKey: ['phase8-report', type],
    queryFn: () => window.bcis.reports.get(reportQuery),
  });
  const data: Dashboard | null = dashboard.data?.item ?? null;
  const result: ReportResult | null = report.data?.item ?? null;

  async function exportReport(): Promise<void> {
    setExporting(true);
    setExportNotice(null);

    const outcome = await window.bcis.reports.export({
      type,
      format: exportFormat,
      page: 1,
      pageSize: 100,
    });

    setExporting(false);

    if (!outcome.ok) {
      // A cancelled save dialog is not a failure worth shouting about.
      if (outcome.errorCode === 'CANCELLED') return;
      setExportNotice({ tone: 'danger', text: outcome.error ?? 'The export failed.' });
      return;
    }

    setExportNotice({
      tone: 'success',
      text: `Saved to ${outcome.filePath ?? 'the file you chose'}.`,
    });
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <PageHeader
        title="Dashboard & Reports"
        description="Management views built from posted billing, collection, ledger, receivables, and audit data."
      />
      {(dashboard.data?.ok === false || report.data?.ok === false) && (
        <Alert tone="danger" title="Could not load reporting data">
          {dashboard.data?.error ?? report.data?.error ?? 'Unknown error.'}
        </Alert>
      )}
      {data !== null && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <MetricCard
            label="Current receivable"
            value={formatMoney(data.currentReceivableCentavos)}
          />
          <MetricCard
            label="Overdue receivable"
            value={formatMoney(data.overdueReceivableCentavos)}
          />
          <MetricCard
            label="Billed this period"
            value={formatMoney(data.billedThisPeriodCentavos)}
          />
          <MetricCard
            label="Collected this period"
            value={formatMoney(data.collectedThisPeriodCentavos)}
          />
          <MetricCard label="Overdue subscribers" value={String(data.overdueSubscribers)} />
        </div>
      )}
      {data !== null && <DashboardCharts dashboard={data} />}
      <SectionCard
        title="Reports"
        description="Select a report to view its live database result, then export it to Excel, PDF, or CSV."
      >
        <div className="mb-4 grid grid-cols-1 items-center gap-3 sm:grid-cols-[minmax(0,1fr)_11rem_auto]">
          <ReportTypeSelect value={type} onChange={setType} />

          {canExport && (
            <Select
              className="w-full"
              aria-label="Export format"
              value={exportFormat}
              onChange={(event) => setExportFormat(event.target.value as ReportExportFormat)}
            >
              {EXPORT_FORMATS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </Select>
          )}

          {canExport && (
            <Button
              size="sm"
              variant="primary"
              disabled={exporting}
              onClick={() => {
                void exportReport();
              }}
            >
              {exporting ? 'Exporting…' : 'Export'}
            </Button>
          )}
        </div>

        {exportNotice !== null && (
          <div className="mb-4">
            <Alert tone={exportNotice.tone}>{exportNotice.text}</Alert>
          </div>
        )}

        {result !== null && (
          <DataTable className="border-0">
            <thead>
              <tr>
                {result.columns.map((column) => (
                  <Th key={column}>{column}</Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.length === 0 && (
                <EmptyRow colSpan={Math.max(result.columns.length, 1)}>
                  No records match this report.
                </EmptyRow>
              )}
              {result.rows.map((row, index) => (
                <Tr key={index}>
                  {result.columns.map((column) => (
                    <Td key={column}>{String(row[column] ?? '—')}</Td>
                  ))}
                </Tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </SectionCard>
    </div>
  );
}
