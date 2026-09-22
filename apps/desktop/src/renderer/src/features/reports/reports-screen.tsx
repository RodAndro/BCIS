import type { Dashboard, ReportQuery, ReportResult, ReportType } from '@bcis/validation';
import { useQuery } from '@tanstack/react-query';
import { Alert, PageHeader, SectionCard } from '@renderer/components/ui/feedback';
import { DataTable, EmptyRow, Td, Th, Tr } from '@renderer/components/ui/table';
import { formatMoney } from '@renderer/lib/money';
import type { JSX } from 'react';
import { useState } from 'react';

const REPORTS: readonly { value: ReportType; label: string }[] = [
  { value: 'DAILY_COLLECTION', label: 'Daily collection' },
  { value: 'WEEKLY_COLLECTION', label: 'Weekly collection' },
  { value: 'MONTHLY_COLLECTION', label: 'Monthly collection' },
  { value: 'ANNUAL_COLLECTION', label: 'Annual collection' },
  { value: 'BILLING_VS_COLLECTION', label: 'Billing vs collection' },
  { value: 'AR_AGING', label: 'AR aging' },
  { value: 'OVERDUE_SUBSCRIBERS', label: 'Overdue subscribers' },
  { value: 'SUBSCRIBER_MASTER', label: 'Subscriber master list' },
  { value: 'COLLECTOR_COLLECTION', label: 'Collector collection' },
  { value: 'COLLECTOR_REMITTANCE', label: 'Collector remittance' },
  { value: 'COLLECTOR_VARIANCE', label: 'Collector variance' },
  { value: 'COLLECTOR_PERFORMANCE', label: 'Collector performance' },
  { value: 'PAYMENT_ADJUSTMENTS', label: 'Payment adjustments/reversals' },
  { value: 'VOIDED_RECEIPTS', label: 'Voided receipts' },
  { value: 'USER_ACTIVITY', label: 'User activity' },
];

export function ReportsScreen(): JSX.Element {
  const [type, setType] = useState<ReportType>('MONTHLY_COLLECTION');
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
          <Metric label="Current receivable" value={data.currentReceivableCentavos} />
          <Metric label="Overdue receivable" value={data.overdueReceivableCentavos} />
          <Metric label="Billed this period" value={data.billedThisPeriodCentavos} />
          <Metric label="Collected this period" value={data.collectedThisPeriodCentavos} />
          <Metric label="Overdue subscribers" value={data.overdueSubscribers} money={false} />
        </div>
      )}
      <SectionCard
        title="Reports"
        description="Select a report to view its live database result. Exports are available through the API report export endpoint."
      >
        <select
          className="mb-4 h-9 rounded-md border border-border bg-surface px-3 text-sm"
          value={type}
          onChange={(event) => setType(event.target.value as ReportType)}
        >
          {REPORTS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
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

function Metric({
  label,
  value,
  money = true,
}: {
  readonly label: string;
  readonly value: number;
  readonly money?: boolean;
}): JSX.Element {
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">
        {money ? formatMoney(value) : String(value)}
      </p>
    </section>
  );
}
