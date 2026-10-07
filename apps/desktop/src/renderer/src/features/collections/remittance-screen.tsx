import type { RemittanceSummary } from '@bcis/validation';
import { useQuery } from '@tanstack/react-query';
import { StatusPill, type StatusTone } from '@renderer/components/status-pill';
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
              <Th>Approved by</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <EmptyRow colSpan={8}>No remittances recorded yet.</EmptyRow>}
            {rows.map((remittance) => (
              <RemittanceRow key={remittance.id} remittance={remittance} />
            ))}
          </tbody>
        </DataTable>
      </SectionCard>
    </div>
  );
}

const VARIANCE_TONES: Record<RemittanceSummary['varianceType'], StatusTone> = {
  BALANCED: 'success',
  SHORTAGE: 'danger',
  OVERAGE: 'warning',
};

const VARIANCE_LABELS: Record<RemittanceSummary['varianceType'], string> = {
  BALANCED: 'Balanced',
  SHORTAGE: 'Shortage',
  OVERAGE: 'Overage',
};

function RemittanceRow({ remittance }: { readonly remittance: RemittanceSummary }): JSX.Element {
  const hasVariance = remittance.varianceCentavos !== 0;

  return (
    <Tr>
      <Td className="font-mono text-[13px]">{remittance.batchNumber}</Td>
      <Td>{remittance.collectorName}</Td>
      <Td>{remittance.areaName}</Td>
      <Td align="right" className="font-medium">
        {formatMoney(remittance.remittedCashCentavos)}
      </Td>
      <Td align="right" className={hasVariance ? 'font-medium text-destructive tabular-nums' : ''}>
        {hasVariance ? formatMoney(remittance.varianceCentavos) : '—'}
      </Td>
      <Td>
        <StatusPill
          tone={VARIANCE_TONES[remittance.varianceType]}
          label={VARIANCE_LABELS[remittance.varianceType]}
        />
      </Td>
      <Td className="text-muted-foreground">{remittance.receivedByName ?? '—'}</Td>
      <Td className="text-muted-foreground">
        {!hasVariance ? (
          'Not required'
        ) : remittance.approvedByName !== null ? (
          remittance.approvedByName
        ) : (
          <StatusPill tone="warning" label="Pending approval" />
        )}
      </Td>
    </Tr>
  );
}
