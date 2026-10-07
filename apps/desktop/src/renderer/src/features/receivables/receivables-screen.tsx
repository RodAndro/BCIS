import type { AgingSummary, ReceivableSummary } from '@bcis/validation';
import { useQuery } from '@tanstack/react-query';
import { Alert, MetricCard, PageHeader, SectionCard } from '@renderer/components/ui/feedback';
import { CheckboxRow, Select } from '@renderer/components/ui/form';
import { DEFAULT_PAGE_SIZE, Pager } from '@renderer/components/ui/pager';
import { DataTable, EmptyRow, Td, Th, Tr } from '@renderer/components/ui/table';
import { formatMoney } from '@renderer/lib/money';
import type { JSX } from 'react';
import { useState } from 'react';

interface Filters {
  readonly overdueOnly: boolean;
  readonly agingBucket: ReceivableSummary['agingBucket'] | '';
  readonly page: number;
  readonly pageSize: number;
}
export function ReceivablesScreen(): JSX.Element {
  const [filters, setFilters] = useState<Filters>({
    overdueOnly: true,
    agingBucket: '',
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
  });
  const [candidatePage, setCandidatePage] = useState(1);
  const [candidatePageSize, setCandidatePageSize] = useState(DEFAULT_PAGE_SIZE);

  const aging = useQuery({
    queryKey: ['receivables-aging'],
    queryFn: () => window.bcis.receivables.aging(),
  });
  const receivables = useQuery({
    queryKey: ['receivables', filters],
    queryFn: () =>
      window.bcis.receivables.list({
        page: filters.page,
        pageSize: filters.pageSize,
        overdueOnly: filters.overdueOnly,
        ...(filters.agingBucket === '' ? {} : { agingBucket: filters.agingBucket }),
      }),
  });
  const candidates = useQuery({
    queryKey: ['receivable-candidates', candidatePage, candidatePageSize],
    queryFn: () =>
      window.bcis.receivables.candidates({ page: candidatePage, pageSize: candidatePageSize }),
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
          <MetricCard label="Current" value={formatMoney(agingData.currentCentavos)} />
          <MetricCard label="1–30 days" value={formatMoney(agingData.bucket1To30Centavos)} />
          <MetricCard label="31–60 days" value={formatMoney(agingData.bucket31To60Centavos)} />
          <MetricCard label="61–90 days" value={formatMoney(agingData.bucket61To90Centavos)} />
          <MetricCard label="90+ days" value={formatMoney(agingData.bucket90PlusCentavos)} />
        </div>
      )}
      <SectionCard
        title="Overdue follow-up"
        description="Filtered on the server and ordered by oldest unpaid invoice."
      >
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <CheckboxRow
            checked={filters.overdueOnly}
            onChange={(checked) => {
              setFilters((current) => ({ ...current, overdueOnly: checked, page: 1 }));
            }}
            label="Overdue only"
          />

          <div className="w-44">
            <Select
              aria-label="Aging bucket"
              value={filters.agingBucket}
              onChange={(event) => {
                setFilters((current) => ({
                  ...current,
                  agingBucket: event.target.value as Filters['agingBucket'],
                  page: 1,
                }));
              }}
            >
              <option value="">All aging buckets</option>
              <option value="1_30">1–30</option>
              <option value="31_60">31–60</option>
              <option value="61_90">61–90</option>
              <option value="90_PLUS">90+</option>
            </Select>
          </div>
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

        <Pager
          className="mt-4"
          page={filters.page}
          pageSize={filters.pageSize}
          total={receivables.data?.total ?? 0}
          onChange={(page) => {
            setFilters((current) => ({ ...current, page }));
          }}
          onPageSizeChange={(pageSize) => {
            setFilters((current) => ({ ...current, pageSize, page: 1 }));
          }}
        />
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

        <Pager
          className="mt-4"
          page={candidatePage}
          pageSize={candidatePageSize}
          total={candidates.data?.total ?? 0}
          onChange={setCandidatePage}
          onPageSizeChange={(pageSize) => {
            setCandidatePageSize(pageSize);
            setCandidatePage(1);
          }}
        />
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
