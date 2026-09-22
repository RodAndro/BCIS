import type { PaymentSummary } from '@bcis/validation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@renderer/components/ui/button';
import { Alert, PageHeader, SectionCard } from '@renderer/components/ui/feedback';
import { DataTable, EmptyRow, Td, Th, Tr } from '@renderer/components/ui/table';
import { formatMoney } from '@renderer/lib/money';
import type { JSX } from 'react';
import { useState } from 'react';

/**
 * GCash verification queue.
 *
 * A GCash or bank payment enters `PENDING_VERIFICATION` at capture and posts
 * only when a person confirms the money arrived. This screen is that person.
 */

export function GcashVerificationScreen(): JSX.Element {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<PaymentSummary | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const queue = useQuery({
    queryKey: ['payments-pending'],
    queryFn: () => window.bcis.payments.pending(),
  });

  const rows = queue.data?.items ?? [];

  async function decide(approve: boolean): Promise<void> {
    if (selected === null) return;
    setBusy(true);
    setError(null);

    const response = await window.bcis.payments.verify(selected.id, {
      approve,
      ...(approve ? {} : { rejectionReason: reason }),
    });

    setBusy(false);
    if (!response.ok) {
      setError(response.error ?? 'The decision failed.');
      return;
    }

    setSelected(null);
    setReason('');
    void queryClient.invalidateQueries({ queryKey: ['payments-pending'] });
    void queryClient.invalidateQueries({ queryKey: ['payments'] });
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHeader
        title="GCash verification"
        description="Confirm or reject payments that are awaiting proof review."
      />

      {error !== null && (
        <Alert tone="danger" title="Decision not recorded">
          {error}
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SectionCard title="Verification queue">
            <DataTable className="border-0">
              <thead>
                <tr>
                  <Th>Reference</Th>
                  <Th>Sender</Th>
                  <Th>Subscriber</Th>
                  <Th align="right">Amount</Th>
                  <Th>Captured</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && <EmptyRow colSpan={6}>Nothing awaiting verification.</EmptyRow>}
                {rows.map((payment) => (
                  <Tr key={payment.id}>
                    <Td className="font-mono">{payment.referenceNumber ?? '—'}</Td>
                    <Td>
                      {payment.senderName ?? '—'}
                      {payment.senderMobile !== null && (
                        <div className="text-[11px] text-muted-foreground">{payment.senderMobile}</div>
                      )}
                    </Td>
                    <Td>
                      {payment.subscriberName}
                      <div className="text-[11px] text-muted-foreground">
                        {payment.subscriberAccountNumber}
                      </div>
                    </Td>
                    <Td align="right" className="font-medium">
                      {formatMoney(payment.amountCentavos)}
                    </Td>
                    <Td className="whitespace-nowrap text-muted-foreground">
                      {new Date(payment.paymentDate).toLocaleDateString()}
                    </Td>
                    <Td align="right">
                      <Button size="sm" variant="ghost" onClick={() => setSelected(payment)}>
                        Review
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </DataTable>
          </SectionCard>
        </div>

        {selected !== null && (
          <SectionCard title="Decision">
            <dl className="space-y-2 text-sm">
              <Detail label="Reference" value={selected.referenceNumber ?? '—'} mono />
              <Detail
                label="Sender"
                value={selected.senderName ?? '—'}
              />
              <Detail label="Amount" value={formatMoney(selected.amountCentavos)} />
              <Detail label="Account" value={selected.serviceAccountNumber} mono />
            </dl>

            <label className="mt-4 block text-xs font-medium">Rejection reason (required to reject)</label>
            <textarea
              className="mt-1 w-full rounded-md border border-input bg-surface px-2.5 py-1.5 text-sm"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />

            <div className="mt-3 flex gap-2">
              <Button
                variant="danger"
                disabled={busy || reason.trim().length < 10}
                onClick={() => void decide(false)}
              >
                Reject
              </Button>
              <Button variant="primary" disabled={busy} onClick={() => void decide(true)}>
                Approve
              </Button>
            </div>
          </SectionCard>
        )}
      </div>
    </div>
  );
}

function Detail({
  label,
  value,
  mono = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
}): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? 'font-mono text-[13px]' : 'font-medium'}>{value}</dd>
    </div>
  );
}
