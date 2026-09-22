import { useQuery } from '@tanstack/react-query';
import { Alert, SectionCard } from '@renderer/components/ui/feedback';
import { Pager } from '@renderer/components/ui/pager';
import { DataTable, EmptyRow, Th, Td, Tr } from '@renderer/components/ui/table';
import { LEDGER_ENTRY_LABELS } from '@renderer/features/billing/status';
import { formatMoney } from '@renderer/lib/money';
import type { JSX } from 'react';
import { useState } from 'react';

/**
 * Subscriber ledger.
 *
 * ── THE ONE THING TO NOTICE ON THIS SCREEN ──────────────────────────────────
 * There is no stored balance anywhere behind it. Every figure in the Balance
 * column is `opening + sum(debits so far) − sum(credits so far)`, computed in
 * SQL from the entries themselves — which is why the closing balance can always
 * be recomputed and always agrees with the rows above it.
 *
 * A positive balance means the customer owes money; a negative one means the
 * customer has credit. Phase 4 exercises the debit side; payments arrive in
 * Phase 5 and appear here as credits without this screen changing.
 */
export interface SubscriberLedgerPanelProps {
  readonly subscriberId: number;
  /** Narrows the statement to one of the subscriber's accounts. */
  readonly serviceAccountId?: number | undefined;
}

export function SubscriberLedgerPanel({
  subscriberId,
  serviceAccountId,
}: SubscriberLedgerPanelProps): JSX.Element {
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const statement = useQuery({
    queryKey: ['ledger', 'subscriber', subscriberId, serviceAccountId, page],
    queryFn: () =>
      window.bcis.ledger.subscriber(subscriberId, {
        ...(serviceAccountId === undefined ? {} : { serviceAccountId }),
        page,
        pageSize,
      }),
  });

  const data = statement.data?.item ?? null;

  if (statement.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading statement…</p>;
  }

  if (statement.data?.ok === false) {
    return (
      <Alert tone="danger" title="Could not load the ledger">
        {statement.data.error ?? 'Unknown error.'}
      </Alert>
    );
  }

  if (data === null) {
    return (
      <Alert tone="info" title="No ledger entries yet">
        This account has not been charged. Generate billing for a period to create the first entry.
      </Alert>
    );
  }

  return (
    <SectionCard
      title="Statement of account"
      description="Chronological charges and credits, with the running balance they produce. Append-only."
    >
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Figure label="Opening balance" value={data.openingBalanceCentavos} />
        <Figure label="Total debits" value={data.totalDebitCentavos} />
        <Figure label="Total credits" value={data.totalCreditCentavos} />
        <Figure label="Closing balance" value={data.closingBalanceCentavos} strong />
      </div>

      <DataTable className="border-0">
        <thead>
          <tr>
            <Th>Date</Th>
            <Th>Reference</Th>
            <Th>Description</Th>
            <Th>Type</Th>
            <Th align="right">Debit</Th>
            <Th align="right">Credit</Th>
            <Th align="right">Balance</Th>
          </tr>
        </thead>
        <tbody>
          {data.entries.length === 0 && <EmptyRow colSpan={7}>No entries in this range.</EmptyRow>}

          {data.entries.map((entry) => (
            <Tr key={entry.id}>
              <Td className="whitespace-nowrap text-muted-foreground">{entry.entryDate}</Td>
              <Td>
                <span className="font-mono text-[12px]">{entry.referenceNo ?? '—'}</span>
              </Td>
              <Td className="text-muted-foreground">{entry.description}</Td>
              <Td>
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {LEDGER_ENTRY_LABELS[entry.entryType] ?? entry.entryType}
                </span>
              </Td>
              <Td align="right">
                {entry.debitCentavos === 0 ? '—' : formatMoney(entry.debitCentavos)}
              </Td>
              <Td align="right">
                {entry.creditCentavos === 0 ? '—' : formatMoney(entry.creditCentavos)}
              </Td>
              <Td align="right">{formatMoney(entry.balanceCentavos)}</Td>
            </Tr>
          ))}
        </tbody>
      </DataTable>

      <Pager
        page={page}
        total={
          data.entries.length < pageSize
            ? (page - 1) * pageSize + data.entries.length
            : page * pageSize + 1
        }
        pageSize={pageSize}
        onChange={setPage}
      />
    </SectionCard>
  );
}

function Figure({
  label,
  value,
  strong = false,
}: {
  readonly label: string;
  readonly value: number;
  readonly strong?: boolean;
}): JSX.Element {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={`mt-0.5 tabular-nums ${strong ? 'text-base font-semibold' : 'text-sm'} text-foreground`}
      >
        {formatMoney(value)}
      </p>
    </div>
  );
}
