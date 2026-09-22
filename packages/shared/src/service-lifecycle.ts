/**
 * Service account lifecycle.
 *
 * ── WHY THIS IS A RULE AND NOT A CHECK CONSTRAINT ───────────────────────────
 * The database constrains which statuses EXIST. Which TRANSITIONS are legal is
 * a business rule, and it depends on where the account is now: `SUSPENDED →
 * ACTIVE` is a reconnection, `ACTIVE → SUSPENDED` is a suspension, and
 * `CLOSED → anything` is a mistake that must be refused rather than recorded.
 *
 * It lives in `@bcis/shared` because both sides of the wire need the same
 * vocabulary — `@bcis/validation` builds its Zod enums from these constants and
 * the API enforces the table below — and `shared` is the only package both may
 * depend on.
 */

export const SERVICE_ACCOUNT_STATUSES = [
  'PENDING',
  'ACTIVE',
  'SUSPENDED',
  'DISCONNECTED',
  'CLOSED',
] as const;

export type ServiceAccountStatus = (typeof SERVICE_ACCOUNT_STATUSES)[number];

/**
 * The legal moves.
 *
 * `CLOSED` is terminal: an account that has been closed is history, and
 * reopening one would silently reuse an account number that a customer's
 * records already refer to. A returning customer gets a new account.
 *
 * `DISCONNECTED` can return to `ACTIVE` because a disconnection is often
 * administrative (a house move, a temporary stop) rather than final.
 */
export const ALLOWED_STATUS_TRANSITIONS: Record<
  ServiceAccountStatus,
  readonly ServiceAccountStatus[]
> = {
  PENDING: ['ACTIVE', 'CLOSED'],
  ACTIVE: ['SUSPENDED', 'DISCONNECTED', 'CLOSED'],
  SUSPENDED: ['ACTIVE', 'DISCONNECTED', 'CLOSED'],
  DISCONNECTED: ['ACTIVE', 'CLOSED'],
  CLOSED: [],
};

/** True when the move is legal. A move to the same status is not a transition. */
export function canTransitionServiceStatus(
  from: ServiceAccountStatus,
  to: ServiceAccountStatus,
): boolean {
  if (from === to) return false;
  return ALLOWED_STATUS_TRANSITIONS[from].includes(to);
}

/** Human labels, for screens and reports. */
export const SERVICE_ACCOUNT_STATUS_LABELS: Record<ServiceAccountStatus, string> = {
  PENDING: 'Pending installation',
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  DISCONNECTED: 'Disconnected',
  CLOSED: 'Closed',
};

export const SERVICE_EVENT_TYPES = [
  'ACTIVATED',
  'STATUS_CHANGED',
  'PLAN_CHANGED',
  'RATE_APPLIED',
  'SUSPENDED',
  'RECONNECTED',
  'DISCONNECTED',
  'CLOSED',
  'TRANSFERRED',
  'ADDRESS_CHANGED',
  'COLLECTOR_CHANGED',
  'NOTE',
] as const;

export type ServiceEventType = (typeof SERVICE_EVENT_TYPES)[number];

/**
 * The event a transition should record.
 *
 * The distinction matters in reports: "suspended" and "reconnected" are
 * different operational stories, and collapsing both into a generic
 * `STATUS_CHANGED` would make the suspension history unreadable.
 */
export function eventTypeForTransition(
  from: ServiceAccountStatus,
  to: ServiceAccountStatus,
): ServiceEventType {
  if (from === 'PENDING' && to === 'ACTIVE') return 'ACTIVATED';
  if (to === 'SUSPENDED') return 'SUSPENDED';
  if (from === 'SUSPENDED' && to === 'ACTIVE') return 'RECONNECTED';
  if (to === 'DISCONNECTED') return 'DISCONNECTED';
  if (to === 'CLOSED') return 'CLOSED';
  return 'STATUS_CHANGED';
}

/** Whether the account is currently delivering service. Phase 4 bills on this. */
export function isServiceDelivering(status: ServiceAccountStatus): boolean {
  return status === 'ACTIVE';
}
