import type { BillingPreview, BillingRunResult } from '@bcis/validation';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@renderer/components/ui/button';
import { Alert, PageHeader, SectionCard } from '@renderer/components/ui/feedback';
import { CheckboxRow, Field, Input } from '@renderer/components/ui/form';
import { DataTable, EmptyRow, Th, Td, Tr } from '@renderer/components/ui/table';
import { formatMoney } from '@renderer/lib/money';
import type { JSX } from 'react';
import { useState } from 'react';

/**
 * Generate billing.
 *
 * ── PREVIEW FIRST, AND ON PURPOSE ───────────────────────────────────────────
 * The screen will not post anything until it has shown what posting would do.
 * `dryRun` is the default at every layer — the Zod schema, the API, and this
 * screen — so the destructive option is the one that has to be asked for.
 *
 * The preview is produced by the SAME planner the run uses, so what is approved
 * and what is written cannot be two different computations.
 */
export function GenerateBillingScreen({
  onGenerated,
}: {
  readonly onGenerated: () => void;
}): JSX.Element {
  const queryClient = useQueryClient();

  const [month, setMonth] = useState(defaultMonth());
  const [asDraft, setAsDraft] = useState(false);
  const [preview, setPreview] = useState<BillingPreview | null>(null);
  const [result, setResult] = useState<BillingRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function runPreview(): Promise<void> {
    setBusy(true);
    setError(null);
    setResult(null);

    const response = await window.bcis.billing.preview({ month, dryRun: true, asDraft });
    if (!response.ok || response.item === null) {
      setError(response.error ?? 'Could not build the preview.');
      setPreview(null);
    } else {
      setPreview(response.item);
    }

    setBusy(false);
  }

  async function generate(): Promise<void> {
    setBusy(true);
    setError(null);

    const response = await window.bcis.billing.generate({ month, dryRun: false, asDraft });

    if (!response.ok || response.item === null) {
      setError(response.error ?? 'The billing run failed. Nothing was written.');
      setBusy(false);
      return;
    }

    setResult(response.item);
    setPreview(null);
    setBusy(false);

    void queryClient.invalidateQueries({ queryKey: ['invoices'] });
    void queryClient.invalidateQueries({ queryKey: ['billing-dashboard'] });
    onGenerated();
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <PageHeader
        title="Generate billing"
        description="Preview the run, then post it. A run is one transaction: it either completes or leaves nothing behind."
      />

      <SectionCard title="Period">
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-48">
            <Field label="Billing month" hint="A calendar month, billed in advance.">
              {({ id }) => (
                <Input
                  id={id}
                  type="month"
                  value={month}
                  onChange={(event) => {
                    setMonth(event.target.value);
                    setPreview(null);
                    setResult(null);
                  }}
                />
              )}
            </Field>
          </div>

          <div className="pb-1">
            <CheckboxRow
              checked={asDraft}
              onChange={setAsDraft}
              label="Create as drafts (nothing is posted to the ledger until each is finalized)"
            />
          </div>

          <div className="flex gap-2 pb-1">
            <Button
              disabled={busy || month.length === 0}
              onClick={() => {
                void runPreview();
              }}
            >
              {busy ? 'Working…' : 'Preview'}
            </Button>
            <Button
              variant="primary"
              disabled={busy || month.length === 0}
              onClick={() => {
                void generate();
              }}
            >
              Generate billing
            </Button>
          </div>
        </div>
      </SectionCard>

      {error !== null && (
        <Alert tone="danger" title="The run did not complete">
          {error}
          <p className="mt-1 text-xs">
            Because the run is a single transaction, no invoice from it was written.
          </p>
        </Alert>
      )}

      {result !== null && (
        <Alert tone="success" title={result.asDraft ? 'Drafts created' : 'Billing posted'}>
          {result.invoicesCreated} invoice(s) for {result.period.label}, totalling{' '}
          <span className="font-medium">{formatMoney(result.totalCentavos)}</span>.{' '}
          {result.accountsSkipped > 0 && `${String(result.accountsSkipped)} account(s) skipped.`}
        </Alert>
      )}

      {preview !== null && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Summary label="Period" value={preview.period.label} />
            <Summary
              label="Would be invoiced"
              value={`${String(preview.willInvoice.length)} account(s)`}
            />
            <Summary label="Total" value={formatMoney(preview.totalCentavos)} emphasis />
          </div>

          {preview.cycle !== null && (
            <Alert tone="info">
              This period already has a billing cycle ({preview.cycle.status.toLowerCase()}) with{' '}
              {preview.cycle.invoiceCount} invoice(s) on it. Anything listed below is a new account
              that has not been billed for this period yet.
            </Alert>
          )}

          <SectionCard
            title="Accounts that would be invoiced"
            description="The rate shown is the account's own, not the plan's price today."
          >
            <DataTable className="border-0">
              <thead>
                <tr>
                  <Th>Account</Th>
                  <Th>Subscriber</Th>
                  <Th>Plan</Th>
                  <Th>Issue / Due</Th>
                  <Th>Lines</Th>
                  <Th align="right">Total</Th>
                </tr>
              </thead>
              <tbody>
                {preview.willInvoice.length === 0 && (
                  <EmptyRow colSpan={6}>
                    Every eligible account already has an invoice for this month.
                  </EmptyRow>
                )}

                {preview.willInvoice.map((line) => (
                  <Tr key={line.serviceAccountId}>
                    <Td>
                      <span className="font-mono text-[13px]">{line.accountNumber}</span>
                    </Td>
                    <Td>
                      {line.subscriberName}
                      <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                        {line.subscriberAccountNumber}
                      </span>
                    </Td>
                    <Td>{line.planCode}</Td>
                    <Td className="whitespace-nowrap text-muted-foreground">
                      {line.issueDate} → {line.dueDate}
                    </Td>
                    <Td className="text-[11px] text-muted-foreground">
                      {line.items.map((item) => item.itemType).join(', ')}
                    </Td>
                    <Td align="right">{formatMoney(line.totalCentavos)}</Td>
                  </Tr>
                ))}
              </tbody>
            </DataTable>
          </SectionCard>

          {preview.willSkip.length > 0 && (
            <SectionCard title="Accounts that would be skipped">
              <DataTable className="border-0">
                <thead>
                  <tr>
                    <Th>Account</Th>
                    <Th>Subscriber</Th>
                    <Th>Reason</Th>
                  </tr>
                </thead>
                <tbody>
                  {preview.willSkip.map((skip) => (
                    <Tr key={skip.serviceAccountId}>
                      <Td>
                        <span className="font-mono text-[13px]">{skip.accountNumber}</span>
                      </Td>
                      <Td>{skip.subscriberName}</Td>
                      <Td className="text-muted-foreground">{skip.reason}</Td>
                    </Tr>
                  ))}
                </tbody>
              </DataTable>
            </SectionCard>
          )}
        </>
      )}
    </div>
  );
}

function Summary({
  label,
  value,
  emphasis = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly emphasis?: boolean;
}): JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={`mt-1 tabular-nums ${emphasis ? 'text-lg font-semibold' : 'text-sm'} text-foreground`}
      >
        {value}
      </p>
    </div>
  );
}

/** The previous calendar month, which is the one usually being billed. */
function defaultMonth(): string {
  const now = new Date();
  const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return previous.toISOString().slice(0, 7);
}
