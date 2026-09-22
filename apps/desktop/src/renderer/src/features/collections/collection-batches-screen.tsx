import type { CollectionBatchDetail } from '@bcis/validation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@renderer/components/ui/button';
import { Alert, PageHeader, SectionCard } from '@renderer/components/ui/feedback';
import { DataTable, EmptyRow, Td, Th, Tr } from '@renderer/components/ui/table';
import { formatMoney } from '@renderer/lib/money';
import type { JSX } from 'react';
import { useState } from 'react';

const BATCH_STATUS_LABELS: Record<string, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  SUBMITTED: 'Submitted',
  REMITTED: 'Remitted',
  RECONCILED: 'Reconciled',
  CLOSED: 'Closed',
};

export function CollectionBatchesScreen(): JSX.Element {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const batches = useQuery({
    queryKey: ['collection-batches'],
    queryFn: () => window.bcis.collectionBatches.list({ page: 1, pageSize: 100 }),
  });
  const detail = useQuery({
    queryKey: ['collection-batch', selectedId],
    queryFn: () => window.bcis.collectionBatches.get(selectedId ?? 0),
    enabled: selectedId !== null,
  });

  const rows = batches.data?.items ?? [];

  async function action(
    run: () => Promise<{ ok: boolean; error: string | null }>,
    key: string,
  ): Promise<void> {
    setBusy(true);
    setError(null);
    const result = await run();
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? 'The action failed.');
      return;
    }
    void queryClient.invalidateQueries({ queryKey: [key] });
    void queryClient.invalidateQueries({ queryKey: ['collection-batches'] });
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <PageHeader
        title="Collection batches"
        description="Route batches, their collection lifecycle, and reconciliation."
      />

      {error !== null && (
        <Alert tone="danger" title="Action failed">
          {error}
        </Alert>
      )}

      <SectionCard title="Batches">
        <DataTable className="border-0">
          <thead>
            <tr>
              <Th>Batch</Th>
              <Th>Collector</Th>
              <Th>Area</Th>
              <Th>Status</Th>
              <Th align="right">Expected</Th>
              <Th align="right">Collected</Th>
              <Th align="right">Remitted</Th>
              <Th>Date</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <EmptyRow colSpan={8}>No collection batches yet.</EmptyRow>}
            {rows.map((batch) => (
              <Tr key={batch.id}>
                <Td>
                  <button
                    type="button"
                    className="font-mono text-[13px] text-accent hover:underline"
                    onClick={() => setSelectedId(batch.id === selectedId ? null : batch.id)}
                  >
                    {batch.batchNumber}
                  </button>
                </Td>
                <Td>{batch.collectorName}</Td>
                <Td>{batch.areaName}</Td>
                <Td>{BATCH_STATUS_LABELS[batch.status] ?? batch.status}</Td>
                <Td align="right">{formatMoney(batch.expectedReceivableCentavos)}</Td>
                <Td align="right">{formatMoney(batch.cashCollectedCentavos)}</Td>
                <Td align="right">{formatMoney(batch.remittedCashCentavos)}</Td>
                <Td className="whitespace-nowrap text-muted-foreground">{batch.batchDate}</Td>
              </Tr>
            ))}
          </tbody>
        </DataTable>
      </SectionCard>

      {detail.data?.item !== undefined && detail.data.item !== null && (
        <BatchDetail
          batch={detail.data.item}
          busy={busy}
          onAction={action}
        />
      )}
    </div>
  );
}

function BatchDetail({
  batch,
  busy,
  onAction,
}: {
  readonly batch: CollectionBatchDetail;
  readonly busy: boolean;
  readonly onAction: (
    run: () => Promise<{ ok: boolean; error: string | null }>,
    key: string,
  ) => Promise<void>;
}): JSX.Element {
  const lifecycle = batch.status;

  return (
    <SectionCard
      title={batch.batchNumber}
      description={`${batch.collectorName} · ${batch.areaName} · ${batch.batchDate}`}
      actions={
        <div className="flex gap-2">
          {(lifecycle === 'OPEN') && (
            <Button size="sm" disabled={busy} onClick={() => void onAction(() => window.bcis.collectionBatches.start(batch.id), 'collection-batches')}>
              Start
            </Button>
          )}
          {(lifecycle === 'OPEN' || lifecycle === 'IN_PROGRESS') && (
            <Button size="sm" disabled={busy} onClick={() => void onAction(() => window.bcis.collectionBatches.submit(batch.id, { cashCollectedCentavos: batch.cashCollectedCentavos, nonCashCollectedCentavos: batch.nonCashCollectedCentavos, uncollectedCentavos: batch.uncollectedCentavos }), 'collection-batches')}>
              Submit
            </Button>
          )}
        </div>
      }
    >
      <DataTable className="border-0">
        <thead>
          <tr>
            <Th>Account</Th>
            <Th>Subscriber</Th>
            <Th align="right">Expected</Th>
            <Th align="right">Collected</Th>
            <Th>Outcome</Th>
          </tr>
        </thead>
        <tbody>
          {batch.accounts.length === 0 && <EmptyRow colSpan={5}>No accounts on this batch.</EmptyRow>}
          {batch.accounts.map((account) => (
            <Tr key={account.serviceAccountId}>
              <Td className="font-mono text-[13px]">{account.accountNumber}</Td>
              <Td>{account.subscriberName}</Td>
              <Td align="right">{formatMoney(account.expectedAmountCentavos)}</Td>
              <Td align="right">{formatMoney(account.collectedAmountCentavos)}</Td>
              <Td>{account.outcome.replaceAll('_', ' ')}</Td>
            </Tr>
          ))}
        </tbody>
      </DataTable>
    </SectionCard>
  );
}
