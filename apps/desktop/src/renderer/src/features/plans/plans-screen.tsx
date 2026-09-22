import type { PlanSummary } from '@bcis/validation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { StatusPill } from '@renderer/components/status-pill';
import { Button } from '@renderer/components/ui/button';
import { Alert, PageHeader } from '@renderer/components/ui/feedback';
import { Field, Input, Select } from '@renderer/components/ui/form';
import { Modal } from '@renderer/components/ui/overlay';
import { DataTable, EmptyRow, Th, Td, Tr } from '@renderer/components/ui/table';
import { useAuth } from '@renderer/features/auth/auth-context';
import { useServiceTypes } from '@renderer/features/subscribers/use-reference-data';
import { formatMoney } from '@renderer/lib/money';
import type { JSX } from 'react';
import { useState } from 'react';

/**
 * Plan management.
 *
 * ── THE ONE IDEA THIS SCREEN HAS TO COMMUNICATE ─────────────────────────────
 * Prices are versioned, not edited. The screen therefore offers "Change price",
 * which creates a new version from a date, and never an edit box on an existing
 * amount. Showing both versions in one table — with the superseded one closed
 * on a date — is what makes that concrete rather than a claim in a document.
 *
 * Retiring is separate from repricing: a retired plan stops being offered while
 * the accounts already on it keep working.
 */

interface Filters {
  readonly search: string;
  readonly serviceType: string;
  readonly showHistory: boolean;
}

