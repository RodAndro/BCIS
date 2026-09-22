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
import { DataTable, EmptyRow, Td, Th, Tr } from '@renderer/components/ui/table';
import { formatMoney } from '@renderer/lib/money';
import type { JSX } from 'react';
import { useState } from 'react';

export function PaymentHistoryScreen(): JSX.Element {
  const [status, setStatus] = useState<string>('');
  const [method, setMethod] = useState<string>('');

  const payments = useQuery({
    queryKey: ['payments', status, method],
    queryFn: () =>
      window.bcis.payments.list({
        page: 1,
        pageSize: 100,
        ...(status === '' ? {} : { status: status as PaymentListQuery['status'] }),
        ...(method === '' ? {} : { paymentMethod: method as PaymentListQuery['paymentMethod'] }),
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
                  value={status}
                  onChange={(event) => setStatus(event.target.value)}
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
                  value={method}
                  onChange={(event) => setMethod(event.target.value)}
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
            {rows.length === 0 && <EmptyRow colSpan={7}>No payments match the selected filters.</EmptyRow>}
            {rows.map((payment) => (
              <PaymentRow key={payment.id} payment={payment} />
            ))}
          </tbody>
        </DataTable>
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
