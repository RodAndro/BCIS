import { formatMoney } from '@renderer/lib/money';
import { Button } from '@renderer/components/ui/button';
import { Alert } from '@renderer/components/ui/feedback';
import { Field, Input, Select } from '@renderer/components/ui/form';
import { Modal } from '@renderer/components/ui/overlay';
import {
  useCollectors,
  useSelectablePlans,
} from '@renderer/features/subscribers/use-reference-data';
import type { JSX } from 'react';
import { useState } from 'react';

/**
 * Open a service account.
 *
 * ── THE RATE IS NOT A FIELD ─────────────────────────────────────────────────
 * There is no price input here, and that is deliberate: the account's rate is
 * copied from the plan version at activation. Letting someone type it would
 * create accounts charged something the plan never said, which is the class of
 * discrepancy this system exists to prevent.
 *
 * The plan picker lists only current, non-retired versions, which is the same
 * rule the API enforces — so a stale list produces a clear refusal rather than a
 * wrongly-billed account.
 */

export interface ServiceAccountDialogProps {
  readonly open: boolean;
  readonly subscriberId: number;
  readonly subscriberBillingDay: number;
  readonly subscriberDueDay: number;
  readonly addresses: readonly { id: number; addressType: string; line1: string }[];
  readonly onClose: () => void;
  readonly onCreated: (serviceAccountId: number) => void;
}

export function ServiceAccountDialog({
  open,
  subscriberId,
  subscriberBillingDay,
  subscriberDueDay,
  addresses,
  onClose,
  onCreated,
}: ServiceAccountDialogProps): JSX.Element {
  const plans = useSelectablePlans();
  const collectors = useCollectors();

  const [servicePlanId, setServicePlanId] = useState('');
  const [installationAddressId, setInstallationAddressId] = useState('');
  const [status, setStatus] = useState<'ACTIVE' | 'PENDING'>('ACTIVE');
  const [activationDate, setActivationDate] = useState('');
  const [billingDay, setBillingDay] = useState(subscriberBillingDay);
  const [dueDay, setDueDay] = useState(subscriberDueDay);
  const [assignedCollectorId, setAssignedCollectorId] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selectedPlan = (plans.data?.items ?? []).find((plan) => String(plan.id) === servicePlanId);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);

    const result = await window.bcis.serviceAccounts.create({
      subscriberId,
      servicePlanId: Number(servicePlanId),
      status,
      ...(installationAddressId === ''
        ? {}
        : { installationAddressId: Number(installationAddressId) }),
      ...(status === 'ACTIVE' && activationDate.length > 0 ? { activationDate } : {}),
      billingDay,
      dueDay,
      ...(assignedCollectorId === '' ? {} : { assignedCollectorId: Number(assignedCollectorId) }),
      ...(notes.trim().length > 0 ? { notes: notes.trim() } : {}),
    });

    if (!result.ok || result.item === null) {
      setError(result.error ?? 'Could not open the service account.');
      setBusy(false);
      return;
    }

    setBusy(false);
    onCreated(result.item.id);
    onClose();
  }

  return (
    <Modal
      open={open}
      title="Add service account"
      description="One subscriber can hold several services; each is billed separately."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={busy || servicePlanId === ''}
            onClick={() => {
              void submit();
            }}
          >
            {busy ? 'Opening…' : 'Open account'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Plan" hint="Only current, non-retired plans can start a new account.">
          {({ id, invalid }) => (
            <Select
              id={id}
              value={servicePlanId}
              invalid={invalid}
              onChange={(event) => {
                setServicePlanId(event.target.value);
              }}
            >
              <option value="">Choose a plan…</option>
              {(plans.data?.items ?? []).map((plan) => (
                <option key={plan.id} value={String(plan.id)}>
                  {plan.code} — {plan.name} — {formatMoney(plan.monthlyFeeCentavos)}/mo
                </option>
              ))}
            </Select>
          )}
        </Field>

        {selectedPlan !== undefined && (
          <Alert tone="info">
            This account will be charged{' '}
            <span className="font-medium">{formatMoney(selectedPlan.monthlyFeeCentavos)}</span> per
            month. A later plan price change will not alter this account until someone applies the
            new rate explicitly.
          </Alert>
        )}

        <Field label="Installation address">
          {({ id }) => (
            <Select
              id={id}
              value={installationAddressId}
              onChange={(event) => {
                setInstallationAddressId(event.target.value);
              }}
            >
              <option value="">Not recorded yet</option>
              {addresses.map((address) => (
                <option key={address.id} value={String(address.id)}>
                  {address.addressType} — {address.line1}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Status" hint="PENDING is for a scheduled installation.">
            {({ id }) => (
              <Select
                id={id}
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value as 'ACTIVE' | 'PENDING');
                }}
              >
                <option value="ACTIVE">Active</option>
                <option value="PENDING">Pending installation</option>
              </Select>
            )}
          </Field>

          <Field label="Activation date" hint="Leave blank for today.">
            {({ id }) => (
              <Input
                id={id}
                type="date"
                disabled={status === 'PENDING'}
                value={activationDate}
                onChange={(event) => {
                  setActivationDate(event.target.value);
                }}
              />
            )}
          </Field>

          <Field label="Billing day">
            {({ id }) => (
              <Input
                id={id}
                type="number"
                min={1}
                max={28}
                value={billingDay}
                onChange={(event) => {
                  setBillingDay(Number(event.target.value));
                }}
              />
            )}
          </Field>

          <Field label="Due day">
            {({ id }) => (
              <Input
                id={id}
                type="number"
                min={1}
                max={28}
                value={dueDay}
                onChange={(event) => {
                  setDueDay(Number(event.target.value));
                }}
              />
            )}
          </Field>
        </div>

        <Field label="Assigned collector">
          {({ id }) => (
            <Select
              id={id}
              value={assignedCollectorId}
              onChange={(event) => {
                setAssignedCollectorId(event.target.value);
              }}
            >
              <option value="">Use the subscriber&rsquo;s default</option>
              {(collectors.data?.items ?? []).map((collector) => (
                <option key={collector.id} value={String(collector.id)}>
                  {collector.fullName}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Notes">
          {({ id }) => (
            <Input
              id={id}
              value={notes}
              onChange={(event) => {
                setNotes(event.target.value);
              }}
            />
          )}
        </Field>

        {error !== null && <Alert tone="danger">{error}</Alert>}
      </div>
    </Modal>
  );
}
