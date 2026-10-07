import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS, parseCentavos } from '@bcis/shared';
import type { PaymentMethod } from '@bcis/shared';
import type { PaymentPreview, ServiceAccountSummary, SubscriberSummary } from '@bcis/validation';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@renderer/components/ui/button';
import { Alert, PageHeader, SectionCard } from '@renderer/components/ui/feedback';
import { Field, Input, Select } from '@renderer/components/ui/form';
import { DataTable, EmptyRow, Td, Th, Tr } from '@renderer/components/ui/table';
import { formatMoney } from '@renderer/lib/money';
import type { JSX } from 'react';
import { useState } from 'react';

/**
 * Receive payment.
 *
 * ── PREVIEW FIRST, AND ON PURPOSE ───────────────────────────────────────────
 * Nothing is posted until the cashier has seen the allocation the server will
 * perform. The preview and the post share one planner, so the approved
 * allocation and the written one cannot differ.
 */

export function ReceivePaymentScreen(): JSX.Element {
  const [term, setTerm] = useState('');
  const [subscriberId, setSubscriberId] = useState<number | null>(null);
  const [serviceAccountId, setServiceAccountId] = useState<number | ''>('');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [amount, setAmount] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [preview, setPreview] = useState<PaymentPreview | null>(null);
  const [receiptNumber, setReceiptNumber] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const subscribers = useQuery({
    queryKey: ['search-subscribers', term],
    queryFn: () => window.bcis.search.subscribers(term, 10),
    enabled: term.trim().length >= 2,
  });

  const accounts = useQuery({
    queryKey: ['service-accounts', subscriberId],
    queryFn: () =>
      window.bcis.serviceAccounts.list({ subscriberId: subscriberId ?? 0, page: 1, pageSize: 100 }),
    enabled: subscriberId !== null,
  });

  const needsReference = method === 'GCASH' || method === 'BANK_TRANSFER' || method === 'CHEQUE';

  function amountCentavos(): number | null {
    try {
      return parseCentavos(amount);
    } catch {
      return null;
    }
  }

  async function runPreview(): Promise<void> {
    setError(null);
    setReceiptNumber(null);
    const cents = amountCentavos();
    if (cents === null || subscriberId === null || serviceAccountId === '') {
      setError('Select a subscriber and account, and enter a valid amount.');
      return;
    }

    setBusy(true);
    const response = await window.bcis.payments.preview({
      subscriberId,
      serviceAccountId,
      paymentMethod: method,
      amountCentavos: cents,
      ...(needsReference ? { referenceNumber } : {}),
    });
    setBusy(false);

    if (!response.ok || response.item === null) {
      setError(response.error ?? 'Could not build the preview.');
      setPreview(null);
    } else {
      setPreview(response.item);
    }
  }

  async function post(): Promise<void> {
    setError(null);
    const cents = amountCentavos();
    if (cents === null || subscriberId === null || serviceAccountId === '') {
      setError('Select a subscriber and account, and enter a valid amount.');
      return;
    }

    setBusy(true);
    const response = await window.bcis.payments.create({
      subscriberId,
      serviceAccountId,
      paymentMethod: method,
      amountCentavos: cents,
      ...(needsReference ? { referenceNumber } : {}),
    });
    setBusy(false);

    if (!response.ok || response.item === null) {
      setError(response.error ?? 'The payment failed. Nothing was written.');
      return;
    }

    setPreview(null);
    setAmount('');
    setReferenceNumber('');
    setReceiptNumber(response.item.receiptNumber);
    setError(null);
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <PageHeader
        title="Receive payment"
        description="Search a subscriber, choose the account, then preview the allocation before posting."
      />

      <SectionCard title="Subscriber">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-72">
            <Field label="Search subscriber">
              {({ id }) => (
                <Input
                  id={id}
                  value={term}
                  placeholder="Name or account number"
                  onChange={(event) => {
                    setTerm(event.target.value);
                    setSubscriberId(null);
                    setServiceAccountId('');
                  }}
                />
              )}
            </Field>
          </div>
          {subscriberId !== null && (
            <div className="pb-0.5 text-sm text-muted-foreground">
              {subscribers.data?.items.find((sub) => sub.id === subscriberId)?.displayName}
            </div>
          )}
        </div>

        {subscribers.data !== undefined && subscribers.data.items.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {subscribers.data.items.map((sub) => (
              <SubscriberChip
                key={sub.id}
                subscriber={sub}
                active={sub.id === subscriberId}
                onSelect={() => {
                  setSubscriberId(sub.id);
                  setServiceAccountId('');
                }}
              />
            ))}
          </div>
        )}
      </SectionCard>

      {subscriberId !== null && (
        <SectionCard title="Service account">
          <div className="flex flex-wrap gap-2">
            {(accounts.data?.items ?? []).map((account) => (
              <AccountChip
                key={account.id}
                account={account}
                active={account.id === serviceAccountId}
                onSelect={() => {
                  setServiceAccountId(account.id);
                }}
              />
            ))}
          </div>
        </SectionCard>
      )}

      {serviceAccountId !== '' && (
        <SectionCard title="Payment">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Method">
              {({ id }) => (
                <Select
                  id={id}
                  value={method}
                  onChange={(event) => {
                    setMethod(event.target.value as PaymentMethod);
                  }}
                >
                  {PAYMENT_METHODS.map((value) => (
                    <option key={value} value={value}>
                      {PAYMENT_METHOD_LABELS[value]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field label="Amount" hint="In pesos, for example 999.00">
              {({ id, invalid }) => (
                <Input
                  id={id}
                  invalid={invalid || (amount !== '' && amountCentavos() === null)}
                  value={amount}
                  inputMode="decimal"
                  placeholder="999.00"
                  onChange={(event) => {
                    setAmount(event.target.value);
                  }}
                />
              )}
            </Field>

            {needsReference && (
              <Field label="Reference number">
                {({ id }) => (
                  <Input
                    id={id}
                    value={referenceNumber}
                    onChange={(event) => {
                      setReferenceNumber(event.target.value);
                    }}
                  />
                )}
              </Field>
            )}
          </div>

          <div className="mt-4 flex gap-2">
            <Button disabled={busy} onClick={() => void runPreview()}>
              {busy ? 'Working…' : 'Preview allocation'}
            </Button>
            <Button
              variant="primary"
              disabled={busy || preview === null}
              onClick={() => void post()}
            >
              Post payment
            </Button>
          </div>
        </SectionCard>
      )}

      {error !== null && (
        <Alert tone="danger" title="Payment not completed">
          {error}
        </Alert>
      )}

      {receiptNumber !== null && (
        <Alert tone="success" title="Payment posted">
          Receipt <span className="font-mono">{receiptNumber}</span> was issued. The ledger has been
          credited.
        </Alert>
      )}

      {preview !== null && (
        <SectionCard
          title="Allocation preview"
          description="The server will settle the oldest unpaid invoices first."
        >
          <DataTable className="border-0">
            <thead>
              <tr>
                <Th>Invoice</Th>
                <Th align="right">Allocated</Th>
              </tr>
            </thead>
            <tbody>
              {preview.allocations.length === 0 && (
                <EmptyRow colSpan={2}>
                  No open invoices — the full amount becomes account credit.
                </EmptyRow>
              )}
              {preview.allocations.map((line) => (
                <Tr key={line.invoiceId}>
                  <Td className="font-mono">{line.invoiceNumber}</Td>
                  <Td align="right">{formatMoney(line.amountCentavos)}</Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
          <div className="mt-3 flex justify-between text-sm">
            <span className="text-muted-foreground">Applied to invoices</span>
            <span className="font-medium tabular-nums">{formatMoney(preview.appliedCentavos)}</span>
          </div>
          {preview.unappliedCentavos > 0 && (
            <div className="mt-1 flex justify-between text-sm">
              <span className="text-muted-foreground">Unapplied credit</span>
              <span className="font-medium tabular-nums">
                {formatMoney(preview.unappliedCentavos)}
              </span>
            </div>
          )}
        </SectionCard>
      )}
    </div>
  );
}

function SubscriberChip({
  subscriber,
  active,
  onSelect,
}: {
  readonly subscriber: SubscriberSummary;
  readonly active: boolean;
  readonly onSelect: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`rounded-md border px-3 py-1.5 text-left text-sm transition-colors ${
        active
          ? 'border-accent bg-accent/10 text-foreground'
          : 'border-border bg-surface text-foreground hover:bg-muted'
      }`}
    >
      <div className="font-medium">{subscriber.displayName}</div>
      <div className="text-[11px] text-muted-foreground">{subscriber.accountNumber}</div>
    </button>
  );
}

function AccountChip({
  account,
  active,
  onSelect,
}: {
  readonly account: ServiceAccountSummary;
  readonly active: boolean;
  readonly onSelect: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`rounded-md border px-3 py-1.5 text-left text-sm transition-colors ${
        active
          ? 'border-accent bg-accent/10 text-foreground'
          : 'border-border bg-surface text-foreground hover:bg-muted'
      }`}
    >
      <div className="font-mono text-[13px]">{account.accountNumber}</div>
      <div className="text-[11px] text-muted-foreground">
        {account.planCode} · {formatMoney(account.currentPlanPriceCentavos)}
      </div>
    </button>
  );
}
