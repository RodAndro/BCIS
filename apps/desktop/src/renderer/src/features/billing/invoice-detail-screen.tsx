import { useQuery, useQueryClient } from '@tanstack/react-query';
import { StatusPill } from '@renderer/components/status-pill';
import { Button } from '@renderer/components/ui/button';
import { Alert, SectionCard } from '@renderer/components/ui/feedback';
import { Field, Input, Select } from '@renderer/components/ui/form';
import { DataTable, Th, Td, Tr } from '@renderer/components/ui/table';
import { ITEM_TYPE_LABELS, invoiceStatusTone } from '@renderer/features/billing/status';
import { formatInstant } from '@renderer/lib/format';
import { formatMoney } from '@renderer/lib/money';
import type { JSX } from 'react';
import { useState } from 'react';

/**
 * Invoice detail.
 *
 * ── WHAT THIS SCREEN MAKES VISIBLE ──────────────────────────────────────────
 * That the total is the sum of the lines, including after an adjustment. The
 * lines are shown in full and never abbreviated, because "why is this invoice
 * ₱1,240 when the plan is ₱999?" is answered by reading them, and a screen that
 * hid any of them would send the question to a developer.
 *
 * The two ways a posted invoice can still change — an adjustment and a void —
 * are the only mutation controls here. There is no edit.
 */
