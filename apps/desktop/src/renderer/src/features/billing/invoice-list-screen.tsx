import type { InvoiceSummary } from '@bcis/validation';
import { useQuery } from '@tanstack/react-query';
import { StatusPill } from '@renderer/components/status-pill';
import { Button } from '@renderer/components/ui/button';
import { Alert, PageHeader } from '@renderer/components/ui/feedback';
import { Input, Select } from '@renderer/components/ui/form';
import { Pager } from '@renderer/components/ui/pager';
import { DataTable, EmptyRow, Th, Td, Tr } from '@renderer/components/ui/table';
import { invoiceStatusTone } from '@renderer/features/billing/status';
import { formatMoney } from '@renderer/lib/money';
import type { JSX } from 'react';
import { useState } from 'react';

/**
 * Invoice list.
 *
 * ── WHY `displayStatus` IS FILTERABLE AND `status` IS NOT THE DEFAULT ───────
 * An operator asks for "what is overdue", not "what is UNPAID with a balance and
 * a past due date". The list therefore filters on the derived state, while the
 * table shows both — `PARTIALLY_PAID · overdue` is two facts, and collapsing
 * them would lose one.
 */
interface Filters {
  readonly search: string;
  readonly displayStatus: string;
  readonly month: string;
  readonly page: number;
  readonly pageSize: number;
}

export function InvoiceListScreen({
  onOpen,
}: {
  readonly onOpen: (invoiceId: number) => void;
}): JSX.Element {
  const [filters, setFilters] = useState<Filters>({
    search: '',
    displayStatus: '',
    month: '',
    page: 1,
    pageSize: 25,
  });

  const invoices = useQuery({
    queryKey: ['invoices', filters],
    queryFn: () =>
      window.bcis.invoices.list({
        search: filters.search.length > 0 ? filters.search : undefined,
        displayStatus:
          filters.displayStatus === ''
            ? undefined
            : (filters.displayStatus as 'OVERDUE' | 'UNPAID' | 'PAID' | 'VOID' | 'DRAFT'),
        month: filters.month.length > 0 ? filters.month : undefined,
        page: filters.page,
        pageSize: filters.pageSize,
      }),
  });

  const items = invoices.data?.items ?? [];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHeader
        title="Invoices"
        description="Every invoice raised, with its stored state and its derived one."
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-64">
          <Input
            placeholder="Invoice number, subscriber, or account"
            value={filters.search}
            onChange={(event) => {
              setFilters((current) => ({ ...current, search: event.target.value, page: 1 }));
            }}
          />
        </div>

        <div className="w-40">
          <Select
            aria-label="Status"
            value={filters.displayStatus}
            onChange={(event) => {
              setFilters((current) => ({ ...current, displayStatus: event.target.value, page: 1 }));
            }}
          >
            <option value="">All statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="UNPAID">Unpaid</option>
            <option value="PARTIALLY_PAID">Partially paid</option>
            <option value="OVERDUE">Overdue</option>
            <option value="PAID">Paid</option>
            <option value="VOID">Void</option>
            <option value="CREDITED">Credited</option>
          </Select>
        </div>

        <div className="w-44">
          <Input
            type="month"
            aria-label="Billing month"
            value={filters.month}
            onChange={(event) => {
              setFilters((current) => ({ ...current, month: event.target.value, page: 1 }));
            }}
          />
        </div>

        <Button
          onClick={() => {
            setFilters({ search: '', displayStatus: '', month: '', page: 1, pageSize: 25 });
          }}
        >
          Clear
        </Button>

        <span className="ml-auto text-xs text-muted-foreground">
          {invoices.data === undefined ? '' : `${String(invoices.data.total)} invoice(s)`}
        </span>
      </div>

      {invoices.data?.ok === false && (
        <Alert tone="danger" title="Could not load invoices">
          {invoices.data.error ?? 'Unknown error.'}
        </Alert>
      )}

      <DataTable>
        <thead>
          <tr>
            <Th>Invoice</Th>
            <Th>Subscriber</Th>
            <Th>Period</Th>
            <Th>Due</Th>
            <Th align="right">Total</Th>
            <Th align="right">Balance</Th>
            <Th>Status</Th>
            <Th align="right">Actions</Th>
          </tr>
        </thead>
        <tbody>
          {invoices.isLoading && <EmptyRow colSpan={8}>Loading…</EmptyRow>}

          {!invoices.isLoading && items.length === 0 && (
            <EmptyRow colSpan={8}>No invoices match this filter.</EmptyRow>
          )}

          {items.map((invoice) => (
            <InvoiceRow
              key={invoice.id}
              invoice={invoice}
              onOpen={() => {
                onOpen(invoice.id);
              }}
            />
          ))}
        </tbody>
      </DataTable>

      <Pager
        page={filters.page}
        total={invoices.data?.total ?? 0}
        pageSize={filters.pageSize}
        onChange={(page) => {
          setFilters((current) => ({ ...current, page }));
        }}
      />
    </div>
  );
}

function InvoiceRow({
  invoice,
  onOpen,
}: {
  readonly invoice: InvoiceSummary;
  readonly onOpen: () => void;
}): JSX.Element {
  return (
    <Tr>
      <Td>
        <span className="font-mono text-[13px]">{invoice.invoiceNumber}</span>
      </Td>
      <Td>
        {invoice.subscriberName}
        <span className="ml-2 font-mono text-[11px] text-muted-foreground">
          {invoice.subscriberAccountNumber}
        </span>
      </Td>
      <Td className="whitespace-nowrap text-muted-foreground">
        {invoice.billingPeriodStart.slice(0, 7)}
      </Td>
      <Td className="whitespace-nowrap text-muted-foreground">{invoice.dueDate}</Td>
      <Td align="right">{formatMoney(invoice.totalCentavos)}</Td>
      <Td align="right">{formatMoney(invoice.balanceCentavos)}</Td>
      <Td>
        <div className="flex items-center gap-1.5">
          <StatusPill
            tone={invoiceStatusTone(invoice.displayStatus)}
            label={invoice.displayStatus}
          />
          {invoice.displayStatus !== invoice.status && (
            <span className="text-[10px] text-muted-foreground">{invoice.status}</span>
          )}
        </div>
      </Td>
      <Td align="right">
        <Button size="sm" onClick={onOpen}>
          Open
        </Button>
      </Td>
    </Tr>
  );
}
