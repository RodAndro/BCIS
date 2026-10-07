import type { PaymentListQuery, PaymentSummary } from '@bcis/validation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@renderer/components/ui/button';
import { Alert, EmptyState, PageHeader, SectionCard } from '@renderer/components/ui/feedback';
import { Field, Input, Textarea } from '@renderer/components/ui/form';
import { DEFAULT_PAGE_SIZE, Pager } from '@renderer/components/ui/pager';
import { DataTable, EmptyRow, Td, Th, Tr } from '@renderer/components/ui/table';
import { formatMoney } from '@renderer/lib/money';
import { cn } from '@renderer/lib/utils';
import type { JSX } from 'react';
import { useState } from 'react';

/**
 * GCash verification queue.
 *
 * A GCash or bank payment enters `PENDING_VERIFICATION` at capture and posts
 * only when a person confirms the money arrived. This screen is that person.
 *
 * ── THE TWO PANES ───────────────────────────────────────────────────────────
 * The queue stays on the left while the decision is made on the right, because
 * a verifier works through the list in one pass — a modal per payment would hide
 * the queue between every decision. It is the same shape the roadmap specifies.
 *
 * Everything else here is deliberately the shared kit: the same filter row,
 * table, pager, form controls, and empty states as every other list, so this
 * screen reads as part of the application rather than beside it.
 */

/** Below this, the API refuses a rejection. Mirrored here so the button agrees. */
const MIN_REJECTION_REASON = 10;

interface Filters {
  readonly search: string;
  readonly page: number;
  readonly pageSize: number;
}

