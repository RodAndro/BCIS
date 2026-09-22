import type { BillingCycleSummary, BillingDashboard } from '@bcis/validation';
import { useQuery } from '@tanstack/react-query';
import { StatusPill, type StatusTone } from '@renderer/components/status-pill';
import { Alert, PageHeader, SectionCard } from '@renderer/components/ui/feedback';
import { DataTable, EmptyRow, Th, Td, Tr } from '@renderer/components/ui/table';
import { formatInstant } from '@renderer/lib/format';
import { formatMoney } from '@renderer/lib/money';
import type { JSX } from 'react';

/**
 * Billing dashboard.
 *
 * ── WHAT IS DELIBERATELY ABSENT ─────────────────────────────────────────────
 * There is no AR aging here. Aging buckets are a receivables concern and arrive
 * in Phase 7; a half-built version now would put a number on screen that nobody
 * could reconcile against the ledger. What is here is billing: what was charged,
 * what is still open, and what is past its due date.
 */
export function BillingDashboardScreen(): JSX.Element {
  const dashboard = useQuery({
    queryKey: ['billing-dashboard'],
    queryFn: () => window.bcis.billing.dashboard(),
  });

  const data: BillingDashboard | null = dashboard.data?.item ?? null;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHeader
        title="Current Billing"
        description="What has been charged, what is still owed, and which cycles have run."
      />

      {dashboard.data?.ok === false && (
        <Alert tone="danger" title="Could not load the billing dashboard">
          {dashboard.data.error ?? 'Unknown error.'}
        </Alert>
      )}

      {data !== null && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Figure
              label={`Billed in ${data.currentPeriod.label}`}
              value={formatMoney(data.billedThisPeriodCentavos)}
              detail={`${String(data.invoicesThisPeriod)} invoice(s)`}
            />
            <Figure
              label="Outstanding"
              value={formatMoney(data.outstandingCentavos)}
              detail={`${String(data.openInvoices)} open invoice(s)`}
            />
            <Figure
              label="Overdue"
              value={formatMoney(data.overdueCentavos)}
              detail={`${String(data.overdueInvoices)} past the due date`}
              tone={data.overdueInvoices > 0 ? 'danger' : 'success'}
            />
            <Figure
              label="Drafts"
              value={String(data.draftInvoices)}
              detail="Prepared but not posted"
              tone={data.draftInvoices > 0 ? 'warning' : 'success'}
            />
          </div>

          <SectionCard
            title="Recent billing cycles"
            description="A cycle's billed total counts only its live invoices; voided ones are excluded."
          >
            <DataTable className="border-0">
              <thead>
                <tr>
                  <Th>Period</Th>
                  <Th>Status</Th>
                  <Th align="right">Invoices</Th>
                  <Th align="right">Billed</Th>
                  <Th>Generated</Th>
                </tr>
              </thead>
              <tbody>
                {data.lastCycles.length === 0 && (
                  <EmptyRow colSpan={5}>
                    No billing has been generated yet. Use Generate billing to run a period.
                  </EmptyRow>
                )}

                {data.lastCycles.map((cycle) => (
                  <CycleRow key={cycle.id} cycle={cycle} />
                ))}
              </tbody>
            </DataTable>
          </SectionCard>
        </>
      )}

      {dashboard.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
    </div>
  );
}

function CycleRow({ cycle }: { readonly cycle: BillingCycleSummary }): JSX.Element {
  const tones: Record<string, StatusTone> = {
    OPEN: 'pending',
    GENERATING: 'warning',
    GENERATED: 'success',
    CLOSED: 'neutral',
    LOCKED: 'neutral',
  };

  return (
    <Tr>
      <Td>{cycle.label}</Td>
      <Td>
        <StatusPill tone={tones[cycle.status] ?? 'neutral'} label={cycle.status} />
      </Td>
      <Td align="right">{cycle.invoiceCount}</Td>
      <Td align="right">{formatMoney(cycle.billedCentavos)}</Td>
      <Td className="text-muted-foreground">
        {cycle.generatedAt === null ? '—' : formatInstant(cycle.generatedAt)}
      </Td>
    </Tr>
  );
}

function Figure({
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly tone?: StatusTone;
}): JSX.Element {
  const valueTone: Record<StatusTone, string> = {
    success: 'text-foreground',
    warning: 'text-amber-700',
    danger: 'text-red-700',
    pending: 'text-foreground',
    neutral: 'text-foreground',
  };

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${valueTone[tone]}`}>{value}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{detail}</p>
    </section>
  );
}
