import { ROLE_LABELS } from '@bcis/shared';
import type { CollectorSummary } from '@bcis/validation';
import { useQuery } from '@tanstack/react-query';
import { Alert, PageHeader, SectionCard } from '@renderer/components/ui/feedback';
import { DataTable, EmptyRow, Td, Th, Tr } from '@renderer/components/ui/table';
import type { JSX } from 'react';

export function CollectorsScreen(): JSX.Element {
  const collectors = useQuery({
    queryKey: ['collectors'],
    queryFn: () => window.bcis.collectors.list(),
  });

  const rows = collectors.data?.items ?? [];

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <PageHeader
        title="Collectors"
        description="Active users available to be assigned to collection routes."
      />

      {collectors.data?.ok === false && (
        <Alert tone="danger" title="Could not load collectors">
          {collectors.data.error ?? 'Unknown error.'}
        </Alert>
      )}

      <SectionCard title="Collectors">
        <DataTable className="border-0">
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Username</Th>
              <Th>Roles</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <EmptyRow colSpan={3}>No active users found.</EmptyRow>}
            {rows.map((collector) => (
              <CollectorRow key={collector.id} collector={collector} />
            ))}
          </tbody>
        </DataTable>
      </SectionCard>
    </div>
  );
}

function CollectorRow({ collector }: { readonly collector: CollectorSummary }): JSX.Element {
  return (
    <Tr>
      <Td className="font-medium">{collector.fullName}</Td>
      <Td className="font-mono text-[13px]">{collector.username}</Td>
      <Td>{collector.roles.map((role) => ROLE_LABELS[role]).join(', ')}</Td>
    </Tr>
  );
}
