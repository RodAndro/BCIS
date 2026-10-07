import type { AuditEntry } from '@bcis/validation';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@renderer/components/ui/button';
import { Alert, PageHeader } from '@renderer/components/ui/feedback';
import { Field, Input, Select } from '@renderer/components/ui/form';
import { Modal } from '@renderer/components/ui/overlay';
import { DEFAULT_PAGE_SIZE, Pager } from '@renderer/components/ui/pager';
import { DataTable, EmptyRow, Th, Td, Tr } from '@renderer/components/ui/table';
import { formatInstant } from '@renderer/lib/format';
import type { JSX } from 'react';
import { useState } from 'react';

/**
 * Audit log.
 *
 * ── READ-ONLY, AND THE DATABASE AGREES ──────────────────────────────────────
 * There is no edit or delete control because there is no such endpoint, and the
 * table itself rejects UPDATE and DELETE through a trigger. This screen is the
 * readable face of an append-only record.
 *
 * The action filter mirrors the server's `AUDIT_ACTIONS` vocabulary. An unknown
 * value simply returns nothing, so a stale entry in this list is a cosmetic
 * problem rather than a broken query.
 */

const ACTION_OPTIONS = [
  'LOGIN_SUCCEEDED',
  'LOGIN_FAILED',
  'LOGOUT',
  'SESSION_LOCKED',
  'SESSION_UNLOCKED',
  'PASSWORD_CHANGED',
  'USER_CREATED',
  'USER_UPDATED',
  'USER_STATUS_CHANGED',
  'USER_PASSWORD_RESET',
  'ROLE_PERMISSIONS_CHANGED',
  'SETTING_UPDATED',
] as const;

interface AuditFilters {
  readonly action: string;
  readonly from: string;
  readonly to: string;
  readonly page: number;
  readonly pageSize: number;
}

export function AuditLogScreen(): JSX.Element {
  const [filters, setFilters] = useState<AuditFilters>({
    action: '',
    from: '',
    to: '',
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
  });
  const [detail, setDetail] = useState<AuditEntry | null>(null);

  const audit = useQuery({
    queryKey: ['audit-logs', filters],
    queryFn: () =>
      window.bcis.audit.list({
        action: filters.action.length > 0 ? filters.action : undefined,
        from: filters.from.length > 0 ? filters.from : undefined,
        to: filters.to.length > 0 ? filters.to : undefined,
        page: filters.page,
        pageSize: filters.pageSize,
      }),
  });

  const items = audit.data?.items ?? [];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHeader
        title="Audit Log"
        description="Append-only record of sign-ins and administrative changes. Entries cannot be edited or deleted."
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-56">
          <Field label="Action">
            {({ id }) => (
              <Select
                id={id}
                value={filters.action}
                onChange={(event) => {
                  setFilters((current) => ({ ...current, action: event.target.value, page: 1 }));
                }}
              >
                <option value="">All actions</option>
                {ACTION_OPTIONS.map((action) => (
                  <option key={action} value={action}>
                    {action}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <div className="w-40">
          <Field label="From">
            {({ id }) => (
              <Input
                id={id}
                type="date"
                value={filters.from}
                onChange={(event) => {
                  setFilters((current) => ({ ...current, from: event.target.value, page: 1 }));
                }}
              />
            )}
          </Field>
        </div>

        <div className="w-40">
          <Field label="To">
            {({ id }) => (
              <Input
                id={id}
                type="date"
                value={filters.to}
                onChange={(event) => {
                  setFilters((current) => ({ ...current, to: event.target.value, page: 1 }));
                }}
              />
            )}
          </Field>
        </div>

        <Button
          onClick={() => {
            setFilters((current) => ({ ...current, action: '', from: '', to: '', page: 1 }));
          }}
        >
          Clear
        </Button>

        <span className="ml-auto text-xs text-muted-foreground">
          {audit.data === undefined ? '' : `${String(audit.data.total)} entr(ies)`}
        </span>
      </div>

      {audit.data?.ok === false && (
        <Alert tone="danger" title="Could not load the audit log">
          {audit.data.error ?? 'Unknown error.'}
        </Alert>
      )}

      <DataTable>
        <thead>
          <tr>
            <Th>When</Th>
            <Th>Actor</Th>
            <Th>Action</Th>
            <Th>Entity</Th>
            <Th>Reason</Th>
            <Th align="right">Details</Th>
          </tr>
        </thead>
        <tbody>
          {audit.isLoading && <EmptyRow colSpan={6}>Loading…</EmptyRow>}

          {!audit.isLoading && items.length === 0 && (
            <EmptyRow colSpan={6}>No audit entries match this filter.</EmptyRow>
          )}

          {items.map((entry) => (
            <Tr key={entry.id}>
              <Td>{formatInstant(entry.createdAt)}</Td>
              <Td>{entry.actorUsername ?? '—'}</Td>
              <Td>
                <span className="font-mono text-[12px]">{entry.action}</span>
              </Td>
              <Td>
                <span className="text-muted-foreground">{entry.entityType}</span>
                {entry.entityId !== null && (
                  <span className="ml-1 font-mono text-[12px]">#{entry.entityId}</span>
                )}
              </Td>
              <Td className="text-muted-foreground">{entry.reason ?? '—'}</Td>
              <Td align="right">
                <Button
                  size="sm"
                  disabled={entry.oldValues === null && entry.newValues === null}
                  onClick={() => {
                    setDetail(entry);
                  }}
                >
                  View
                </Button>
              </Td>
            </Tr>
          ))}
        </tbody>
      </DataTable>

      <Pager
        page={filters.page}
        pageSize={filters.pageSize}
        total={audit.data?.total ?? 0}
        onChange={(page) => {
          setFilters((current) => ({ ...current, page }));
        }}
        onPageSizeChange={(pageSize) => {
          setFilters((current) => ({ ...current, pageSize, page: 1 }));
        }}
      />

      <Modal
        open={detail !== null}
        title="Audit detail"
        description={
          detail === null ? undefined : `${detail.action} · ${formatInstant(detail.createdAt)}`
        }
        onClose={() => {
          setDetail(null);
        }}
        width="lg"
        footer={
          <Button
            variant="primary"
            onClick={() => {
              setDetail(null);
            }}
          >
            Close
          </Button>
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Snapshot title="Before" value={detail?.oldValues ?? null} />
          <Snapshot title="After" value={detail?.newValues ?? null} />
        </div>
      </Modal>
    </div>
  );
}

function Snapshot({
  title,
  value,
}: {
  readonly title: string;
  readonly value: unknown;
}): JSX.Element {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <pre className="max-h-72 overflow-auto rounded-md border border-border bg-muted p-3 font-mono text-[11px] text-foreground">
        {value === null ? 'No snapshot recorded.' : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
