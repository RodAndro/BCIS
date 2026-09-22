/**
 * Payment vocabulary.
 *
 * Lives in `@bcis/shared` for the same reason the invoice statuses do: the Zod
 * schemas, the API service, and the SQL CHECK constraints are all written
 * against one list, so a state cannot exist in code and be missing from the
 * database.
 */

export const PAYMENT_METHODS = ['CASH', 'GCASH', 'BANK_TRANSFER', 'CHEQUE', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  GCASH: 'GCash',
  BANK_TRANSFER: 'Bank transfer',
  CHEQUE: 'Cheque',
  OTHER: 'Other',
};

export const PAYMENT_STATUSES = ['PENDING_VERIFICATION', 'POSTED', 'REJECTED', 'REVERSED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  PENDING_VERIFICATION: 'Awaiting verification',
  POSTED: 'Posted',
  REJECTED: 'Rejected',
  REVERSED: 'Reversed',
};

export const RECEIPT_STATUSES = ['ISSUED', 'VOID'] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

/**
 * Whether a payment of this method must be verified before it is posted.
 *
 * ── WHY THIS IS A RULE AND NOT A UI CHOICE ──────────────────────────────────
 * Cash is in the cashier's hand: the money exists the moment it is taken, so the
 * payment posts at capture. GCash and bank transfers are a claim about money in
 * somebody else's account, and a screenshot is not proof that it arrived.
 * §11 requires those to wait for a person to confirm, so the rule lives here
 * and the service enforces it in both directions — a cash payment cannot be
 * parked awaiting verification, and a GCash one cannot skip it.
 */
export function paymentMethodRequiresVerification(method: PaymentMethod): boolean {
  return method === 'GCASH' || method === 'BANK_TRANSFER';
}

/** Whether the method carries a reference number that can be duplicated. */
export function paymentMethodCarriesReference(method: PaymentMethod): boolean {
  return method === 'GCASH' || method === 'BANK_TRANSFER' || method === 'CHEQUE';
}

/**
 * A payment can only be reversed from POSTED.
 *
 * A pending payment was never posted, so there is nothing to reverse — it is
 * rejected instead. A rejected one is already refused, and a reversed one has
 * already been undone; reversing twice would credit the customer twice.
 */
export function canReversePayment(status: PaymentStatus): boolean {
  return status === 'POSTED';
}
