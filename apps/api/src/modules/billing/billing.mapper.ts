import { signedCentavos } from '@bcis/shared';
import { displayStatusFor, type InvoiceLine, type StoredInvoiceStatus } from '@bcis/domain';
import type {
  BillingCycleSummary,
  BillingPreviewLine,
  BillingSkip,
  InvoiceDetail,
  InvoiceItem,
  InvoiceSummary,
} from '@bcis/validation';

import type {
  AdjustmentRow,
  BillingCycleRow,
  BillableAccountRow,
  InvoiceItemRow,
  InvoiceRow,
} from './billing.repository';

/**
 * Row → DTO for billing.
 *
 * `displayStatus` is computed here rather than stored: OVERDUE depends on
 * today's date, and a stored flag would be wrong until the next job run. The
 * stored lifecycle and the derived display state are both returned, so a screen
 * can show "PARTIALLY_PAID · overdue" rather than losing one fact to show the
 * other.
 */
export function toInvoiceSummary(row: InvoiceRow, today: string): InvoiceSummary {
  const status = row.status as StoredInvoiceStatus;

  return {
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    subscriberId: row.subscriberId,
    subscriberAccountNumber: row.subscriberAccountNumber,
    subscriberName: row.subscriberName,
    serviceAccountId: row.serviceAccountId,
    serviceAccountNumber: row.serviceAccountNumber,
    planCode: row.planCode,
    billingPeriodStart: row.billingPeriodStart,
    billingPeriodEnd: row.billingPeriodEnd,
    issueDate: row.issueDate,
    dueDate: row.dueDate,
    subtotalCentavos: row.subtotalCentavos,
    discountCentavos: row.discountCentavos,
    penaltyCentavos: row.penaltyCentavos,
    adjustmentCentavos: row.adjustmentCentavos,
    taxCentavos: row.taxCentavos,
    totalCentavos: row.totalCentavos,
    paidCentavos: row.paidCentavos,
    balanceCentavos: row.balanceCentavos,
    status: row.status,
    displayStatus: displayStatusFor({
      status,
      balanceCentavos: signedCentavos(row.balanceCentavos),
      dueDate: row.dueDate,
      today,
    }),
    finalizedAt: row.finalizedAt === null ? null : row.finalizedAt.toISOString(),
    voidedAt: row.voidedAt === null ? null : row.voidedAt.toISOString(),
    voidReason: row.voidReason,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toInvoiceItem(row: InvoiceItemRow): InvoiceItem {
  return {
    id: row.id,
    itemType: row.itemType as InvoiceItem['itemType'],
    direction: row.direction as InvoiceItem['direction'],
    description: row.description,
    quantity: row.quantity,
    unitPriceCentavos: row.unitPriceCentavos,
    amountCentavos: row.amountCentavos,
  };
}

export function toInvoiceDetail(
  row: InvoiceRow,
  items: readonly InvoiceItemRow[],
  adjustments: readonly AdjustmentRow[],
  today: string,
): InvoiceDetail {
  return {
    ...toInvoiceSummary(row, today),
    servicePlanId: row.servicePlanId,
    items: items.map(toInvoiceItem),
    adjustments: adjustments.map((adjustment) => ({
      id: adjustment.id,
      adjustmentType: adjustment.adjustmentType as 'DEBIT' | 'CREDIT',
      reasonCode: adjustment.reasonCode,
      amountCentavos: adjustment.amountCentavos,
      memo: adjustment.memo,
      status: adjustment.status,
      createdAt: adjustment.createdAt.toISOString(),
      createdByUsername: adjustment.createdByUsername,
    })),
  };
}

export function toCycleSummary(row: BillingCycleRow): BillingCycleSummary {
  return {
    id: row.id,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    dueDate: row.dueDate,
    label: row.label,
    status: row.status as BillingCycleSummary['status'],
    generatedAt: row.generatedAt === null ? null : row.generatedAt.toISOString(),
    invoiceCount: row.invoiceCount,
    billedCentavos: Number(row.billedCentavos),
  };
}

export function toPreviewLine(
  account: BillableAccountRow,
  lines: readonly InvoiceLine[],
  dates: { readonly issueDate: string; readonly dueDate: string },
  totalCentavos: number,
): BillingPreviewLine {
  return {
    serviceAccountId: account.id,
    accountNumber: account.accountNumber,
    subscriberAccountNumber: account.subscriberAccountNumber,
    subscriberName: account.subscriberName,
    planCode: account.planCode,
    planName: account.planName,
    issueDate: dates.issueDate,
    dueDate: dates.dueDate,
    items: lines.map((line) => ({
      itemType: line.itemType as 'SUBSCRIPTION' | 'INSTALLATION' | 'RECONNECTION',
      description: line.description,
      quantity: line.quantity,
      unitPriceCentavos: line.unitPriceCentavos,
      amountCentavos: line.amountCentavos,
    })),
    totalCentavos,
  };
}

export function skip(account: BillableAccountRow, reason: string): BillingSkip {
  return {
    serviceAccountId: account.id,
    accountNumber: account.accountNumber,
    subscriberName: account.subscriberName,
    reason,
  };
}
