import type { SubscriberSummary } from '@bcis/validation';
import { useQuery } from '@tanstack/react-query';
import { StatusPill, type StatusTone } from '@renderer/components/status-pill';
import { Button } from '@renderer/components/ui/button';
import { Alert, PageHeader } from '@renderer/components/ui/feedback';
import { Input, Select } from '@renderer/components/ui/form';
import { Pager } from '@renderer/components/ui/pager';
import { DataTable, EmptyRow, Th, Td, Tr } from '@renderer/components/ui/table';
import { useAuth } from '@renderer/features/auth/auth-context';
import {
  useCollectionAreas,
  useSearchProviders,
} from '@renderer/features/subscribers/use-reference-data';
import type { JSX } from 'react';
import { useState } from 'react';

/**
 * Subscriber list.
 *
 * ── SEARCH IS SERVER-SIDE AND PROVIDER-DRIVEN ───────────────────────────────
 * The search box sends one term to the API, which matches it across every
 * registered provider — account number, name, contact, address today; invoice,
 * receipt, and GCash reference in later phases. The hint above the box is served
 * by the API rather than written here, so it stays true as providers are added.
 *
 * Nothing is filtered or sorted in the browser: the page size is capped at 200
 * by the API and the totals come from SQL, which is what keeps a 20,000-row
 * subscriber table from being loaded into the renderer.
 */

interface Filters {
  readonly search: string;
  readonly status: '' | 'ACTIVE' | 'INACTIVE' | 'TERMINATED' | 'ARCHIVED';
  readonly collectionAreaId: string;
  readonly page: number;
  readonly pageSize: number;
}

export interface SubscriberListScreenProps {
  readonly onOpen: (subscriberId: number) => void;
  readonly onNew: () => void;
}

export function SubscriberListScreen({ onOpen, onNew }: SubscriberListScreenProps): JSX.Element {
  const { can } = useAuth();
  const areas = useCollectionAreas();
  const providers = useSearchProviders();

  const [filters, setFilters] = useState<Filters>({
    search: '',
    status: '',
    collectionAreaId: '',
    page: 1,
    pageSize: 25,
  });

  const subscribers = useQuery({
    queryKey: ['subscribers', filters],
    queryFn: () =>
      window.bcis.subscribers.list({
        search: filters.search.length > 0 ? filters.search : undefined,
        status: filters.status === '' ? undefined : filters.status,
        collectionAreaId:
          filters.collectionAreaId === '' ? undefined : Number(filters.collectionAreaId),
        page: filters.page,
        pageSize: filters.pageSize,
      }),
  });

  const items = subscribers.data?.items ?? [];
  const searchHint =
    providers.data?.items.map((provider) => provider.label).join(', ') ??
    'account number, name, contact, address';

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHeader
        title="Subscribers"
        description="Every customer account, with how many services each one holds."
        actions={
          can('subscriber.create') ? (
            <Button variant="primary" onClick={onNew}>
              New subscriber
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-72">
          <Input
            placeholder="Search subscribers"
            value={filters.search}
            onChange={(event) => {
              setFilters((current) => ({ ...current, search: event.target.value, page: 1 }));
            }}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">Searches: {searchHint}</p>
        </div>

        <div className="w-40">
          <Select
            aria-label="Status"
            value={filters.status}
            onChange={(event) => {
              setFilters((current) => ({
                ...current,
                status: event.target.value as Filters['status'],
                page: 1,
              }));
            }}
          >
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="TERMINATED">Terminated</option>
            <option value="ARCHIVED">Archived</option>
          </Select>
        </div>

        <div className="w-48">
          <Select
            aria-label="Collection area"
            value={filters.collectionAreaId}
            onChange={(event) => {
              setFilters((current) => ({
                ...current,
                collectionAreaId: event.target.value,
                page: 1,
              }));
            }}
          >
            <option value="">All areas</option>
            {(areas.data?.items ?? []).map((area) => (
              <option key={area.id} value={String(area.id)}>
                {area.name}
              </option>
            ))}
          </Select>
        </div>

        <Button
          onClick={() => {
            setFilters({
              search: '',
              status: '',
              collectionAreaId: '',
              page: 1,
              pageSize: filters.pageSize,
            });
          }}
        >
          Clear
        </Button>

        <span className="ml-auto text-xs text-muted-foreground">
          {subscribers.data === undefined ? '' : `${String(subscribers.data.total)} subscriber(s)`}
        </span>
      </div>

      {subscribers.data?.ok === false && (
        <Alert tone="danger" title="Could not load subscribers">
          {subscribers.data.error ?? 'Unknown error.'}
        </Alert>
      )}

      <DataTable>
        <thead>
          <tr>
            <Th>Account</Th>
            <Th>Name</Th>
            <Th>Contact</Th>
            <Th>Area</Th>
            <Th align="right">Services</Th>
            <Th>Billing / Due</Th>
            <Th>Status</Th>
            <Th align="right">Actions</Th>
          </tr>
        </thead>
        <tbody>
          {subscribers.isLoading && <EmptyRow colSpan={8}>Loading…</EmptyRow>}

          {!subscribers.isLoading && items.length === 0 && (
            <EmptyRow colSpan={8}>
              No subscribers match this filter. Try a partial account number or name.
            </EmptyRow>
          )}

          {items.map((subscriber) => (
            <SubscriberRow
              key={subscriber.id}
              subscriber={subscriber}
              onOpen={() => {
                onOpen(subscriber.id);
              }}
            />
          ))}
        </tbody>
      </DataTable>

      <Pager
        page={filters.page}
        total={subscribers.data?.total ?? 0}
        pageSize={filters.pageSize}
        onChange={(page) => {
          setFilters((current) => ({ ...current, page }));
        }}
      />
    </div>
  );
}

function SubscriberRow({
  subscriber,
  onOpen,
}: {
  readonly subscriber: SubscriberSummary;
  readonly onOpen: () => void;
}): JSX.Element {
  return (
    <Tr>
      <Td>
        <span className="font-mono text-[13px]">{subscriber.accountNumber}</span>
      </Td>
      <Td>{subscriber.displayName}</Td>
      <Td className="font-mono text-[12px]">{subscriber.primaryContact ?? '—'}</Td>
      <Td className="text-muted-foreground">{subscriber.collectionAreaName ?? '—'}</Td>
      <Td align="right">
        {subscriber.serviceCount === 0
          ? '—'
          : `${String(subscriber.activeServiceCount)} / ${String(subscriber.serviceCount)}`}
      </Td>
      <Td className="text-muted-foreground">
        {subscriber.billingDay} / {subscriber.dueDay}
      </Td>
      <Td>
        <SubscriberStatusPill subscriber={subscriber} />
      </Td>
      <Td align="right">
        <Button size="sm" onClick={onOpen}>
          Open
        </Button>
      </Td>
    </Tr>
  );
}

/** Shared by the list and the profile header. */
export function SubscriberStatusPill({
  subscriber,
}: {
  readonly subscriber: SubscriberSummary;
}): JSX.Element {
  const tones: Record<string, StatusTone> = {
    ACTIVE: 'success',
    INACTIVE: 'warning',
    TERMINATED: 'danger',
    ARCHIVED: 'neutral',
  };

  return <StatusPill tone={tones[subscriber.status] ?? 'neutral'} label={subscriber.status} />;
}
