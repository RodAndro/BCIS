import type { AgingSummary, ReceivableSummary } from '@bcis/validation';
import { useQuery } from '@tanstack/react-query';
import { Alert, PageHeader, SectionCard } from '@renderer/components/ui/feedback';
import { DataTable, EmptyRow, Td, Th, Tr } from '@renderer/components/ui/table';
import { formatMoney } from '@renderer/lib/money';
import type { JSX } from 'react';
import { useState } from 'react';

export function ReceivablesScreen(): JSX.Element {
  const [overdueOnly, setOverdueOnly] = useState(true);
  const [agingBucket, setAgingBucket] = useState<ReceivableSummary['agingBucket'] | ''>('');
  const aging = useQuery({
    queryKey: ['receivables-aging'],
    queryFn: () => window.bcis.receivables.aging(),
  });
  const receivables = useQuery({
    queryKey: ['receivables', overdueOnly, agingBucket],
    queryFn: () =>
      window.bcis.receivables.list({
        page: 1,
        pageSize: 100,
        overdueOnly,
        ...(agingBucket === '' ? {} : { agingBucket }),
      }),
  });
  const candidates = useQuery({
    queryKey: ['receivable-candidates'],
    queryFn: () => window.bcis.receivables.candidates({ page: 1, pageSize: 100 }),
  });

  const agingData: AgingSummary | null = aging.data?.item ?? null;
  const rows = receivables.data?.items ?? [];
  const candidateRows = candidates.data?.items ?? [];

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <PageHeader
        title="Receivables"
        description="Outstanding balances, overdue follow-up, and suspension candidates."
      />
      {(receivables.data?.ok === false || aging.data?.ok === false) && (
        <Alert tone="danger" title="Could not load receivables">
          {receivables.data?.error ?? aging.data?.error ?? 'Unknown error.'}
        </Alert>
      )}
      {agingData !== null && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Metric label="Current" value={agingData.currentCentavos} />
          <Metric label="1–30 days" value={agingData.bucket1To30Centavos} />
          <Metric label="31–60 days" value={agingData.bucket31To60Centavos} />
          <Metric label="61–90 days" value={agingData.bucket61To90Centavos} />
          <Metric label="90+ days" value={agingData.bucket90PlusCentavos} />
        </div>
      )}
      <SectionCard
        title="Overdue follow-up"
        description="Filtered on the server and ordered by oldest unpaid invoice."
      >
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={overdueOnly}
              onChange={(event) => setOverdueOnly(event.target.checked)}
            />{' '}
            Overdue only
          </label>
          <select
            className="h-9 rounded-md border border-border bg-surface px-3 text-sm"
            value={agingBucket}
            onChange={(event) => setAgingBucket(event.target.value as typeof agingBucket)}
          >
            <option value="">All aging buckets</option>
            <option value="1_30">1–30</option>
            <option value="31_60">31–60</option>
            <option value="61_90">61–90</option>
            <option value="90_PLUS">90+</option>
          </select>
        </div>
        <DataTable className="border-0">
          <thead>
            <tr>
              <Th>Subscriber</Th>
              <Th>Service / area</Th>
              <Th>Collector</Th>
              <Th>Oldest unpaid</Th>
              <Th align="right">Months</Th>
              <Th align="right">Arrears</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <EmptyRow colSpan={6}>No receivables match the selected filters.</EmptyRow>
            )}
            {rows.map((row) => (
              <ReceivableRow key={row.serviceAccountId} row={row} />
            ))}
          </tbody>
        </DataTable>
      </SectionCard>
      <SectionCard
        title="Suspension candidates"
        description="Candidates require an explicit authorized suspension action; this list does not change service state."
      >
        <DataTable className="border-0">
          <thead>
            <tr>
              <Th>Subscriber</Th>
              <Th>Account</Th>
              <Th>Age</Th>
              <Th align="right">Arrears</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {candidateRows.length === 0 && (
              <EmptyRow colSpan={5}>No accounts currently meet the configured threshold.</EmptyRow>
            )}
            {candidateRows.map((row) => (
              <Tr key={row.serviceAccountId}>
                <Td>{row.subscriber}</Td>
                <Td>{row.accountNumber}</Td>
                <Td>{row.agingBucket}</Td>
                <Td align="right">{formatMoney(row.totalArrearsCentavos)}</Td>
                <Td>{row.eligible ? 'Eligible for review' : 'Review required'}</Td>
              </Tr>
            ))}
          </tbody>
        </DataTable>
      </SectionCard>
    </div>
  );
}

function ReceivableRow({ row }: { readonly row: ReceivableSummary }): JSX.Element {
  return (
    <Tr>
      <Td>
        <div className="font-medium">{row.subscriber}</div>
        <div className="text-xs text-muted-foreground">{row.accountNumber}</div>
      </Td>
      <Td>
        {row.plan}
        <div className="text-xs text-muted-foreground">{row.area ?? 'No area'}</div>
      </Td>
      <Td>{row.collector ?? 'Unassigned'}</Td>
      <Td>{row.oldestUnpaidInvoice ?? '—'}</Td>
      <Td align="right">{row.monthsUnpaid}</Td>
      <Td align="right" className="font-medium">
        {formatMoney(row.totalArrearsCentavos)}
      </Td>
    </Tr>
  );
}

function Metric({ label, value }: { readonly label: string; readonly value: number }): JSX.Element {
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{formatMoney(value)}</p>
    </section>
  );
}
