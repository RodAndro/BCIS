import type { RemittanceSummary } from '@bcis/validation';
import { useQuery } from '@tanstack/react-query';
import { Alert, PageHeader, SectionCard } from '@renderer/components/ui/feedback';
import { DataTable, EmptyRow, Td, Th, Tr } from '@renderer/components/ui/table';
import { formatMoney } from '@renderer/lib/money';
import type { JSX } from 'react';

export function RemittanceScreen(): JSX.Element {
  const remittances = useQuery({
    queryKey: ['collection-remittances'],
    queryFn: () => window.bcis.collectionRemittances.list(),
  });

  const rows = remittances.data?.items ?? [];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHeader
        title="Remittance"
        description="Cash remitted by collectors against their collection batches."
      />

      {remittances.data?.ok === false && (
        <Alert tone="danger" title="Could not load remittances">
          {remittances.data.error ?? 'Unknown error.'}
        </Alert>
      )}

      <SectionCard title="Remittances">
        <DataTable className="border-0">
          <thead>
            <tr>
              <Th>Batch</Th>
              <Th>Collector</Th>
              <Th>Area</Th>
              <Th align="right">Remitted</Th>
              <Th align="right">Variance</Th>
              <Th>Result</Th>
              <Th>Received by</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <EmptyRow colSpan={7}>No remittances recorded yet.</EmptyRow>}
            {rows.map((remittance) => (
              <RemittanceRow key={remittance.id} remittance={remittance} />
            ))}
          </tbody>
        </DataTable>
      </SectionCard>
    </div>
  );
}

function RemittanceRow({ remittance }: { readonly remittance: RemittanceSummary }): JSX.Element {
  const varianceLabel =
    remittance.varianceType === 'BALANCED'
      ? 'Balanced'
      : remittance.varianceType === 'SHORTAGE'
        ? 'Shortage'
        : 'Overage';

  return (
    <Tr>
      <Td className="font-mono text-[13px]">{remittance.batchNumber}</Td>
      <Td>{remittance.collectorName}</Td>
      <Td>{remittance.areaName}</Td>
      <Td align="right" className="font-medium">
        {formatMoney(remittance.remittedCashCentavos)}
      </Td>
      <Td align="right">
        {remittance.varianceCentavos === 0
          ? '—'
          : formatMoney(remittance.varianceCentavos)}
      </Td>
      <Td>{varianceLabel}</Td>
      <Td className="text-muted-foreground">{remittance.receivedByName ?? '—'}</Td>
    </Tr>
  );
}
