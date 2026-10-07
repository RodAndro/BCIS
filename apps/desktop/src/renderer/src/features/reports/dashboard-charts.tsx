import type { Dashboard } from '@bcis/validation';
import type { JSX } from 'react';
import { formatMoney } from '@renderer/lib/money';

interface DashboardChartsProps {
  readonly dashboard: Dashboard;
}

interface BarDatum {
  readonly label: string;
  readonly value: number;
  readonly color: string;
}

const AGING_COLORS = ['#0474c4', '#5379ae', '#06457f', '#a15c07', '#b42318'] as const;

const PAYMENT_COLORS: Record<string, string> = {
  CASH: '#0474c4',
  GCASH: '#0f7a53',
  BANK_TRANSFER: '#06457f',
  CHEQUE: '#a15c07',
  OTHER: '#5379ae',
};

export function DashboardCharts({ dashboard }: DashboardChartsProps): JSX.Element {
  const aging: readonly BarDatum[] = [
    { label: 'Current', value: dashboard.aging.currentCentavos, color: AGING_COLORS[0] },
    { label: '1–30 days', value: dashboard.aging.bucket1To30Centavos, color: AGING_COLORS[1] },
    { label: '31–60 days', value: dashboard.aging.bucket31To60Centavos, color: AGING_COLORS[2] },
    { label: '61–90 days', value: dashboard.aging.bucket61To90Centavos, color: AGING_COLORS[3] },
    { label: '90+ days', value: dashboard.aging.bucket90PlusCentavos, color: AGING_COLORS[4] },
  ];

  const paymentMethods: readonly BarDatum[] = dashboard.paymentMethods.map((payment) => ({
    label: payment.method.replaceAll('_', ' '),
    value: payment.amountCentavos,
    color: PAYMENT_COLORS[payment.method] ?? '#0474c4',
  }));

  return (
    <section aria-label="Financial charts" className="grid gap-3 lg:grid-cols-2">
      <ChartPanel title="Receivables by age" description="Outstanding balance by days overdue.">
        <HorizontalBarChart items={aging} emptyMessage="No receivable balance to age." />
      </ChartPanel>
      <ChartPanel title="Collections by method" description="Posted payments this period.">
        <HorizontalBarChart
          items={paymentMethods}
          emptyMessage="No collections recorded this period."
        />
      </ChartPanel>
    </section>
  );
}

function ChartPanel({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description: string;
  readonly children: JSX.Element;
}): JSX.Element {
  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-panel">
      <header className="mb-4">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </header>
      {children}
    </section>
  );
}

function HorizontalBarChart({
  items,
  emptyMessage,
}: {
  readonly items: readonly BarDatum[];
  readonly emptyMessage: string;
}): JSX.Element {
  const maximum = Math.max(0, ...items.map((item) => item.value));

  if (maximum === 0) {
    return (
      <p className="py-5 text-center text-xs text-muted-foreground" role="status">
        {emptyMessage}
      </p>
    );
  }

  return (
    <ol className="space-y-3" aria-label="Chart values">
      {items.map((item) => {
        const width = item.value === 0 ? 0 : Math.max((item.value / maximum) * 100, 1);
        return (
          <li
            key={item.label}
            className="grid grid-cols-[minmax(76px,0.8fr)_minmax(40px,1.5fr)_auto] items-center gap-2"
          >
            <span className="truncate text-xs text-foreground" title={item.label}>
              {item.label}
            </span>
            <span className="block h-2.5 overflow-hidden rounded-sm bg-muted" aria-hidden="true">
              <span
                className="block h-full rounded-sm"
                style={{ width: `${width}%`, backgroundColor: item.color }}
              />
            </span>
            <span className="min-w-20 text-right text-xs tabular-nums text-foreground">
              {formatMoney(item.value)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}