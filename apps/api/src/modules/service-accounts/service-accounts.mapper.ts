import type { ServiceAccountDetail, ServiceAccountSummary, ServiceEvent } from '@bcis/validation';

import type { ServiceAccountRow, ServiceEventRow } from './service-accounts.repository';

/**
 * Row → DTO for service accounts.
 *
 * `planCurrentPriceCentavos` is carried alongside the account's own rate so the
 * UI can mark an account as "on an older rate" without a second request and
 * without pretending the two are the same number.
 */
export function toServiceAccountSummary(row: ServiceAccountRow): ServiceAccountSummary {
  return {
    id: row.id,
    accountNumber: row.accountNumber,
    subscriberId: row.subscriberId,
    subscriberAccountNumber: row.subscriberAccountNumber,
    subscriberName: row.subscriberName,
    servicePlanId: row.servicePlanId,
    planCode: row.planCode,
    planName: row.planName,
    serviceTypeCode: row.serviceTypeCode as ServiceAccountSummary['serviceTypeCode'],
    serviceTypeName: row.serviceTypeName,
    status: row.status as ServiceAccountSummary['status'],
    activationDate: row.activationDate,
    billingStartDate: row.billingStartDate,
    billingDay: row.billingDay,
    dueDay: row.dueDay,
    currentPlanPriceCentavos: row.currentPlanPriceCentavos,
    planCurrentPriceCentavos: row.planCurrentPriceCentavos,
    assignedCollectorId: row.assignedCollectorId,
    assignedCollectorName: row.assignedCollectorName,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toServiceEvent(row: ServiceEventRow): ServiceEvent {
  return {
    id: row.id,
    eventType: row.eventType as ServiceEvent['eventType'],
    fromValue: row.fromValue,
    toValue: row.toValue,
    effectiveDate: row.effectiveDate,
    reason: row.reason,
    actorUsername: row.actorUsername,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toServiceAccountDetail(
  row: ServiceAccountRow,
  plan: ServiceAccountDetail['plan'],
  installationAddress: ServiceAccountDetail['installationAddress'],
  events: readonly ServiceEventRow[],
): ServiceAccountDetail {
  return {
    ...toServiceAccountSummary(row),
    notes: row.notes,
    plan,
    installationAddress,
    events: events.map(toServiceEvent),
  };
}
