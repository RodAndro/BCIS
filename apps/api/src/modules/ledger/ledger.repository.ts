import { schema } from '@bcis/database';
import { and, count, eq, sql, type SQL } from 'drizzle-orm';

import type { Executor } from '../../shared/database';

/**
 * Ledger queries.
 *
 * ── THE BALANCE IS COMPUTED, NEVER READ ─────────────────────────────────────
 * Every function here derives the running balance from the entries themselves.
 * There is no `balance_centavos` column to read, and therefore no column that
 * can disagree with the entries that produced it.
 *
 * The window function orders by `(entry_date, id)`. The id tiebreak matters:
 * two entries on the same day would otherwise order by whatever the database
 * happened to return, so the same statement could show two different running
 * balances on two runs. That is unacceptable in a ledger.
 */

export interface LedgerEntryRow {
  readonly id: number;
  readonly entryDate: string;
  readonly entryType: string;
  readonly sourceType: string;
  readonly sourceId: number;
  readonly referenceNo: string | null;
  readonly description: string;
  readonly debitCentavos: number;
  readonly creditCentavos: number;
  /** Running balance AFTER this entry, including the statement's opening balance. */
  readonly balanceCentavos: number;
  readonly createdAt: Date;
}

export interface InsertLedgerEntryValues {
  readonly serviceAccountId: number;
  readonly subscriberId: number;
  readonly entryDate: string;
  readonly entryType: string;
  readonly sourceType: string;
  readonly sourceId: number;
  readonly referenceNo: string | null;
  readonly description: string;
  readonly debitCentavos: number;
  readonly creditCentavos: number;
  readonly actorUserId: number | null;
}

/**
 * Post one ledger entry.
 *
 * Called inside the transaction that creates the document it belongs to, so the
 * entry and the document commit together or not at all. The unique index on
 * `(source_type, source_id, entry_type)` means calling it twice for the same
 * document fails loudly rather than doubling a balance.
 */
export async function insertLedgerEntry(
  db: Executor,
  values: InsertLedgerEntryValues,
): Promise<void> {
  await db.insert(schema.ledgerEntries).values(values);
}

