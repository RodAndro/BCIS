import {
  ALLOWED_STATUS_TRANSITIONS,
  SERVICE_ACCOUNT_STATUS_LABELS,
  type ServiceAccountStatus,
} from '@bcis/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { StatusPill, type StatusTone } from '@renderer/components/status-pill';
import { Button } from '@renderer/components/ui/button';
import { Alert } from '@renderer/components/ui/feedback';
import { Field, Input, Select } from '@renderer/components/ui/form';
import { Modal } from '@renderer/components/ui/overlay';
import { formatInstant } from '@renderer/lib/format';
import { formatMoney } from '@renderer/lib/money';
import type { JSX, ReactNode } from 'react';
import { useState } from 'react';

/**
 * Manage a service account: status, rate, and history.
 *
 * ── THE TWO THINGS THIS SCREEN MAKES VISIBLE ────────────────────────────────
 * 1. The account's rate and the plan's current rate are shown side by side.
 *    When they differ, the account is on an older rate — a normal, deliberate
 *    state that nobody should have to infer.
 * 2. Moving onto the current rate is a button with a reason, not a consequence
 *    of someone else changing a plan.
 *
 * The status list is built from the lifecycle table in `@bcis/shared`, so a
 * move the API would refuse is not offered in the first place.
 */

export interface ServiceAccountManageDialogProps {
  readonly accountId: number | null;
  readonly onClose: () => void;
  readonly onChanged: () => void;
}

