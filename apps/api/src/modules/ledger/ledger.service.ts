import { NotFoundError } from '@bcis/shared';
import { offsetFor, type LedgerQuery, type LedgerStatement } from '@bcis/validation';

import type { Db } from '../../shared/database';
import { findServiceAccountRow } from '../service-accounts/service-accounts.repository';
import { findSubscriberRow } from '../subscribers/subscribers.repository';
import { toLedgerEntry } from './ledger.mapper';
import {
  countLedgerEntries,
  ledgerTotals,
  listLedgerEntries,
  openingBalance,
  type LedgerScope,
} from './ledger.repository';

/**
 * The subscriber ledger.
 *
 * ── WHAT A STATEMENT IS ─────────────────────────────────────────────────────
 * A chronological list of immutable facts — charges on one side, reductions on
 * the other — and the running balance they produce. The balance at any row is
 * `opening + sum(debits so far) - sum(credits so far)`, computed in SQL from
 * the entries themselves. Nothing on this screen is a stored total, so it can
 * always be recomputed and always agrees with itself.
 *
 * Phase 4 exercises the debit side. Payments arrive in Phase 5 and slot into the
 * same table with `entry_type = 'PAYMENT'`; nothing here changes when they do.
 */

async function buildStatement(
  db: Db,
  scope: LedgerScope,
  query: LedgerQuery,
  head: LedgerStatement['subscriber'],
  serviceAccount: LedgerStatement['serviceAccount'],
): Promise<LedgerStatement> {
  const range = { from: query.from, to: query.to };
  const offset = offsetFor(query.page, query.pageSize);

  const [entries, opening, totals] = await Promise.all([
    listLedgerEntries(db, scope, range, offset, query.pageSize),
    openingBalance(db, scope, query.from),
    ledgerTotals(db, scope, range),
  ]);

  return {
    subscriber: head,
    serviceAccount,
    entries: entries.map((entry) => toLedgerEntry(entry, opening)),
    openingBalanceCentavos: opening,
    closingBalanceCentavos: opening + totals.debitCentavos - totals.creditCentavos,
    totalDebitCentavos: totals.debitCentavos,
    totalCreditCentavos: totals.creditCentavos,
  };
}

/** Every entry for one subscriber, across all of their accounts. */
export async function subscriberStatement(
  db: Db,
  subscriberId: number,
  query: LedgerQuery,
): Promise<LedgerStatement> {
  const subscriber = await findSubscriberRow(db, subscriberId);
  if (subscriber === null) {
    throw new NotFoundError('That subscriber does not exist.');
  }

  return buildStatement(
    db,
    {
      partitionBy: 'subscriber',
      id: subscriberId,
      ...(query.serviceAccountId === undefined ? {} : { serviceAccountId: query.serviceAccountId }),
    },
    query,
    {
      id: subscriber.id,
      accountNumber: subscriber.accountNumber,
      displayName: subscriber.displayName,
    },
    null,
  );
}

/** One account's statement. Used by the service account view. */
export async function accountStatement(
  db: Db,
  serviceAccountId: number,
  query: LedgerQuery,
): Promise<LedgerStatement> {
  const account = await findServiceAccountRow(db, serviceAccountId);
  if (account === null) {
    throw new NotFoundError('That service account does not exist.');
  }

  const statement = await buildStatement(
    db,
    { partitionBy: 'account', id: serviceAccountId },
    query,
    {
      id: account.subscriberId,
      accountNumber: account.subscriberAccountNumber,
      displayName: account.subscriberName,
    },
    { id: account.id, accountNumber: account.accountNumber, planName: account.planName },
  );

  return statement;
}

/** How many entries a statement would contain, for the pager. */
export async function countStatementEntries(
  db: Db,
  scope: LedgerScope,
  query: LedgerQuery,
): Promise<number> {
  return countLedgerEntries(db, scope, { from: query.from, to: query.to });
}
