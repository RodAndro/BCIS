import { SERVICE_ACCOUNT_STATUS_LABELS, type ServiceAccountStatus } from '@bcis/shared';
import { useQueries, useQuery } from '@tanstack/react-query';
import { StatusPill } from '@renderer/components/status-pill';
import { Button } from '@renderer/components/ui/button';
import { Alert, SectionCard } from '@renderer/components/ui/feedback';
import { DataTable, EmptyRow, Th, Td, Tr } from '@renderer/components/ui/table';
import { statusTone } from '@renderer/features/subscribers/service-account-manage-dialog';
import { ServiceAccountDialog } from '@renderer/features/subscribers/service-account-dialog';
import { ServiceAccountManageDialog } from '@renderer/features/subscribers/service-account-manage-dialog';
import { SubscriberLedgerPanel } from '@renderer/features/ledger/subscriber-ledger-panel';
import { invoiceStatusTone } from '@renderer/features/billing/status';
import { formatInstant } from '@renderer/lib/format';
import { formatMoney } from '@renderer/lib/money';
import type { JSX, ReactNode } from 'react';
import { useState } from 'react';

/**
 * Subscriber profile.
 *
 * ── TABS THAT EXIST, AND TABS THAT DO NOT YET ───────────────────────────────
 * Overview, Services, Billing, Ledger and Service History are implemented.
 * Payments and Documents are Phase 5+ and are shown as such rather than rendered
 * as empty tables — an empty table reads as "no data", which is a different and
 * wrong statement.
 *
 * The service history is assembled from the accounts' own histories, which is
 * where it lives: there is no subscriber-level event log, and inventing one
 * would be a second place for the same facts to disagree.
 */

type Tab = 'overview' | 'services' | 'billing' | 'ledger' | 'history';

export interface SubscriberProfileScreenProps {
  readonly subscriberId: number;
  readonly onBack: () => void;
  /** Opens an invoice from the billing tab. */
  readonly onOpenInvoice: (invoiceId: number) => void;
}