export function GcashVerificationScreen(): JSX.Element {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<Filters>({
    search: '',
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
  });
  const [selected, setSelected] = useState<PaymentSummary | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const queue = useQuery({
    queryKey: ['payments-pending', filters],
    queryFn: () =>
      window.bcis.payments.pending({
        page: filters.page,
        pageSize: filters.pageSize,
        ...(filters.search.length === 0 ? {} : { search: filters.search }),
      } satisfies Partial<PaymentListQuery>),
  });

  const rows = queue.data?.items ?? [];

  async function decide(approve: boolean): Promise<void> {
    if (selected === null) return;
    setBusy(true);
    setError(null);
    setMessage(null);

    const label = selected.referenceNumber ?? `#${String(selected.id)}`;

    const response = await window.bcis.payments.verify(selected.id, {
      approve,
      ...(approve ? {} : { rejectionReason: reason }),
    });

    setBusy(false);
    if (!response.ok) {
      setError(response.error ?? 'The decision failed.');
      return;
    }

    setMessage(
      approve
        ? `Payment ${label} approved and posted.`
        : `Payment ${label} rejected and left unposted.`,
    );
    setSelected(null);
    setReason('');
    void queryClient.invalidateQueries({ queryKey: ['payments-pending'] });
    void queryClient.invalidateQueries({ queryKey: ['payments'] });
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <PageHeader
        title="GCash verification"
        description="Confirm or reject payments awaiting proof review. A payment posts only once someone confirms the money arrived."
      />

      {error !== null && (
        <Alert tone="danger" title="Decision not recorded">
          {error}
        </Alert>
      )}
      {message !== null && (
        <Alert tone="success" title="Decision recorded">
          {message}
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <SectionCard
            title="Verification queue"
            description="GCash and bank payments captured with a reference number, oldest first."
            actions={
              <div className="w-60">
                <Input
                  aria-label="Search the queue"
                  placeholder="Reference, sender, or subscriber"
                  value={filters.search}
                  onChange={(event) => {
                    setFilters((current) => ({
                      ...current,
                      search: event.target.value,
                      page: 1,
                    }));
                  }}
                />
              </div>
            }
          >
            {queue.data?.ok === false && (
              <Alert tone="danger" title="Could not load the verification queue">
                {queue.data.error ?? 'Unknown error.'}
              </Alert>
            )}

            <DataTable className="border-0">
              <thead>
                <tr>
                  <Th>Reference</Th>
                  <Th>Sender</Th>
                  <Th>Subscriber</Th>
                  <Th align="right">Amount</Th>
                  <Th>Captured</Th>
                  <Th align="right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {queue.isLoading && <EmptyRow colSpan={6}>Loading…</EmptyRow>}

                {!queue.isLoading && rows.length === 0 && (
                  <EmptyRow colSpan={6}>
                    {filters.search.length === 0
                      ? 'Nothing is awaiting verification.'
                      : 'No queued payment matches that search.'}
                  </EmptyRow>
                )}

                {rows.map((payment) => {
                  const isSelected = selected?.id === payment.id;
                  return (
                    <Tr key={payment.id} className={cn(isSelected && 'bg-accent/5')}>
                      <Td className="font-mono">{payment.referenceNumber ?? '—'}</Td>
                      <Td>
                        {payment.senderName ?? '—'}
                        {payment.senderMobile !== null && (
                          <div className="text-[11px] text-muted-foreground">
                            {payment.senderMobile}
                          </div>
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
                        <Button
                          size="sm"
                          variant={isSelected ? 'primary' : 'secondary'}
                          aria-pressed={isSelected}
                          onClick={() => {
                            setSelected(payment);
                            setReason('');
                            setMessage(null);
                          }}
                        >
                          Review
                        </Button>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </DataTable>

            <Pager
              className="mt-4"
              page={filters.page}
              pageSize={filters.pageSize}
              total={queue.data?.total ?? 0}
              onChange={(page) => {
                setFilters((current) => ({ ...current, page }));
              }}
              onPageSizeChange={(pageSize) => {
                setFilters((current) => ({ ...current, pageSize, page: 1 }));
              }}
            />
          </SectionCard>
        </div>

        <div className="min-w-0">
          <SectionCard
            title="Decision"
            description={
              selected === null ? undefined : (selected.referenceNumber ?? 'No reference number')
            }
          >
            {selected === null ? (
              <EmptyState
                title="Nothing selected"
                description="Choose Review on a queued payment to see its details and record a decision."
              />
            ) : (
              <div className="flex flex-col gap-4">
                <dl className="space-y-2 text-sm">
                  <Detail label="Reference" value={selected.referenceNumber ?? '—'} mono />
                  <Detail label="Sender" value={selected.senderName ?? '—'} />
                  <Detail label="Sender mobile" value={selected.senderMobile ?? '—'} mono />
                  <Detail label="Amount" value={formatMoney(selected.amountCentavos)} />
                  <Detail label="Subscriber" value={selected.subscriberName} />
                  <Detail label="Account" value={selected.serviceAccountNumber} mono />
                  <Detail
                    label="Captured"
                    value={new Date(selected.paymentDate).toLocaleString()}
                  />
                </dl>

                <Field
                  label="Rejection reason"
                  hint={`Required to reject — at least ${String(MIN_REJECTION_REASON)} characters.`}
                >
                  {({ id, invalid }) => (
                    <Textarea
                      id={id}
                      rows={3}
                      placeholder="Why is this payment being rejected?"
                      value={reason}
                      invalid={invalid}
                      onChange={(event) => {
                        setReason(event.target.value);
                      }}
                    />
                  )}
                </Field>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="danger"
                    disabled={busy || reason.trim().length < MIN_REJECTION_REASON}
                    onClick={() => {
                      void decide(false);
                    }}
                  >
                    {busy ? 'Recording…' : 'Reject'}
                  </Button>
                  <Button
                    variant="primary"
                    disabled={busy}
                    onClick={() => {
                      void decide(true);
                    }}
                  >
                    {busy ? 'Recording…' : 'Approve and post'}
                  </Button>
                </div>
              </div>
            )}
          </SectionCard>
        </div>
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
      <dd className={`text-right ${mono ? 'font-mono text-[13px]' : 'font-medium'}`}>{value}</dd>
    </div>
  );
}
