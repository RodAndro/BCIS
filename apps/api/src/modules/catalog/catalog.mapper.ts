import type { PlanSummary, ServiceTypeCode, ServiceTypeSummary } from '@bcis/validation';

import type { PlanRow, ServiceTypeRow } from './catalog.repository';

/**
 * Row → DTO for the plan catalog.
 *
 * `monthlyFeeCentavos` passes through untouched: it is already an integer count
 * of centavos, and formatting happens at the edge. There is deliberately no
 * conversion to a peso number anywhere in this file.
 */

export function toPlanSummary(row: PlanRow): PlanSummary {
  return {
    id: row.id,
    code: row.code,
    serviceTypeCode: row.serviceTypeCode as ServiceTypeCode,
    serviceTypeName: row.serviceTypeName,
    name: row.name,
    description: row.description,
    speedMbps: row.speedMbps,
    channelCount: row.channelCount,
    monthlyFeeCentavos: row.monthlyFeeCentavos,
    installationFeeCentavos: row.installationFeeCentavos,
    reconnectionFeeCentavos: row.reconnectionFeeCentavos,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    status: row.status as PlanSummary['status'],
    // "Current" is derived from the open-ended version, not from the status: a
    // RETIRED plan version is still the current one for the accounts billed on
    // it. Conflating the two would hide a retired plan's live accounts.
    isCurrent: row.effectiveTo === null,
    serviceAccountCount: row.serviceAccountCount,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toServiceTypeSummary(row: ServiceTypeRow): ServiceTypeSummary {
  return {
    id: row.id,
    code: row.code as ServiceTypeCode,
    name: row.name,
    description: row.description,
    planCount: row.planCount,
  };
}