export function InvoiceDetailScreen({
  invoiceId,
  onBack,
}: {
  readonly invoiceId: number;
  readonly onBack: () => void;
}): JSX.Element {
  const queryClient = useQueryClient();

  const invoice = useQuery({
    queryKey: ['invoice', invoiceId],
    queryFn: () => window.bcis.invoices.get(invoiceId),
  });

  const detail = invoice.data?.item ?? null;

  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [voidReason, setVoidReason] = useState('');
  const [showVoid, setShowVoid] = useState(false);

  const [adjustmentType, setAdjustmentType] = useState<'DEBIT' | 'CREDIT'>('CREDIT');
  const [adjustmentAmount, setAdjustmentAmount] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState('GOODWILL');
  const [adjustmentMemo, setAdjustmentMemo] = useState('');
  const [showAdjust, setShowAdjust] = useState(false);

  function refresh(): void {
    void queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
    void queryClient.invalidateQueries({ queryKey: ['invoices'] });
    void queryClient.invalidateQueries({ queryKey: ['billing-dashboard'] });
    void queryClient.invalidateQueries({ queryKey: ['ledger'] });
  }

  async function finalize(): Promise<void> {
    setBusy(true);
    setActionError(null);

    const response = await window.bcis.invoices.finalize(invoiceId, {});
    if (!response.ok) setActionError(response.error ?? 'Could not post the invoice.');
    else refresh();

    setBusy(false);
  }

  async function voidInvoice(): Promise<void> {
    setBusy(true);
    setActionError(null);

    const response = await window.bcis.invoices.void(invoiceId, { reason: voidReason.trim() });
    if (!response.ok) setActionError(response.error ?? 'Could not void the invoice.');
    else {
      setShowVoid(false);
      setVoidReason('');
      refresh();
    }

    setBusy(false);
  }

  async function addAdjustment(): Promise<void> {
    setBusy(true);
    setActionError(null);

    const response = await window.bcis.invoices.adjust(invoiceId, {
      adjustmentType,
      amountCentavos: toCentavos(adjustmentAmount),
      reasonCode: adjustmentReason as 'GOODWILL',
      memo: adjustmentMemo.trim(),
    });

    if (!response.ok) {
      setActionError(response.error ?? 'Could not post the adjustment.');
    } else {
      setShowAdjust(false);
      setAdjustmentAmount('');
      setAdjustmentMemo('');
      refresh();
    }

    setBusy(false);
  }

  if (invoice.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading invoice…</p>;
  }

  if (detail === null) {
    return (
      <Alert tone="danger" title="Invoice not found">
        {invoice.data?.error ?? 'This invoice could not be loaded.'}
      </Alert>
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <header>
        <Button size="sm" variant="ghost" onClick={onBack}>
          ← All invoices
        </Button>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-lg font-semibold tracking-tight text-foreground">
            {detail.invoiceNumber}
          </h1>
          <StatusPill tone={invoiceStatusTone(detail.displayStatus)} label={detail.displayStatus} />
          {detail.displayStatus !== detail.status && (
            <span className="text-[11px] text-muted-foreground">stored: {detail.status}</span>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {detail.subscriberName} · {detail.subscriberAccountNumber} ·{' '}
          <span className="font-mono">{detail.serviceAccountNumber}</span>
        </p>
      </header>

      {actionError !== null && <Alert tone="danger">{actionError}</Alert>}

      {detail.status === 'VOID' && detail.voidReason !== null && (
        <Alert tone="warning" title="This invoice has been voided">
          {detail.voidReason}
          {detail.voidedAt !== null && ` — ${formatInstant(detail.voidedAt)}`}
          <p className="mt-1 text-xs">
            It is kept, with its number and its lines. The ledger carries a reversing entry, so the
            account is no longer charged for it.
          </p>
        </Alert>
      )}

      <SectionCard
        title="Charges"
        description={`Billed for ${detail.billingPeriodStart} to ${detail.billingPeriodEnd}. Issued ${detail.issueDate}, due ${detail.dueDate}.`}
      >
        <DataTable className="border-0">
          <thead>
            <tr>
              <Th>Type</Th>
              <Th>Description</Th>
              <Th align="right">Qty</Th>
              <Th align="right">Unit price</Th>
              <Th align="right">Amount</Th>
            </tr>
          </thead>
          <tbody>
            {detail.items.map((item) => (
              <Tr key={item.id}>
                <Td>{ITEM_TYPE_LABELS[item.itemType] ?? item.itemType}</Td>
                <Td className="text-muted-foreground">{item.description}</Td>
                <Td align="right">{item.quantity}</Td>
                <Td align="right">{formatMoney(item.unitPriceCentavos)}</Td>
                <Td align="right">
                  {item.direction === 'CREDIT' ? '−' : ''}
                  {formatMoney(item.amountCentavos)}
                </Td>
              </Tr>
            ))}
          </tbody>
        </DataTable>

        <dl className="mt-4 ml-auto flex w-full max-w-sm flex-col gap-1 text-sm">
          <Total label="Subtotal" value={detail.subtotalCentavos} />
          {detail.discountCentavos > 0 && (
            <Total label="Discount" value={-detail.discountCentavos} />
          )}
          {detail.penaltyCentavos > 0 && <Total label="Penalty" value={detail.penaltyCentavos} />}
          {detail.adjustmentCentavos !== 0 && (
            <Total label="Adjustments" value={detail.adjustmentCentavos} />
          )}
          {detail.taxCentavos > 0 && <Total label="VAT (included)" value={detail.taxCentavos} />}
          <Total label="Total" value={detail.totalCentavos} strong />
          {detail.paidCentavos > 0 && <Total label="Paid" value={-detail.paidCentavos} />}
          <Total label="Balance" value={detail.balanceCentavos} strong />
        </dl>
      </SectionCard>

      {detail.adjustments.length > 0 && (
        <SectionCard
          title="Adjustments"
          description="Why this invoice differs from the charges it was raised with. Posted adjustments cannot be changed."
        >
          <DataTable className="border-0">
            <thead>
              <tr>
                <Th>Type</Th>
                <Th>Reason</Th>
                <Th>Memo</Th>
                <Th align="right">Amount</Th>
                <Th>By</Th>
                <Th>When</Th>
              </tr>
            </thead>
            <tbody>
              {detail.adjustments.map((adjustment) => (
                <Tr key={adjustment.id}>
                  <Td>{adjustment.adjustmentType}</Td>
                  <Td className="text-muted-foreground">{adjustment.reasonCode}</Td>
                  <Td className="text-muted-foreground">{adjustment.memo}</Td>
                  <Td align="right">
                    {adjustment.adjustmentType === 'CREDIT' ? '−' : '+'}
                    {formatMoney(adjustment.amountCentavos)}
                  </Td>
                  <Td>{adjustment.createdByUsername ?? '—'}</Td>
                  <Td className="text-muted-foreground">{formatInstant(adjustment.createdAt)}</Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
        </SectionCard>
      )}

      <SectionCard title="Actions" description="A posted invoice is never edited; it moves.">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            disabled={busy || detail.status !== 'DRAFT'}
            title={detail.status === 'DRAFT' ? undefined : 'Only a draft can be posted.'}
            onClick={() => {
              void finalize();
            }}
          >
            Post invoice
          </Button>

          <Button
            variant="danger"
            disabled={busy || detail.status === 'VOID' || detail.paidCentavos > 0}
            title={
              detail.paidCentavos > 0
                ? 'This invoice has payments applied. Reverse those payments first.'
                : undefined
            }
            onClick={() => {
              setShowVoid((current) => !current);
            }}
          >
            Void invoice
          </Button>

          <Button
            disabled={busy || detail.status === 'VOID' || detail.status === 'DRAFT'}
            title={detail.status === 'DRAFT' ? 'Post the invoice before adjusting it.' : undefined}
            onClick={() => {
              setShowAdjust((current) => !current);
            }}
          >
            Post adjustment
          </Button>
        </div>

        {showVoid && (
          <div className="mt-4 flex flex-col gap-3 rounded-md border border-border p-3">
            <Field
              label="Reason for voiding"
              hint="Recorded in the audit log. At least 10 characters."
            >
              {({ id, invalid }) => (
                <Input
                  id={id}
                  value={voidReason}
                  invalid={invalid}
                  onChange={(event) => {
                    setVoidReason(event.target.value);
                  }}
                />
              )}
            </Field>

            <div className="flex gap-2">
              <Button
                variant="danger"
                disabled={busy || voidReason.trim().length < 10}
                onClick={() => {
                  void voidInvoice();
                }}
              >
                Void this invoice
              </Button>
              <Button
                onClick={() => {
                  setShowVoid(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {showAdjust && (
          <div className="mt-4 grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2">
            <Field label="Direction">
              {({ id }) => (
                <Select
                  id={id}
                  value={adjustmentType}
                  onChange={(event) => {
                    setAdjustmentType(event.target.value as 'DEBIT' | 'CREDIT');
                  }}
                >
                  <option value="CREDIT">Credit — reduces what is owed</option>
                  <option value="DEBIT">Debit — increases what is owed</option>
                </Select>
              )}
            </Field>

            <Field label="Amount (₱)">
              {({ id, invalid }) => (
                <Input
                  id={id}
                  value={adjustmentAmount}
                  invalid={invalid}
                  placeholder="150.00"
                  onChange={(event) => {
                    setAdjustmentAmount(event.target.value);
                  }}
                />
              )}
            </Field>

            <Field label="Reason code">
              {({ id }) => (
                <Select
                  id={id}
                  value={adjustmentReason}
                  onChange={(event) => {
                    setAdjustmentReason(event.target.value);
                  }}
                >
                  <option value="BILLING_ERROR">Billing error</option>
                  <option value="GOODWILL">Goodwill</option>
                  <option value="SERVICE_OUTAGE">Service outage</option>
                  <option value="STATUTORY_DISCOUNT">Statutory discount</option>
                  <option value="PROMOTIONAL_DISCOUNT">Promotional discount</option>
                  <option value="LATE_FEE_WAIVER">Late fee waiver</option>
                  <option value="RECONNECTION_FEE_WAIVER">Reconnection fee waiver</option>
                  <option value="OTHER">Other</option>
                </Select>
              )}
            </Field>

            <Field label="Memo" hint="Recorded in the audit log. At least 10 characters.">
              {({ id, invalid }) => (
                <Input
                  id={id}
                  value={adjustmentMemo}
                  invalid={invalid}
                  onChange={(event) => {
                    setAdjustmentMemo(event.target.value);
                  }}
                />
              )}
            </Field>

            <div className="flex gap-2 sm:col-span-2">
              <Button
                variant="primary"
                disabled={
                  busy || adjustmentMemo.trim().length < 10 || adjustmentAmount.trim().length === 0
                }
                onClick={() => {
                  void addAdjustment();
                }}
              >
                Post adjustment
              </Button>
              <Button
                onClick={() => {
                  setShowAdjust(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </SectionCard>

      {detail.status === 'DRAFT' && <EmptyRowNotice />}
    </div>
  );
}

function Total({
  label,
  value,
  strong = false,
}: {
  readonly label: string;
  readonly value: number;
  readonly strong?: boolean;
}): JSX.Element {
  return (
    <div
      className={`flex items-baseline justify-between border-b border-border/60 pb-1 ${
        strong ? 'font-semibold text-foreground' : 'text-muted-foreground'
      }`}
    >
      <dt>{label}</dt>
      <dd className="tabular-nums">{formatMoney(value)}</dd>
    </div>
  );
}

/** A draft has no ledger entry yet, and that is worth saying out loud. */
function EmptyRowNotice(): JSX.Element {
  return (
    <Alert tone="info">
      This invoice is a draft. It has not been posted to the ledger, so the account is not yet
      charged for it. Posting it writes the debit.
    </Alert>
  );
}

/** Pesos typed at the counter → integer centavos, parsed as digits. */
function toCentavos(pesoText: string): number {
  const cleaned = pesoText.replaceAll(/[\s,₱]/g, '');
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (match === null) return Number.NaN;

  const whole = Number(match[1] ?? '0');
  const fraction = Number((match[2] ?? '').padEnd(2, '0'));
  return whole * 100 + fraction;
}
