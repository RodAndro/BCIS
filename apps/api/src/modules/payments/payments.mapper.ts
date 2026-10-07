import type { PaymentDetail, PaymentSummary } from '@bcis/validation';

import type { AllocationRow, PaymentRow } from './payments.repository';

/**
 * Row → DTO for payments.
 *
 * Money columns are already integer centavos; only the dates need to become
 * ISO strings. The payment method and status strings are validated at the
 * boundary by Zod, so they pass through as-is.
 */

function toIso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

export function toPaymentSummary(row: PaymentRow): PaymentSummary {
  return {
    id: row.id,
    receiptNumber: row.receiptNumber,
    subscriberId: row.subscriberId,
    subscriberAccountNumber: row.subscriberAccountNumber,
    subscriberName: row.subscriberName,
    serviceAccountId: row.serviceAccountId,
    serviceAccountNumber: row.serviceAccountNumber,
    paymentDate: row.paymentDate.toISOString(),
    paymentMethod: row.paymentMethod as PaymentSummary['paymentMethod'],
    amountCentavos: row.amountCentavos,
    appliedCentavos: row.appliedCentavos,
    unappliedCentavos: row.unappliedCentavos,
    status: row.status as PaymentSummary['status'],
    referenceNumber: row.referenceNumber,
    senderName: row.senderName,
    senderMobile: row.senderMobile,
    receivedByUsername: row.receivedByUsername,
    verifiedAt: toIso(row.verifiedAt),
    rejectionReason: row.rejectionReason,
    postedAt: toIso(row.postedAt),
    reversedAt: toIso(row.reversedAt),
    createdAt: row.createdAt.toISOString(),
  };
}

export function toPaymentDetail(
  row: PaymentRow,
  allocations: readonly AllocationRow[],
): PaymentDetail {
  return {
    ...toPaymentSummary(row),
    allocations: allocations.map((allocation) => ({
      invoiceId: allocation.invoiceId,
      invoiceNumber: allocation.invoiceNumber,
      amountCentavos: allocation.amountCentavos,
    })),
  };
}
