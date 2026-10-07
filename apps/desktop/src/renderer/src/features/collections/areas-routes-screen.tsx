import type { CollectionAreaSummary, CollectorAssignmentSummary } from '@bcis/validation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@renderer/components/ui/button';
import { Alert, PageHeader, SectionCard } from '@renderer/components/ui/feedback';
import { Field, Input, Select } from '@renderer/components/ui/form';
import { DataTable, EmptyRow, Td, Th, Tr } from '@renderer/components/ui/table';
import type { JSX } from 'react';
import { useState } from 'react';

/**
 * Areas & Routes.
 *
 * Routes are folded into collection areas (roadmap A17): an area is the route,
 * and the active assignment tells you which collector walks it.
 */

export function AreasRoutesScreen(): JSX.Element {
  const queryClient = useQueryClient();

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [assignAreaId, setAssignAreaId] = useState<number | ''>('');
  const [collectorId, setCollectorId] = useState<number | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const areas = useQuery({
    queryKey: ['collection-areas'],
    queryFn: () => window.bcis.collectionAreas.list(),
  });
  const assignments = useQuery({
    queryKey: ['collection-assignments'],
    queryFn: () => window.bcis.collectionAssignments.list(),
  });
  const collectors = useQuery({
    queryKey: ['collectors'],
    queryFn: () => window.bcis.collectors.list(),
  });

  const assignmentFor = (areaId: number): CollectorAssignmentSummary | undefined =>
    assignments.data?.items.find((assignment) => assignment.collectionAreaId === areaId);

  async function createArea(): Promise<void> {
    setError(null);
    setBusy(true);
    const response = await window.bcis.collectionAreas.create({ code, name, isActive: true });
    setBusy(false);

    if (!response.ok) {
      setError(response.error ?? 'Could not create the area.');
      return;
    }
    setCode('');
    setName('');
    void queryClient.invalidateQueries({ queryKey: ['collection-areas'] });
  }

  async function assign(): Promise<void> {
    if (assignAreaId === '' || collectorId === '') return;
    setError(null);
    setBusy(true);
    const response = await window.bcis.collectionAssignments.assign(assignAreaId, {
      collectorUserId: collectorId,
      effectiveFrom: new Date().toISOString().slice(0, 10),
    });
    setBusy(false);

    if (!response.ok) {
      setError(response.error ?? 'Could not assign the collector.');
      return;
    }
    setAssignAreaId('');
    setCollectorId('');
    void queryClient.invalidateQueries({ queryKey: ['collection-assignments'] });
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <PageHeader
        title="Areas & Routes"
        description="Collection areas and the collector currently assigned to each."
      />

      {error !== null && (
        <Alert tone="danger" title="Change not saved">
          {error}
        </Alert>
      )}

      <SectionCard title="Areas">
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="w-40">
            <Field label="Code">
              {({ id }) => (
                <Input id={id} value={code} onChange={(event) => setCode(event.target.value)} />
              )}
            </Field>
          </div>
          <div className="w-64">
            <Field label="Name">
              {({ id }) => (
                <Input id={id} value={name} onChange={(event) => setName(event.target.value)} />
              )}
            </Field>
          </div>
          <Button
            disabled={busy || code.trim().length < 2 || name.trim().length === 0}
            onClick={() => void createArea()}
          >
            Add area
          </Button>
        </div>

        <DataTable className="border-0">
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>Name</Th>
              <Th>Collector</Th>
              <Th align="right">Subscribers</Th>
            </tr>
          </thead>
          <tbody>
            {(areas.data?.items ?? []).length === 0 && (
              <EmptyRow colSpan={4}>No collection areas yet.</EmptyRow>
            )}
            {(areas.data?.items ?? []).map((area) => (
              <AreaRow key={area.id} area={area} assignment={assignmentFor(area.id)} />
            ))}
          </tbody>
        </DataTable>
      </SectionCard>

      <SectionCard title="Assign a collector">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-56">
            <Field label="Area">
              {({ id }) => (
                <Select
                  id={id}
                  value={assignAreaId}
                  onChange={(event) => setAssignAreaId(Number(event.target.value))}
                >
                  <option value="">Select an area</option>
                  {(areas.data?.items ?? []).map((area) => (
                    <option key={area.id} value={area.id}>
                      {area.code} — {area.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <div className="w-56">
            <Field label="Collector">
              {({ id }) => (
                <Select
                  id={id}
                  value={collectorId}
                  onChange={(event) => setCollectorId(Number(event.target.value))}
                >
                  <option value="">Select a collector</option>
                  {(collectors.data?.items ?? []).map((collector) => (
                    <option key={collector.id} value={collector.id}>
                      {collector.fullName}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Button
            disabled={busy || assignAreaId === '' || collectorId === ''}
            onClick={() => void assign()}
          >
            Assign
          </Button>
        </div>
      </SectionCard>
    </div>
  );
}

function AreaRow({
  area,
  assignment,
}: {
  readonly area: CollectionAreaSummary;
  readonly assignment: CollectorAssignmentSummary | undefined;
}): JSX.Element {
  return (
    <Tr>
      <Td className="font-mono text-[13px]">{area.code}</Td>
      <Td className="font-medium">{area.name}</Td>
      <Td>{assignment?.collectorName ?? 'Unassigned'}</Td>
      <Td align="right">{area.subscriberCount}</Td>
    </Tr>
  );
}
