import type { ReportType } from '@bcis/validation';
import type { JSX, KeyboardEvent } from 'react';
import { useEffect, useId, useRef, useState } from 'react';

const REPORTS: readonly { value: ReportType; label: string }[] = [
  { value: 'DAILY_COLLECTION', label: 'Daily collection' },
  { value: 'WEEKLY_COLLECTION', label: 'Weekly collection' },
  { value: 'MONTHLY_COLLECTION', label: 'Monthly collection' },
  { value: 'ANNUAL_COLLECTION', label: 'Annual collection' },
  { value: 'BILLING_VS_COLLECTION', label: 'Billing vs collection' },
  { value: 'AR_AGING', label: 'AR aging' },
  { value: 'OVERDUE_SUBSCRIBERS', label: 'Overdue subscribers' },
  { value: 'SUBSCRIBER_MASTER', label: 'Subscriber master list' },
  { value: 'COLLECTOR_COLLECTION', label: 'Collector collection' },
  { value: 'COLLECTOR_REMITTANCE', label: 'Collector remittance' },
  { value: 'COLLECTOR_VARIANCE', label: 'Collector variance' },
  { value: 'COLLECTOR_PERFORMANCE', label: 'Collector performance' },
  { value: 'PAYMENT_METHOD_SUMMARY', label: 'Payment method summary' },
  { value: 'REVENUE_BY_PLAN', label: 'Revenue by plan/service' },
  { value: 'PAYMENT_ADJUSTMENTS', label: 'Payment adjustments/reversals' },
  { value: 'VOIDED_RECEIPTS', label: 'Voided receipts' },
  { value: 'USER_ACTIVITY', label: 'User activity' },
];

interface ReportTypeSelectProps {
  readonly value: ReportType;
  readonly onChange: (value: ReportType) => void;
}

export function ReportTypeSelect({ value, onChange }: ReportTypeSelectProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = useId();
  const selectedIndex = Math.max(
    0,
    REPORTS.findIndex((report) => report.value === value),
  );
  const selectedLabel = REPORTS.find((report) => report.value === value)?.label ?? 'Daily collection';

  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  useEffect(() => {
    if (open) optionRefs.current[activeIndex]?.focus();
  }, [activeIndex, open]);

  function openList(): void {
    const trigger = triggerRef.current;
    const main = trigger?.closest('main');
    if (trigger && main) {
      const spaceBelow = main.getBoundingClientRect().bottom - trigger.getBoundingClientRect().bottom;
      if (spaceBelow < 224) trigger.scrollIntoView({ block: 'center' });
    }

    setActiveIndex(selectedIndex);
    setOpen(true);
  }

  function selectReport(report: (typeof REPORTS)[number]): void {
    onChange(report.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function handleOptionKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowDown') nextIndex = Math.min(index + 1, REPORTS.length - 1);
    if (event.key === 'ArrowUp') nextIndex = Math.max(index - 1, 0);
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = REPORTS.length - 1;

    if (nextIndex !== null) {
      event.preventDefault();
      setActiveIndex(nextIndex);
      optionRefs.current[nextIndex]?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  }

  return (
    <div
      ref={rootRef}
      className="relative min-w-0"
      onBlur={(event) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label="Report type"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        className="flex h-11 w-full items-center justify-between rounded-md border border-input bg-surface px-3 text-left text-sm text-foreground shadow-sm transition-colors hover:border-muted-foreground/50 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
        onClick={() => {
          if (open) {
            setOpen(false);
          } else {
            openList();
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            openList();
          }
        }}
      >
        <span>{selectedLabel}</span>
        <span className="ml-3 size-2 shrink-0 rotate-45 border-b-2 border-r-2 border-current" aria-hidden="true" />
      </button>

      {open && (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Reports"
          className="absolute left-0 right-0 top-full z-50 mt-1 overflow-y-auto rounded-md border border-border bg-popover py-1 text-popover-foreground shadow-popover"
          style={{ maxHeight: 224 }}
        >
          {REPORTS.map((report, index) => (
            <button
              key={report.value}
              ref={(element) => {
                optionRefs.current[index] = element;
              }}
              type="button"
              role="option"
              aria-selected={report.value === value}
              tabIndex={-1}
              className={`block w-full px-3 py-2 text-left text-sm ${
                report.value === value
                  ? 'bg-accent text-accent-foreground'
                  : 'text-foreground hover:bg-muted'
              } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent`}
              onFocus={() => setActiveIndex(index)}
              onMouseEnter={() => setActiveIndex(index)}
              onKeyDown={(event) => handleOptionKeyDown(event, index)}
              onClick={() => selectReport(report)}
            >
              {report.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}