export function PlansScreen(): JSX.Element {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const canManage = can('service.plan.manage');
  const serviceTypes = useServiceTypes();

  const [filters, setFilters] = useState<Filters>({
    search: '',
    serviceType: '',
    showHistory: false,
  });
  const [creating, setCreating] = useState(false);
  const [repricing, setRepricing] = useState<PlanSummary | null>(null);
  const [retiring, setRetiring] = useState<PlanSummary | null>(null);

  const plans = useQuery({
    queryKey: ['plans', filters],
    queryFn: () =>
      window.bcis.plans.list({
        search: filters.search.length > 0 ? filters.search : undefined,
        serviceType: filters.serviceType === '' ? undefined : (filters.serviceType as 'INTERNET'),
        currentOnly: !filters.showHistory,
        pageSize: 200,
      }),
  });

  const items = plans.data?.items ?? [];

  function refresh(): void {
    void queryClient.invalidateQueries({ queryKey: ['plans'] });
    void queryClient.invalidateQueries({ queryKey: ['service-accounts'] });
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHeader
        title="Service plans"
        description="Prices are versioned: changing one creates a new version and leaves the old one readable."
        actions={
          canManage ? (
            <Button
              variant="primary"
              onClick={() => {
                setCreating(true);
              }}
            >
              New plan
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-64">
          <Input
            placeholder="Search plan code or name"
            value={filters.search}
            onChange={(event) => {
              setFilters((current) => ({ ...current, search: event.target.value }));
            }}
          />
        </div>

        <div className="w-44">
          <Select
            aria-label="Service type"
            value={filters.serviceType}
            onChange={(event) => {
              setFilters((current) => ({ ...current, serviceType: event.target.value }));
            }}
          >
            <option value="">All service types</option>
            {(serviceTypes.data?.items ?? []).map((type) => (
              <option key={type.id} value={type.code}>
                {type.name}
              </option>
            ))}
          </Select>
        </div>

        <label className="flex items-center gap-2 pb-1.5 text-sm text-foreground">
          <input
            type="checkbox"
            className="size-4 rounded border-input"
            checked={filters.showHistory}
            onChange={(event) => {
              setFilters((current) => ({ ...current, showHistory: event.target.checked }));
            }}
          />
          Show superseded versions
        </label>
      </div>

      {plans.data?.ok === false && (
        <Alert tone="danger" title="Could not load plans">
          {plans.data.error ?? 'Unknown error.'}
        </Alert>
      )}

      <DataTable>
        <thead>
          <tr>
            <Th>Code</Th>
            <Th>Name</Th>
            <Th>Type</Th>
            <Th>Specification</Th>
            <Th align="right">Monthly</Th>
            <Th align="right">Installation</Th>
            <Th>Effective</Th>
            <Th align="right">Accounts</Th>
            <Th align="right">Actions</Th>
          </tr>
        </thead>
        <tbody>
          {plans.isLoading && <EmptyRow colSpan={9}>Loading…</EmptyRow>}

          {!plans.isLoading && items.length === 0 && (
            <EmptyRow colSpan={9}>No plans match this filter.</EmptyRow>
          )}

          {items.map((plan) => (
            <Tr key={plan.id}>
              <Td>
                <span className="font-mono text-[13px]">{plan.code}</span>
              </Td>
              <Td>{plan.name}</Td>
              <Td className="text-muted-foreground">{plan.serviceTypeName}</Td>
              <Td className="text-muted-foreground">
                {plan.speedMbps !== null && `${String(plan.speedMbps)} Mbps`}
                {plan.speedMbps !== null && plan.channelCount !== null && ' + '}
                {plan.channelCount !== null && `${String(plan.channelCount)} channels`}
                {plan.speedMbps === null && plan.channelCount === null && '—'}
              </Td>
              <Td align="right">
                {formatMoney(plan.monthlyFeeCentavos)}
                {!plan.isCurrent && (
                  <span className="ml-2 text-[11px] text-muted-foreground">superseded</span>
                )}
              </Td>
              <Td align="right">{formatMoney(plan.installationFeeCentavos)}</Td>
              <Td className="whitespace-nowrap text-muted-foreground">
                {plan.effectiveFrom} → {plan.effectiveTo ?? 'current'}
              </Td>
              <Td align="right">{plan.serviceAccountCount}</Td>
              <Td align="right">
                {canManage ? (
                  <div className="flex justify-end gap-1">
                    <Button
                      size="sm"
                      disabled={!plan.isCurrent || plan.status === 'RETIRED'}
                      title={
                        plan.isCurrent ? undefined : 'Only the current version can be superseded.'
                      }
                      onClick={() => {
                        setRepricing(plan);
                      }}
                    >
                      Change price
                    </Button>
                    <Button
                      size="sm"
                      variant={plan.status === 'RETIRED' ? 'secondary' : 'danger'}
                      disabled={plan.status === 'RETIRED'}
                      onClick={() => {
                        setRetiring(plan);
                      }}
                    >
                      {plan.status === 'RETIRED' ? 'Retired' : 'Retire'}
                    </Button>
                  </div>
                ) : (
                  <PlanStatus status={plan.status} />
                )}
              </Td>
            </Tr>
          ))}
        </tbody>
      </DataTable>

      <CreatePlanDialog
        open={creating}
        onClose={() => {
          setCreating(false);
        }}
        onCreated={refresh}
      />

      <ChangePriceDialog
        key={repricing?.id ?? 'none'}
        plan={repricing}
        onClose={() => {
          setRepricing(null);
        }}
        onChanged={refresh}
      />

      <RetirePlanDialog
        key={retiring?.id ?? 'none'}
        plan={retiring}
        onClose={() => {
          setRetiring(null);
        }}
        onChanged={refresh}
      />
    </div>
  );
}

function PlanStatus({ status }: { readonly status: string }): JSX.Element {
  return status === 'RETIRED' ? (
    <StatusPill tone="neutral" label="Retired" />
  ) : (
    <StatusPill tone="success" label="Active" />
  );
}

function CreatePlanDialog({
  open,
  onClose,
  onCreated,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onCreated: () => void;
}): JSX.Element {
  const serviceTypes = useServiceTypes();

  const [code, setCode] = useState('');
  const [serviceTypeCode, setServiceTypeCode] = useState('INTERNET');
  const [name, setName] = useState('');
  const [speedMbps, setSpeedMbps] = useState('');
  const [channelCount, setChannelCount] = useState('');
  const [monthly, setMonthly] = useState('');
  const [installation, setInstallation] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const needsSpeed = serviceTypeCode === 'INTERNET' || serviceTypeCode === 'COMBO';
  const needsChannels = serviceTypeCode === 'CABLE' || serviceTypeCode === 'COMBO';

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);

    const result = await window.bcis.plans.create({
      code: code.trim(),
      serviceTypeCode: serviceTypeCode as 'INTERNET' | 'CABLE' | 'COMBO',
      name: name.trim(),
      // Typed as pesos at the counter, sent as integer centavos. The API
      // refuses anything that is not a whole centavo.
      monthlyFeeCentavos: toCentavos(monthly),
      installationFeeCentavos: installation.trim().length === 0 ? 0 : toCentavos(installation),
      effectiveFrom,
      ...(needsSpeed && speedMbps.trim().length > 0 ? { speedMbps: Number(speedMbps) } : {}),
      ...(needsChannels && channelCount.trim().length > 0
        ? { channelCount: Number(channelCount) }
        : {}),
    });

    if (!result.ok) {
      setError(result.error ?? 'Could not create the plan.');
      setBusy(false);
      return;
    }

    setBusy(false);
    onCreated();
    onClose();
  }

  return (
    <Modal
      open={open}
      title="New plan"
      description="A new code, at the price it starts on."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={
              busy ||
              code.trim() === '' ||
              name.trim() === '' ||
              monthly.trim() === '' ||
              effectiveFrom === ''
            }
            onClick={() => {
              void submit();
            }}
          >
            {busy ? 'Creating…' : 'Create plan'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Plan code">
            {({ id, invalid }) => (
              <Input
                id={id}
                value={code}
                invalid={invalid}
                placeholder="INT-100"
                onChange={(event) => {
                  setCode(event.target.value);
                }}
              />
            )}
          </Field>

          <Field label="Service type">
            {({ id }) => (
              <Select
                id={id}
                value={serviceTypeCode}
                onChange={(event) => {
                  setServiceTypeCode(event.target.value);
                }}
              >
                {(serviceTypes.data?.items ?? []).map((type) => (
                  <option key={type.id} value={type.code}>
                    {type.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Name">
            {({ id, invalid }) => (
              <Input
                id={id}
                value={name}
                invalid={invalid}
                placeholder="Fiber 100"
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            )}
          </Field>

          <Field label="Effective from" hint="The first day this version applies.">
            {({ id }) => (
              <Input
                id={id}
                type="date"
                value={effectiveFrom}
                onChange={(event) => {
                  setEffectiveFrom(event.target.value);
                }}
              />
            )}
          </Field>

          {needsSpeed && (
            <Field label="Speed (Mbps)">
              {({ id }) => (
                <Input
                  id={id}
                  type="number"
                  min={1}
                  value={speedMbps}
                  onChange={(event) => {
                    setSpeedMbps(event.target.value);
                  }}
                />
              )}
            </Field>
          )}

          {needsChannels && (
            <Field label="Channels">
              {({ id }) => (
                <Input
                  id={id}
                  type="number"
                  min={1}
                  value={channelCount}
                  onChange={(event) => {
                    setChannelCount(event.target.value);
                  }}
                />
              )}
            </Field>
          )}

          <Field label="Monthly fee (₱)" hint="For example 1299 or 1299.50.">
            {({ id, invalid }) => (
              <Input
                id={id}
                value={monthly}
                invalid={invalid}
                placeholder="1299.00"
                onChange={(event) => {
                  setMonthly(event.target.value);
                }}
              />
            )}
          </Field>

          <Field label="Installation fee (₱)">
            {({ id }) => (
              <Input
                id={id}
                value={installation}
                placeholder="1500.00"
                onChange={(event) => {
                  setInstallation(event.target.value);
                }}
              />
            )}
          </Field>
        </div>

        {error !== null && <Alert tone="danger">{error}</Alert>}
      </div>
    </Modal>
  );
}

function ChangePriceDialog({
  plan,
  onClose,
  onChanged,
}: {
  readonly plan: PlanSummary | null;
  readonly onClose: () => void;
  readonly onChanged: () => void;
}): JSX.Element {
  const [monthly, setMonthly] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    if (plan === null) return;
    setBusy(true);
    setError(null);

    const result = await window.bcis.plans.changePrice(plan.id, {
      monthlyFeeCentavos: toCentavos(monthly),
      effectiveFrom,
      reason: reason.trim(),
    });

    if (!result.ok) {
      setError(result.error ?? 'Could not record the price change.');
      setBusy(false);
      return;
    }

    setBusy(false);
    onChanged();
    onClose();
  }

  return (
    <Modal
      open={plan !== null}
      title={plan === null ? 'Change price' : `Change price — ${plan.code}`}
      description="Creates a new version from the date you choose. The current version is closed the day before."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={
              busy || monthly.trim() === '' || effectiveFrom === '' || reason.trim().length < 10
            }
            onClick={() => {
              void submit();
            }}
          >
            {busy ? 'Saving…' : 'Create new version'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Alert tone="info">
          Existing accounts keep their current rate of{' '}
          <span className="font-medium">
            {plan === null ? '—' : formatMoney(plan.monthlyFeeCentavos)}
          </span>
          . Moving one onto the new rate is a separate, recorded action.
        </Alert>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="New monthly fee (₱)">
            {({ id, invalid }) => (
              <Input
                id={id}
                value={monthly}
                invalid={invalid}
                placeholder="1299.00"
                onChange={(event) => {
                  setMonthly(event.target.value);
                }}
              />
            )}
          </Field>

          <Field label="Effective from" hint="Must be after the current version starts.">
            {({ id }) => (
              <Input
                id={id}
                type="date"
                value={effectiveFrom}
                onChange={(event) => {
                  setEffectiveFrom(event.target.value);
                }}
              />
            )}
          </Field>
        </div>

        <Field label="Reason" hint="Recorded in the audit log. At least 10 characters.">
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

        {error !== null && <Alert tone="danger">{error}</Alert>}
      </div>
    </Modal>
  );
}

function RetirePlanDialog({
  plan,
  onClose,
  onChanged,
}: {
  readonly plan: PlanSummary | null;
  readonly onClose: () => void;
  readonly onChanged: () => void;
}): JSX.Element {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    if (plan === null) return;
    setBusy(true);
    setError(null);

    const result = await window.bcis.plans.retire(plan.id, { reason: reason.trim() });

    if (!result.ok) {
      setError(result.error ?? 'Could not retire the plan.');
      setBusy(false);
      return;
    }

    setBusy(false);
    onChanged();
    onClose();
  }

  return (
    <Modal
      open={plan !== null}
      title={plan === null ? 'Retire plan' : `Retire ${plan.code}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            disabled={busy || reason.trim().length < 10}
            onClick={() => {
              void submit();
            }}
          >
            {busy ? 'Retiring…' : 'Retire plan'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <p>
          A retired plan stops being offered to new accounts. The{' '}
          <span className="font-semibold">{plan?.serviceAccountCount ?? 0}</span> account(s) already
          on it keep working and keep their rate.
        </p>

        <Field label="Reason" hint="Recorded in the audit log. At least 10 characters.">
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

        {error !== null && <Alert tone="danger">{error}</Alert>}
      </div>
    </Modal>
  );
}

/**
 * Turn a typed peso amount into integer centavos.
 *
 * ── WHY NOT `Math.round(parseFloat(x) * 100)` ───────────────────────────────
 * `parseFloat('0.29') * 100` is 28.999999999999996, and rounding it is the kind
 * of thing that works until it does not. This parses the digits as text, so
 * `1299.50` becomes 129950 exactly. A value it cannot parse becomes `NaN`, which
 * the API's `centavosSchema` rejects — better a clear refusal than a wrong bill.
 */
function toCentavos(pesoText: string): number {
  const cleaned = pesoText.replaceAll(/[\s,₱]/g, '');
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);

  if (match === null) return Number.NaN;

  const whole = Number(match[1] ?? '0');
  const fraction = Number((match[2] ?? '').padEnd(2, '0'));

  return whole * 100 + fraction;
}