export function SubscriberProfileScreen({
  subscriberId,
  onBack,
  onOpenInvoice,
}: SubscriberProfileScreenProps): JSX.Element {
  const [tab, setTab] = useState<Tab>('overview');
  const [addOpen, setAddOpen] = useState(false);
  const [managingAccountId, setManagingAccountId] = useState<number | null>(null);

  const subscriber = useQuery({
    queryKey: ['subscriber', subscriberId],
    queryFn: () => window.bcis.subscribers.get(subscriberId),
  });

  const accounts = useQuery({
    queryKey: ['service-accounts', { subscriberId }],
    queryFn: () => window.bcis.serviceAccounts.list({ subscriberId, pageSize: 200 }),
  });

  const invoices = useQuery({
    queryKey: ['invoices', { subscriberId }],
    queryFn: () => window.bcis.invoices.list({ subscriberId, pageSize: 100 }),
  });

  const detail = subscriber.data?.item ?? null;
  const accountList = accounts.data?.items ?? [];
  const invoiceList = invoices.data?.items ?? [];

  const histories = useQueries({
    queries: accountList.map((account) => ({
      queryKey: ['service-account', account.id],
      queryFn: () => window.bcis.serviceAccounts.get(account.id),
    })),
  });

  const mergedHistory = histories
    .flatMap((result) => result.data?.item?.events ?? [])
    .sort((left, right) => (left.effectiveDate < right.effectiveDate ? 1 : -1));

  if (subscriber.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading subscriber…</p>;
  }

  if (detail === null) {
    return (
      <Alert tone="danger" title="Subscriber not found">
        {subscriber.data?.error ?? 'This subscriber could not be loaded.'}
      </Alert>
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Button size="sm" variant="ghost" onClick={onBack}>
            ← All subscribers
          </Button>
          <h1 className="mt-2 text-lg font-semibold tracking-tight text-foreground">
            {detail.displayName}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <span className="font-mono text-[13px] text-muted-foreground">
              {detail.accountNumber}
            </span>
            <StatusPill
              tone={
                detail.status === 'ACTIVE'
                  ? 'success'
                  : detail.status === 'INACTIVE'
                    ? 'warning'
                    : detail.status === 'TERMINATED'
                      ? 'danger'
                      : 'neutral'
              }
              label={detail.status}
            />
            <span className="text-xs text-muted-foreground">
              {detail.collectionAreaName ?? 'no collection area'} ·{' '}
              {detail.assignedCollectorName ?? 'no collector'}
            </span>
          </div>
        </div>
      </header>

      <div className="flex gap-1 border-b border-border">
        <TabButton
          active={tab === 'overview'}
          onClick={() => {
            setTab('overview');
          }}
        >
          Overview
        </TabButton>
        <TabButton
          active={tab === 'services'}
          onClick={() => {
            setTab('services');
          }}
        >
          Services ({accountList.length})
        </TabButton>
        <TabButton
          active={tab === 'billing'}
          onClick={() => {
            setTab('billing');
          }}
        >
          Billing ({invoiceList.length})
        </TabButton>
        <TabButton
          active={tab === 'ledger'}
          onClick={() => {
            setTab('ledger');
          }}
        >
          Ledger
        </TabButton>
        <TabButton
          active={tab === 'history'}
          onClick={() => {
            setTab('history');
          }}
        >
          Service history
        </TabButton>
      </div>

      {tab === 'overview' && (
        <>
          <SectionCard title="Account details">
            <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-3">
              <Field label="Subscriber type" value={detail.subscriberType} />
              <Field label="Billing day" value={String(detail.billingDay)} />
              <Field label="Due day" value={String(detail.dueDay)} />
              <Field
                label="Services"
                value={`${String(detail.activeServiceCount)} active of ${String(detail.serviceCount)}`}
              />
              <Field label="Registered" value={formatInstant(detail.createdAt)} />
              <Field
                label="Archived"
                value={detail.archivedAt === null ? '—' : formatInstant(detail.archivedAt)}
              />
            </dl>
            {detail.notes !== null && (
              <p className="mt-4 rounded-md bg-muted px-3 py-2 text-xs text-foreground">
                {detail.notes}
              </p>
            )}
          </SectionCard>

          <SectionCard title="Addresses">
            <DataTable className="border-0">
              <thead>
                <tr>
                  <Th>Type</Th>
                  <Th>Address</Th>
                  <Th>Primary</Th>
                </tr>
              </thead>
              <tbody>
                {detail.addresses.length === 0 && (
                  <EmptyRow colSpan={3}>No addresses recorded.</EmptyRow>
                )}
                {detail.addresses.map((address) => (
                  <Tr key={address.id}>
                    <Td>{address.addressType}</Td>
                    <Td>
                      {[
                        address.line1,
                        address.line2,
                        address.barangay,
                        address.cityMunicipality,
                        address.province,
                      ]
                        .filter((part) => part !== undefined && part !== null && part.length > 0)
                        .join(', ')}
                    </Td>
                    <Td>{address.isPrimary ? 'Yes' : '—'}</Td>
                  </Tr>
                ))}
              </tbody>
            </DataTable>
          </SectionCard>

          <SectionCard title="Contacts">
            <DataTable className="border-0">
              <thead>
                <tr>
                  <Th>Type</Th>
                  <Th>Value</Th>
                  <Th>Primary</Th>
                </tr>
              </thead>
              <tbody>
                {detail.contacts.length === 0 && (
                  <EmptyRow colSpan={3}>No contacts recorded.</EmptyRow>
                )}
                {detail.contacts.map((contact) => (
                  <Tr key={contact.id}>
                    <Td>{contact.contactType}</Td>
                    <Td className="font-mono text-[13px]">{contact.value}</Td>
                    <Td>{contact.isPrimary ? 'Yes' : '—'}</Td>
                  </Tr>
                ))}
              </tbody>
            </DataTable>
          </SectionCard>
        </>
      )}

      {tab === 'services' && (
        <SectionCard
          title="Service accounts"
          description="Each service is billed separately and carries its own rate."
          actions={
            <Button
              variant="primary"
              onClick={() => {
                setAddOpen(true);
              }}
            >
              Add service account
            </Button>
          }
        >
          <DataTable className="border-0">
            <thead>
              <tr>
                <Th>Account</Th>
                <Th>Plan</Th>
                <Th>Type</Th>
                <Th align="right">Rate</Th>
                <Th>Status</Th>
                <Th>Activated</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {accounts.isLoading && <EmptyRow colSpan={7}>Loading…</EmptyRow>}

              {!accounts.isLoading && accountList.length === 0 && (
                <EmptyRow colSpan={7}>No service accounts yet.</EmptyRow>
              )}

              {accountList.map((account) => (
                <Tr key={account.id}>
                  <Td>
                    <span className="font-mono text-[13px]">{account.accountNumber}</span>
                  </Td>
                  <Td>
                    {account.planCode} — {account.planName}
                  </Td>
                  <Td className="text-muted-foreground">{account.serviceTypeName}</Td>
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
        </SectionCard>
      )}

      {tab === 'billing' && (
        <SectionCard title="Invoices" description="Every invoice raised for this subscriber.">
          <DataTable className="border-0">
            <thead>
              <tr>
                <Th>Invoice</Th>
                <Th>Period</Th>
                <Th>Due</Th>
                <Th align="right">Total</Th>
                <Th align="right">Balance</Th>
                <Th>Status</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {invoices.isLoading && <EmptyRow colSpan={7}>Loading…</EmptyRow>}

              {!invoices.isLoading && invoiceList.length === 0 && (
                <EmptyRow colSpan={7}>No invoices yet. Generate billing for a period.</EmptyRow>
              )}

              {invoiceList.map((invoice) => (
                <Tr key={invoice.id}>
                  <Td>
                    <span className="font-mono text-[13px]">{invoice.invoiceNumber}</span>
                  </Td>
                  <Td className="text-muted-foreground">{invoice.billingPeriodStart}</Td>
                  <Td className="text-muted-foreground">{invoice.dueDate}</Td>
                  <Td align="right">{formatMoney(invoice.totalCentavos)}</Td>
                  <Td align="right">{formatMoney(invoice.balanceCentavos)}</Td>
                  <Td>
                    <StatusPill
                      tone={invoiceStatusTone(invoice.displayStatus)}
                      label={invoice.displayStatus}
                    />
                  </Td>
                  <Td align="right">
                    <Button
                      size="sm"
                      onClick={() => {
                        onOpenInvoice(invoice.id);
                      }}
                    >
                      Open
                    </Button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
        </SectionCard>
      )}

      {tab === 'ledger' && <SubscriberLedgerPanel subscriberId={subscriberId} />}

      {tab === 'history' && (
        <SectionCard
          title="Service history"
          description="Every state change across this subscriber's accounts, newest first. Append-only."
        >
          {mergedHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {accounts.isLoading ? 'Loading…' : 'No history recorded yet.'}
            </p>
          ) : (
            <ol className="flex flex-col gap-2">
              {mergedHistory.map((event) => (
                <li
                  key={event.id}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md border border-border px-3 py-2"
                >
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {event.effectiveDate}
                  </span>
                  <span className="text-sm font-medium text-foreground">{event.eventType}</span>
                  {event.fromValue !== null && (
                    <span className="text-xs text-muted-foreground">
                      {event.fromValue} → {event.toValue ?? '—'}
                    </span>
                  )}
                  {event.reason !== null && (
                    <span className="w-full text-xs text-muted-foreground">{event.reason}</span>
                  )}
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {event.actorUsername ?? 'system'} · {formatInstant(event.createdAt)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </SectionCard>
      )}

      <ServiceAccountDialog
        open={addOpen}
        subscriberId={detail.id}
        subscriberBillingDay={detail.billingDay}
        subscriberDueDay={detail.dueDay}
        addresses={detail.addresses.map((address) => ({
          id: address.id,
          addressType: address.addressType,
          line1: address.line1,
        }))}
        onClose={() => {
          setAddOpen(false);
        }}
        onCreated={() => {
          void accounts.refetch();
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

function TabButton({
  active,
  onClick,
  children,
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={
        active
          ? '-mb-px border-b-2 border-accent px-3 py-2 text-sm font-medium text-foreground'
          : '-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground'
      }
    >
      {children}
    </button>
  );
}

function Field({
  label,
  value,
}: {
  readonly label: string;
  readonly value: ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-col">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{value}</dd>
    </div>
  );
}