/** Whether a document has already been posted, for an idempotency check. */
export async function ledgerEntryExists(
  db: Executor,
  sourceType: string,
  sourceId: number,
  entryType: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.ledgerEntries.id })
    .from(schema.ledgerEntries)
    .where(
      and(
        eq(schema.ledgerEntries.sourceType, sourceType),
        eq(schema.ledgerEntries.sourceId, sourceId),
        eq(schema.ledgerEntries.entryType, entryType),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

export interface LedgerScope {
  /** Which column the running balance restarts on. */
  readonly partitionBy: 'subscriber' | 'account';
  /** The subscriber or service account the statement is for. */
  readonly id: number;
  /** Narrows a subscriber statement to one of that subscriber's accounts. */
  readonly serviceAccountId?: number | undefined;
}

/** Conditions for a scope. */
function buildScopeFilter(scope: LedgerScope): SQL[] {
  const conditions: SQL[] = [];

  if (scope.partitionBy === 'subscriber') {
    conditions.push(eq(schema.ledgerEntries.subscriberId, scope.id));
    if (scope.serviceAccountId !== undefined) {
      conditions.push(eq(schema.ledgerEntries.serviceAccountId, scope.serviceAccountId));
    }
  } else {
    conditions.push(eq(schema.ledgerEntries.serviceAccountId, scope.id));
  }

  return conditions;
}

/**
 * The balance carried into a statement, i.e. everything before `from`.
 *
 * A statement that opened at zero would be wrong for any account with history,
 * and wrong in the direction that makes a customer look like they owe more than
 * they do.
 */
export async function openingBalance(
  db: Executor,
  scope: LedgerScope,
  before: string | undefined,
): Promise<number> {
  if (before === undefined) return 0;

  const conditions = buildScopeFilter(scope);
  conditions.push(sql`${schema.ledgerEntries.entryDate} < ${before}`);

  const rows = await db
    .select({
      balance: sql<number>`COALESCE(
        SUM(${schema.ledgerEntries.debitCentavos}) - SUM(${schema.ledgerEntries.creditCentavos}), 0
      )::bigint`,
    })
    .from(schema.ledgerEntries)
    .where(and(...conditions));

  return Number(rows[0]?.balance ?? 0);
}

/** Whether a subscriber or account has any ledger history at all. */
export async function hasLedgerEntries(db: Executor, scope: LedgerScope): Promise<boolean> {
  const conditions = buildScopeFilter(scope);
  if (conditions.length === 0) return false;

  const rows = await db
    .select({ id: schema.ledgerEntries.id })
    .from(schema.ledgerEntries)
    .where(and(...conditions))
    .limit(1);

  return rows.length > 0;
}

export interface LedgerRange {
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}

/** Scope plus date bounds, as one condition. */
function buildRangeFilter(scope: LedgerScope, range: LedgerRange): SQL | undefined {
  const conditions = buildScopeFilter(scope);

  if (range.from !== undefined) {
    conditions.push(sql`${schema.ledgerEntries.entryDate} >= ${range.from}`);
  }
  if (range.to !== undefined) {
    conditions.push(sql`${schema.ledgerEntries.entryDate} <= ${range.to}`);
  }

  if (conditions.length === 0) return undefined;
  return and(...conditions);
}

/**
 * A page of the statement, each row carrying its running balance.
 *
 * ── WHY THIS IS RAW SQL ─────────────────────────────────────────────────────
 * The balance is a window function over the account's whole history, ordered by
 * `(entry_date, id)`. Paging with the query builder and then summing in
 * JavaScript would compute the balance over the page instead of over the
 * account — the one thing a statement must not do. The partition column is
 * chosen from a closed set here, never interpolated from input.
 */
export async function listLedgerEntries(
  db: Executor,
  scope: LedgerScope,
  range: LedgerRange,
  offset: number,
  limit: number,
): Promise<readonly LedgerEntryRow[]> {
  const partitionColumn =
    scope.partitionBy === 'subscriber'
      ? sql`${schema.ledgerEntries.subscriberId}`
      : sql`${schema.ledgerEntries.serviceAccountId}`;

  const from = range.from ?? null;
  const to = range.to ?? null;

  const conditions = buildScopeFilter(scope);
  conditions.push(sql`(${from}::date IS NULL OR entry_date >= ${from}::date)`);
  conditions.push(sql`(${to}::date IS NULL OR entry_date <= ${to}::date)`);
  const whereClause = sql.join(conditions, sql` AND `);

  const result = await db.execute<{
    id: number;
    entry_date: string;
    entry_type: string;
    source_type: string;
    source_id: number;
    reference_no: string | null;
    description: string;
    debit_centavos: number;
    credit_centavos: number;
    running_balance_centavos: number;
    created_at: Date;
  }>(sql`
    WITH ordered AS (
      SELECT
        id,
        entry_date,
        entry_type,
        source_type,
        source_id,
        reference_no,
        description,
        debit_centavos,
        credit_centavos,
        created_at,
        SUM(debit_centavos) OVER w - SUM(credit_centavos) OVER w AS running_balance_centavos
      FROM ledger_entries
      WHERE ${whereClause}
      WINDOW w AS (
        PARTITION BY ${partitionColumn}
        ORDER BY entry_date, id
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      )
    )
    SELECT * FROM ordered
    ORDER BY entry_date DESC, id DESC
    LIMIT ${limit} OFFSET ${offset}
  `);

  return (result.rows as readonly Record<string, unknown>[]).map((row) => ({
    id: Number(row['id']),
    entryDate: String(row['entry_date']),
    entryType: String(row['entry_type']),
    sourceType: String(row['source_type']),
    sourceId: Number(row['source_id']),
    referenceNo: row['reference_no'] === null ? null : String(row['reference_no']),
    description: String(row['description']),
    debitCentavos: Number(row['debit_centavos']),
    creditCentavos: Number(row['credit_centavos']),
    balanceCentavos: Number(row['running_balance_centavos']),
    createdAt:
      row['created_at'] instanceof Date ? row['created_at'] : new Date(String(row['created_at'])),
  }));
}

export async function countLedgerEntries(
  db: Executor,
  scope: LedgerScope,
  range: LedgerRange,
): Promise<number> {
  const rows = await db
    .select({ total: count() })
    .from(schema.ledgerEntries)
    .where(buildRangeFilter(scope, range));

  return rows[0]?.total ?? 0;
}

/** Totals over the whole filtered set, for the statement footer. */
export async function ledgerTotals(
  db: Executor,
  scope: LedgerScope,
  range: LedgerRange,
): Promise<{ debitCentavos: number; creditCentavos: number }> {
  const rows = await db
    .select({
      debit: sql<number>`COALESCE(SUM(${schema.ledgerEntries.debitCentavos}), 0)::bigint`,
      credit: sql<number>`COALESCE(SUM(${schema.ledgerEntries.creditCentavos}), 0)::bigint`,
    })
    .from(schema.ledgerEntries)
    .where(buildRangeFilter(scope, range));

  return {
    debitCentavos: Number(rows[0]?.debit ?? 0),
    creditCentavos: Number(rows[0]?.credit ?? 0),
  };
}
