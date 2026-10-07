import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUSES,
  PAYMENT_STATUS_LABELS,
} from '@bcis/shared';
import type { PaymentListQuery, PaymentSummary } from '@bcis/validation';
import { useQuery } from '@tanstack/react-query';
import { Alert, PageHeader, SectionCard } from '@renderer/components/ui/feedback';
import { Field, Select } from '@renderer/components/ui/form';
import { DEFAULT_PAGE_SIZE, Pager } from '@renderer/components/ui/pager';
import { DataTable, EmptyRow, Td, Th, Tr } from '@renderer/components/ui/table';
import { formatMoney } from '@renderer/lib/money';
import type { JSX } from 'react';
import { useState } from 'react';

interface Filters {
  readonly status: string;
  readonly method: string;
  readonly page: number;
  readonly pageSize: number;
}

export function PaymentHistoryScreen(): JSX.Element {
  const [filters, setFilters] = useState<Filters>({
    status: '',
    method: '',
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
  });

  const payments = useQuery({
    queryKey: ['payments', filters],
    queryFn: () =>
      window.bcis.payments.list({
        page: filters.page,
        pageSize: filters.pageSize,
        ...(filters.status === '' ? {} : { status: filters.status as PaymentListQuery['status'] }),
        ...(filters.method === ''
          ? {}
          : { paymentMethod: filters.method as PaymentListQuery['paymentMethod'] }),
      }),
  });

  const rows = payments.data?.items ?? [];

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <PageHeader
        title="Payment history"
        description="Every payment captured, verified, and reversed, newest first."
      />

      <SectionCard
        title="Payments"
        actions={
          <div className="flex gap-2">
            <Field label="Status">
              {({ id }) => (
                <Select
                  id={id}
                  className="h-8 w-44 text-xs"
                  value={filters.status}
                  onChange={(event) => {
                    setFilters((current) => ({
                      ...current,
                      status: event.target.value,
                      page: 1,
                    }));
                  }}
                >
                  <option value="">All statuses</option>
                  {PAYMENT_STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {PAYMENT_STATUS_LABELS[value]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Method">
              {({ id }) => (
                <Select
                  id={id}
                  className="h-8 w-40 text-xs"
                  value={filters.method}
                  onChange={(event) => {
                    setFilters((current) => ({
                      ...current,
                      method: event.target.value,
                      page: 1,
                    }));
                  }}
                >
                  <option value="">All methods</option>
                  {PAYMENT_METHODS.map((value) => (
                    <option key={value} value={value}>
                      {PAYMENT_METHOD_LABELS[value]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        }
      >
        {payments.data?.ok === false && (
          <Alert tone="danger" title="Could not load payments">
            {payments.data.error ?? 'Unknown error.'}
          </Alert>
        )}

        <DataTable className="border-0">
          <thead>
            <tr>
              <Th>Receipt</Th>
              <Th>Subscriber</Th>
              <Th>Account</Th>
              <Th>Method</Th>
              <Th>Status</Th>
              <Th align="right">Amount</Th>
              <Th>Date</Th>
            </tr>
          </thead>
          <tbody>
            {payments.isLoading && <EmptyRow colSpan={7}>Loading…</EmptyRow>}

            {!payments.isLoading && rows.length === 0 && (
              <EmptyRow colSpan={7}>No payments match the selected filters.</EmptyRow>
            )}

            {rows.map((payment) => (
              <PaymentRow key={payment.id} payment={payment} />
            ))}
          </tbody>
        </DataTable>

        <Pager
          className="mt-4"
          page={filters.page}
          pageSize={filters.pageSize}
          total={payments.data?.total ?? 0}
          onChange={(page) => {
            setFilters((current) => ({ ...current, page }));
          }}
          onPageSizeChange={(pageSize) => {
            setFilters((current) => ({ ...current, pageSize, page: 1 }));
          }}
        />
      </SectionCard>
    </div>
  );
}

function PaymentRow({ payment }: { readonly payment: PaymentSummary }): JSX.Element {
  return (
    <Tr>
      <Td className="font-mono">{payment.receiptNumber ?? '—'}</Td>
      <Td>
        {payment.subscriberName}
        <div className="text-[11px] text-muted-foreground">{payment.subscriberAccountNumber}</div>
      </Td>
      <Td className="font-mono text-[13px]">{payment.serviceAccountNumber}</Td>
      <Td>{PAYMENT_METHOD_LABELS[payment.paymentMethod]}</Td>
      <Td>{PAYMENT_STATUS_LABELS[payment.status]}</Td>
      <Td align="right" className="font-medium">
        {formatMoney(payment.amountCentavos)}
      </Td>
      <Td className="whitespace-nowrap text-muted-foreground">
        {new Date(payment.paymentDate).toLocaleDateString()}
      </Td>
    </Tr>
  );
}
