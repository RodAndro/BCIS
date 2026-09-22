import { SERVICE_ACCOUNT_STATUS_LABELS, type ServiceAccountStatus } from '@bcis/shared';
import { useQuery } from '@tanstack/react-query';
import { StatusPill } from '@renderer/components/status-pill';
import { Button } from '@renderer/components/ui/button';
import { Alert, PageHeader } from '@renderer/components/ui/feedback';
import { Input, Select } from '@renderer/components/ui/form';
import { Pager } from '@renderer/components/ui/pager';
import { DataTable, EmptyRow, Th, Td, Tr } from '@renderer/components/ui/table';
import { statusTone } from '@renderer/features/subscribers/service-account-manage-dialog';
import { ServiceAccountManageDialog } from '@renderer/features/subscribers/service-account-manage-dialog';
import { formatMoney } from '@renderer/lib/money';
import type { JSX } from 'react';
import { useState } from 'react';

/**
 * All service accounts.
 *
 * The operational view: what is active, suspended, or closed, and what each one
 * is charged. Rows open the subscriber profile, because an account on its own
 * is rarely the thing being asked about.
 */

interface Filters {
  readonly search: string;
  readonly status: '' | ServiceAccountStatus;
  readonly serviceType: '' | 'INTERNET' | 'CABLE' | 'COMBO';
  readonly page: number;
  readonly pageSize: number;
}

export interface ServiceAccountListScreenProps {
  readonly onOpenSubscriber: (subscriberId: number) => void;
}

export function ServiceAccountListScreen({
  onOpenSubscriber,
}: ServiceAccountListScreenProps): JSX.Element {
  const [filters, setFilters] = useState<Filters>({
    search: '',
    status: '',
    serviceType: '',
    page: 1,
    pageSize: 25,
  });
  const [managingAccountId, setManagingAccountId] = useState<number | null>(null);

  const accounts = useQuery({
    queryKey: ['service-accounts', filters],
    queryFn: () =>
      window.bcis.serviceAccounts.list({
        search: filters.search.length > 0 ? filters.search : undefined,
        status: filters.status === '' ? undefined : filters.status,
        serviceType: filters.serviceType === '' ? undefined : filters.serviceType,
        page: filters.page,
        pageSize: filters.pageSize,
      }),
  });

  const items = accounts.data?.items ?? [];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHeader
        title="Service accounts"
        description="Every internet, cable, and combo account, with the rate each one is charged."
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-64">
          <Input
            placeholder="Search account, subscriber, or name"
            value={filters.search}
            onChange={(event) => {
              setFilters((current) => ({ ...current, search: event.target.value, page: 1 }));
            }}
          />
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
            <option value="PENDING">Pending</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="DISCONNECTED">Disconnected</option>
            <option value="CLOSED">Closed</option>
          </Select>
        </div>

        <div className="w-40">
          <Select
            aria-label="Service type"
            value={filters.serviceType}
            onChange={(event) => {
              setFilters((current) => ({
                ...current,
                serviceType: event.target.value as Filters['serviceType'],
                page: 1,
              }));
            }}
          >
            <option value="">All service types</option>
            <option value="INTERNET">Internet</option>
            <option value="CABLE">Cable</option>
            <option value="COMBO">Combo</option>
          </Select>
        </div>

        <span className="ml-auto text-xs text-muted-foreground">
          {accounts.data === undefined ? '' : `${String(accounts.data.total)} account(s)`}
        </span>
      </div>

      {accounts.data?.ok === false && (
        <Alert tone="danger" title="Could not load service accounts">
          {accounts.data.error ?? 'Unknown error.'}
        </Alert>
      )}

      <DataTable>
        <thead>
          <tr>
            <Th>Account</Th>
            <Th>Subscriber</Th>
            <Th>Plan</Th>
            <Th align="right">Rate</Th>
            <Th>Status</Th>
            <Th>Activated</Th>
            <Th align="right">Actions</Th>
          </tr>
        </thead>
        <tbody>
          {accounts.isLoading && <EmptyRow colSpan={7}>Loading…</EmptyRow>}

          {!accounts.isLoading && items.length === 0 && (
            <EmptyRow colSpan={7}>No service accounts match this filter.</EmptyRow>
          )}

          {items.map((account) => (
            <Tr key={account.id}>
              <Td>
                <span className="font-mono text-[13px]">{account.accountNumber}</span>
              </Td>
              <Td>
                <button
                  type="button"
                  className="text-left text-foreground underline-offset-2 hover:underline"
                  onClick={() => {
                    onOpenSubscriber(account.subscriberId);
                  }}
                >
                  {account.subscriberName}
                </button>
                <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                  {account.subscriberAccountNumber}
                </span>
              </Td>
              <Td>
                {account.planCode}
                <span className="ml-2 text-[11px] text-muted-foreground">
                  {account.serviceTypeName}
                </span>
              </Td>
              <Td align="right">
                {formatMoney(account.currentPlanPriceCentavos)}
                {account.currentPlanPriceCentavos !== account.planCurrentPriceCentavos && (
                  <span className="ml-2 text-[11px] text-amber-700">older rate</span>
                )}
              </Td>
              <Td>
                <StatusPill
                  tone={statusTone(account.status)}
                  label={SERVICE_ACCOUNT_STATUS_LABELS[account.status as ServiceAccountStatus]}
                />
              </Td>
              <Td className="text-muted-foreground">{account.activationDate ?? '—'}</Td>
              <Td align="right">
                <Button
                  size="sm"
                  onClick={() => {
                    setManagingAccountId(account.id);
                  }}
                >
                  Manage
                </Button>
              </Td>
            </Tr>
          ))}
        </tbody>
      </DataTable>

      <Pager
        page={filters.page}
        total={accounts.data?.total ?? 0}
        pageSize={filters.pageSize}
        onChange={(page) => {
          setFilters((current) => ({ ...current, page }));
        }}
      />

      <ServiceAccountManageDialog
        accountId={managingAccountId}
        onClose={() => {
          setManagingAccountId(null);
        }}
        onChanged={() => {
          void accounts.refetch();
        }}
      />
    </div>
  );
}
