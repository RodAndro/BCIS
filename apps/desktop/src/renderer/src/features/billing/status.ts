import type { StatusTone } from '@renderer/components/status-pill';

/**
 * Invoice status presentation.
 *
 * The seven states the specification names, including the derived OVERDUE. Each
 * is paired with a text label on screen, never colour alone: a status misread on
 * a washed-out monitor is a balance misread.
 */
const TONES: Record<string, StatusTone> = {
  DRAFT: 'pending',
  UNPAID: 'warning',
  PARTIALLY_PAID: 'warning',
  OVERDUE: 'danger',
  PAID: 'success',
  VOID: 'neutral',
  CREDITED: 'neutral',
};

export function invoiceStatusTone(status: string): StatusTone {
  return TONES[status] ?? 'neutral';
}

/** The label shown for a line item, so the type is never an unexplained code. */
export const ITEM_TYPE_LABELS: Record<string, string> = {
  SUBSCRIPTION: 'Subscription',
  INSTALLATION: 'Installation',
  RECONNECTION: 'Reconnection',
  DISCOUNT: 'Discount',
  PENALTY: 'Penalty',
  ADJUSTMENT: 'Adjustment',
};

export const LEDGER_ENTRY_LABELS: Record<string, string> = {
  INVOICE: 'Invoice',
  PAYMENT: 'Payment',
  ADJUSTMENT: 'Adjustment',
  REVERSAL: 'Reversal',
  CREDIT_APPLIED: 'Credit applied',
  CREDIT_ISSUED: 'Credit issued',
};
