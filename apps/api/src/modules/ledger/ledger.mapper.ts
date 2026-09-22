import type { LedgerEntry } from '@bcis/validation';

import type { LedgerEntryRow } from './ledger.repository';

/**
 * Row → DTO for the ledger.
 *
 * The stored running balance is relative to the statement's window, so the
 * opening balance is added here. The result is still a pure function of the
 * entries — nothing is read from a stored total.
 */
export function toLedgerEntry(row: LedgerEntryRow, openingCentavos: number): LedgerEntry {
  return {
    id: row.id,
    entryDate: row.entryDate,
    entryType: row.entryType as LedgerEntry['entryType'],
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    referenceNo: row.referenceNo,
    description: row.description,
    debitCentavos: row.debitCentavos,
    creditCentavos: row.creditCentavos,
    balanceCentavos: openingCentavos + row.balanceCentavos,
    createdAt: row.createdAt.toISOString(),
  };
}