export function ServiceAccountManageDialog({
  accountId,
  onClose,
  onChanged,
}: ServiceAccountManageDialogProps): JSX.Element {
  const queryClient = useQueryClient();

  const detail = useQuery({
    queryKey: ['service-account', accountId],
    enabled: accountId !== null,
    queryFn: () => window.bcis.serviceAccounts.get(accountId as number),
  });

  const account = detail.data?.item ?? null;

  const [nextStatus, setNextStatus] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function refresh(): void {
    void queryClient.invalidateQueries({ queryKey: ['service-account', accountId] });
    void queryClient.invalidateQueries({ queryKey: ['service-accounts'] });
    void queryClient.invalidateQueries({ queryKey: ['subscribers'] });
    onChanged();
  }

  async function changeStatus(): Promise<void> {
    if (accountId === null || nextStatus === '') return;
    setBusy(true);
    setError(null);
    setMessage(null);

    const result = await window.bcis.serviceAccounts.setStatus(accountId, {
      status: nextStatus as ServiceAccountStatus,
      effectiveDate,
      reason: reason.trim(),
    });

    if (!result.ok) {
      setError(result.error ?? 'Could not change the status.');
    } else {
      setMessage(`Status changed to ${nextStatus}.`);
      setNextStatus('');
      setReason('');
      refresh();
    }

    setBusy(false);
  }

  async function applyRate(): Promise<void> {
    if (accountId === null) return;
    setBusy(true);
    setError(null);
    setMessage(null);

    const result = await window.bcis.serviceAccounts.applyRate(accountId, {
      effectiveDate,
      reason: reason.trim().length >= 10 ? reason.trim() : 'Applying the current plan rate.',
    });

    if (!result.ok) {
      setError(result.error ?? 'Could not apply the current rate.');
    } else {
      setMessage('The account is now on the current rate for its plan.');
      refresh();
    }

    setBusy(false);
  }

  const transitions =
    account === null ? [] : ALLOWED_STATUS_TRANSITIONS[account.status as ServiceAccountStatus];
  const drifted =
    account !== null && account.currentPlanPriceCentavos !== account.planCurrentPriceCentavos;

  return (
    <Modal
      open={accountId !== null}
      title={account === null ? 'Service account' : account.accountNumber}
      description={account === null ? undefined : `${account.planCode} — ${account.planName}`}
      onClose={onClose}
      width="lg"
      footer={
        <Button variant="primary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {detail.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {account !== null && (
        <div className="flex flex-col gap-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Detail label="Status">
              <StatusPill
                tone={statusTone(account.status)}
                label={SERVICE_ACCOUNT_STATUS_LABELS[account.status]}
              />
            </Detail>
            <Detail label="Service type">
              {account.serviceTypeName} ({account.serviceTypeCode})
            </Detail>
            <Detail label="Activated">{account.activationDate ?? 'not yet activated'}</Detail>
            <Detail label="Billing cycle">
              Billing day {account.billingDay}, due day {account.dueDay}
            </Detail>
            <Detail label="Charged rate">
              <span className="font-medium">{formatMoney(account.currentPlanPriceCentavos)}</span>
            </Detail>
            <Detail label="Plan rate today">
              {formatMoney(account.planCurrentPriceCentavos)}
              {drifted && <span className="ml-2 text-[11px] text-warning">on an older rate</span>}
            </Detail>
          </div>

          <div className="rounded-md border border-border p-4">
            <h3 className="text-sm font-semibold text-foreground">Change status</h3>

            {transitions.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">
                A closed account cannot be changed. A returning customer gets a new account.
              </p>
            ) : (
              <div className="mt-3 flex flex-col gap-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="New status">
                    {({ id }) => (
                      <Select
                        id={id}
                        value={nextStatus}
                        onChange={(event) => {
                          setNextStatus(event.target.value);
                        }}
                      >
                        <option value="">Choose…</option>
                        {transitions.map((status) => (
                          <option key={status} value={status}>
                            {SERVICE_ACCOUNT_STATUS_LABELS[status]}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>

                  <Field label="Effective date">
                    {({ id }) => (
                      <Input
                        id={id}
                        type="date"
                        value={effectiveDate}
                        onChange={(event) => {
                          setEffectiveDate(event.target.value);
                        }}
                      />
                    )}
                  </Field>
                </div>

                <Field
                  label="Reason"
                  hint="Recorded in the service history. At least 10 characters."
                >
                  {({ id, invalid }) => (
                    <Input
                      id={id}
                      value={reason}
                      invalid={invalid}
                      onChange={(event) => {
                        setReason(event.target.value);
                      }}
                    />
                  )}
                </Field>

                <div className="flex items-center gap-2">
                  <Button
                    variant="primary"
                    disabled={
                      busy || nextStatus === '' || effectiveDate === '' || reason.trim().length < 10
                    }
                    onClick={() => {
                      void changeStatus();
                    }}
                  >
                    {busy ? 'Saving…' : 'Change status'}
                  </Button>

                  <Button
                    disabled={busy || !drifted || effectiveDate === ''}
                    title={
                      drifted
                        ? undefined
                        : 'This account is already on the current rate for its plan.'
                    }
                    onClick={() => {
                      void applyRate();
                    }}
                  >
                    Apply current plan rate
                  </Button>
                </div>
              </div>
            )}

            {error !== null && (
              <div className="mt-3">
                <Alert tone="danger">{error}</Alert>
              </div>
            )}
            {message !== null && (
              <div className="mt-3">
                <Alert tone="success">{message}</Alert>
              </div>
            )}
          </div>

          <div>
            <h3 className="text-sm font-semibold text-foreground">Service history</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Append-only: entries cannot be edited or deleted.
            </p>

            {account.events.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No history recorded.</p>
            ) : (
              <ol className="mt-3 flex flex-col gap-2">
                {account.events.map((event) => (
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
          </div>
        </div>
      )}
    </Modal>
  );
}

function Detail({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground">{children}</span>
    </div>
  );
}

/** Status colour, paired with the label so the meaning never rests on it. */
export function statusTone(status: string): StatusTone {
  const tones: Record<string, StatusTone> = {
    PENDING: 'pending',
    ACTIVE: 'success',
    SUSPENDED: 'warning',
    DISCONNECTED: 'danger',
    CLOSED: 'neutral',
  };
  return tones[status] ?? 'neutral';
}
