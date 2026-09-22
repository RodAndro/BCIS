import { schema } from '@bcis/database';
import type { SubscriberListQuery } from '@bcis/validation';
import { and, asc, count, eq, inArray, sql, type SQL } from 'drizzle-orm';

import type { Executor, Tx } from '../../shared/database';
import { buildSubscriberSearchCondition } from '../search/search.service';

/**
 * Subscriber queries.
 *
 * ── WHY THE LIST IS ASSEMBLED FROM THREE QUERIES ────────────────────────────
 * Service counts and contacts are aggregated separately for the page's ids
 * rather than joined. A join across subscribers × addresses × contacts ×
 * service accounts multiplies rows, and the de-duplication that follows is both
 * slower and easier to get wrong than three indexed reads. This matters at the
 * §21 target of 20,000 subscribers; it is invisible at 50.
 */

export interface SubscriberRow {
  readonly id: number;
  readonly accountNumber: string;
  readonly displayName: string;
  readonly subscriberType: string;
  readonly status: string;
  readonly collectionAreaId: number | null;
  readonly collectionAreaName: string | null;
  readonly assignedCollectorId: number | null;
  readonly assignedCollectorName: string | null;
  readonly billingDay: number;
  readonly dueDay: number;
  readonly notes: string | null;
  readonly createdAt: Date;
  readonly archivedAt: Date | null;
  readonly serviceCount: number;
  readonly activeServiceCount: number;
  readonly primaryContact: string | null;
}

export interface AddressRow {
  readonly id: number;
  readonly addressType: string;
  readonly label: string | null;
  readonly line1: string;
  readonly line2: string | null;
  readonly barangay: string | null;
  readonly cityMunicipality: string | null;
  readonly province: string | null;
  readonly postalCode: string | null;
  readonly isPrimary: boolean;
}

export interface ContactRow {
  readonly id: number;
  readonly contactType: string;
  readonly value: string;
  readonly isPrimary: boolean;
}

const listProjection = {
  id: schema.subscribers.id,
  accountNumber: schema.subscribers.accountNumber,
  displayName: schema.subscribers.displayName,
  subscriberType: schema.subscribers.subscriberType,
  status: schema.subscribers.status,
  collectionAreaId: schema.subscribers.collectionAreaId,
  collectionAreaName: schema.collectionAreas.name,
  assignedCollectorId: schema.subscribers.assignedCollectorId,
  assignedCollectorName: schema.users.fullName,
  billingDay: schema.subscribers.billingDay,
  dueDay: schema.subscribers.dueDay,
  notes: schema.subscribers.notes,
  createdAt: schema.subscribers.createdAt,
  archivedAt: schema.subscribers.archivedAt,
} as const;

export function buildSubscriberFilters(query: SubscriberListQuery): SQL | undefined {
  const conditions: SQL[] = [];

  if (query.status !== undefined) {
    conditions.push(eq(schema.subscribers.status, query.status));
  }

  if (query.subscriberType !== undefined) {
    conditions.push(eq(schema.subscribers.subscriberType, query.subscriberType));
  }

  if (query.collectionAreaId !== undefined) {
    conditions.push(eq(schema.subscribers.collectionAreaId, query.collectionAreaId));
  }

  if (query.search !== undefined) {
    // The provider registry decides what "search" means. This file does not
    // need to change when invoice or receipt numbers become searchable.
    const search = buildSubscriberSearchCondition(query.search);
    if (search !== undefined) conditions.push(search);
  }

  if (conditions.length === 0) return undefined;
  return and(...conditions);
}

async function loadServiceCounts(
  db: Executor,
  subscriberIds: readonly number[],
): Promise<Map<number, { total: number; active: number }>> {
  const counts = new Map<number, { total: number; active: number }>();
  if (subscriberIds.length === 0) return counts;

  const rows = await db
    .select({
      subscriberId: schema.serviceAccounts.subscriberId,
      total: count(),
      // One pass, two numbers. `filter` is cheaper than two round trips and
      // keeps the "active" definition in exactly one place.
      active: sql<number>`count(*) filter (where ${schema.serviceAccounts.status} = 'ACTIVE')::int`,
    })
    .from(schema.serviceAccounts)
    .where(inArray(schema.serviceAccounts.subscriberId, [...subscriberIds]))
    .groupBy(schema.serviceAccounts.subscriberId);

  for (const row of rows) {
    counts.set(row.subscriberId, { total: row.total, active: Number(row.active) });
  }
  return counts;
}

/**
 * The contact to show in a list.
 *
 * Preference order is deliberate: a primary mobile is what a collector dials,
 * so it wins over a primary landline, which wins over a non-primary mobile.
 */
async function loadDisplayContacts(
  db: Executor,
  subscriberIds: readonly number[],
): Promise<Map<number, string>> {
  const chosen = new Map<number, string>();
  if (subscriberIds.length === 0) return chosen;

  const rows = await db
    .select({
      subscriberId: schema.subscriberContacts.subscriberId,
      contactType: schema.subscriberContacts.contactType,
      value: schema.subscriberContacts.value,
      isPrimary: schema.subscriberContacts.isPrimary,
    })
    .from(schema.subscriberContacts)
    .where(inArray(schema.subscriberContacts.subscriberId, [...subscriberIds]));

  const score = (row: (typeof rows)[number]): number => {
    if (row.isPrimary && row.contactType === 'MOBILE') return 0;
    if (row.isPrimary) return 1;
    if (row.contactType === 'MOBILE') return 2;
    return 3;
  };

  const best = new Map<number, { score: number; value: string }>();

  for (const row of rows) {
    const rowScore = score(row);
    const current = best.get(row.subscriberId);

    if (current === undefined || rowScore < current.score) {
      best.set(row.subscriberId, { score: rowScore, value: row.value });
    }
  }

  for (const [subscriberId, entry] of best) {
    chosen.set(subscriberId, entry.value);
  }

  return chosen;
}

async function hydrate(
  db: Executor,
  rows: readonly Omit<SubscriberRow, 'serviceCount' | 'activeServiceCount' | 'primaryContact'>[],
): Promise<readonly SubscriberRow[]> {
  const ids = rows.map((row) => row.id);
  const [counts, contacts] = await Promise.all([
    loadServiceCounts(db, ids),
    loadDisplayContacts(db, ids),
  ]);

  return rows.map((row) => ({
    ...row,
    serviceCount: counts.get(row.id)?.total ?? 0,
    activeServiceCount: counts.get(row.id)?.active ?? 0,
    primaryContact: contacts.get(row.id) ?? null,
  }));
}

export async function listSubscribers(
  db: Executor,
  query: SubscriberListQuery,
  offset: number,
): Promise<readonly SubscriberRow[]> {
  const rows = await db
    .select(listProjection)
    .from(schema.subscribers)
    .leftJoin(
      schema.collectionAreas,
      eq(schema.subscribers.collectionAreaId, schema.collectionAreas.id),
    )
    .leftJoin(schema.users, eq(schema.subscribers.assignedCollectorId, schema.users.id))
    .where(buildSubscriberFilters(query))
    .orderBy(asc(schema.subscribers.displayName), asc(schema.subscribers.id))
    .limit(query.pageSize)
    .offset(offset);

  return hydrate(db, rows);
}

export async function countSubscribers(db: Executor, query: SubscriberListQuery): Promise<number> {
  const rows = await db
    .select({ total: count() })
    .from(schema.subscribers)
    .where(buildSubscriberFilters(query));

  return rows[0]?.total ?? 0;
}

export async function findSubscriberRow(
  db: Executor,
  subscriberId: number,
): Promise<SubscriberRow | null> {
  const rows = await db
    .select(listProjection)
    .from(schema.subscribers)
    .leftJoin(
      schema.collectionAreas,
      eq(schema.subscribers.collectionAreaId, schema.collectionAreas.id),
    )
    .leftJoin(schema.users, eq(schema.subscribers.assignedCollectorId, schema.users.id))
    .where(eq(schema.subscribers.id, subscriberId))
    .limit(1);

  const row = rows[0];
  if (row === undefined) return null;

  const hydrated = await hydrate(db, [row]);
  return hydrated[0] ?? null;
}

export async function listAddresses(
  db: Executor,
  subscriberId: number,
): Promise<readonly AddressRow[]> {
  return db
    .select({
      id: schema.subscriberAddresses.id,
      addressType: schema.subscriberAddresses.addressType,
      label: schema.subscriberAddresses.label,
      line1: schema.subscriberAddresses.line1,
      line2: schema.subscriberAddresses.line2,
      barangay: schema.subscriberAddresses.barangay,
      cityMunicipality: schema.subscriberAddresses.cityMunicipality,
      province: schema.subscriberAddresses.province,
      postalCode: schema.subscriberAddresses.postalCode,
      isPrimary: schema.subscriberAddresses.isPrimary,
    })
    .from(schema.subscriberAddresses)
    .where(eq(schema.subscriberAddresses.subscriberId, subscriberId))
    .orderBy(asc(schema.subscriberAddresses.addressType), asc(schema.subscriberAddresses.id));
}

export async function listContacts(
  db: Executor,
  subscriberId: number,
): Promise<readonly ContactRow[]> {
  return db
    .select({
      id: schema.subscriberContacts.id,
      contactType: schema.subscriberContacts.contactType,
      value: schema.subscriberContacts.value,
      isPrimary: schema.subscriberContacts.isPrimary,
    })
    .from(schema.subscriberContacts)
    .where(eq(schema.subscriberContacts.subscriberId, subscriberId))
    .orderBy(asc(schema.subscriberContacts.contactType), asc(schema.subscriberContacts.id));
}

export async function subscriberAccountNumberExists(
  db: Executor,
  accountNumber: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.subscribers.id })
    .from(schema.subscribers)
    .where(eq(schema.subscribers.accountNumber, accountNumber))
    .limit(1);

  return rows.length > 0;
}

export interface InsertSubscriberValues {
  readonly accountNumber: string;
  readonly displayName: string;
  readonly subscriberType: string;
  readonly collectionAreaId: number | null;
  readonly assignedCollectorId: number | null;
  readonly billingDay: number;
  readonly dueDay: number;
  readonly notes: string | null;
  readonly createdBy: number | null;
}

export async function insertSubscriber(tx: Tx, values: InsertSubscriberValues): Promise<number> {
  const rows = await tx
    .insert(schema.subscribers)
    .values({ ...values, updatedBy: values.createdBy })
    .returning({ id: schema.subscribers.id });

  const id = rows[0]?.id;
  if (id === undefined) throw new Error('Inserting a subscriber returned no id.');
  return id;
}

export async function updateSubscriberRow(
  tx: Tx,
  subscriberId: number,
  values: {
    readonly displayName: string;
    readonly subscriberType: string;
    readonly collectionAreaId: number | null;
    readonly assignedCollectorId: number | null;
    readonly billingDay: number;
    readonly dueDay: number;
    readonly notes: string | null;
  },
  updatedBy: number | null,
): Promise<void> {
  await tx
    .update(schema.subscribers)
    .set({ ...values, updatedAt: new Date(), updatedBy })
    .where(eq(schema.subscribers.id, subscriberId));
}

export async function setSubscriberStatusRow(
  tx: Tx,
  subscriberId: number,
  status: string,
  archivedAt: Date | null,
  updatedBy: number | null,
): Promise<void> {
  await tx
    .update(schema.subscribers)
    .set({ status, archivedAt, updatedAt: new Date(), updatedBy })
    .where(eq(schema.subscribers.id, subscriberId));
}

/** Address ids that a service account depends on as its installation address. */
export async function findAddressesInUse(
  db: Executor,
  addressIds: readonly number[],
): Promise<readonly number[]> {
  if (addressIds.length === 0) return [];

  const rows = await db
    .select({ id: schema.serviceAccounts.installationAddressId })
    .from(schema.serviceAccounts)
    .where(inArray(schema.serviceAccounts.installationAddressId, [...addressIds]));

  return rows.map((row) => row.id).filter((id): id is number => id !== null);
}

export async function deleteAddresses(tx: Tx, addressIds: readonly number[]): Promise<void> {
  if (addressIds.length === 0) return;
  await tx
    .delete(schema.subscriberAddresses)
    .where(inArray(schema.subscriberAddresses.id, [...addressIds]));
}

export interface AddressValues {
  readonly addressType: string;
  readonly label: string | null;
  readonly line1: string;
  readonly line2: string | null;
  readonly barangay: string | null;
  readonly cityMunicipality: string | null;
  readonly province: string | null;
  readonly postalCode: string | null;
  readonly isPrimary: boolean;
}

export async function insertAddress(
  tx: Tx,
  subscriberId: number,
  values: AddressValues,
  createdBy: number | null,
): Promise<void> {
  await tx
    .insert(schema.subscriberAddresses)
    .values({ ...values, subscriberId, createdBy, updatedBy: createdBy });
}

export async function updateAddressRow(
  tx: Tx,
  addressId: number,
  values: AddressValues,
  updatedBy: number | null,
): Promise<void> {
  await tx
    .update(schema.subscriberAddresses)
    .set({ ...values, updatedAt: new Date(), updatedBy })
    .where(eq(schema.subscriberAddresses.id, addressId));
}

export async function deleteContacts(tx: Tx, contactIds: readonly number[]): Promise<void> {
  if (contactIds.length === 0) return;
  await tx
    .delete(schema.subscriberContacts)
    .where(inArray(schema.subscriberContacts.id, [...contactIds]));
}

export interface ContactValues {
  readonly contactType: string;
  readonly value: string;
  readonly isPrimary: boolean;
}

export async function insertContact(
  tx: Tx,
  subscriberId: number,
  values: ContactValues,
  createdBy: number | null,
): Promise<void> {
  await tx
    .insert(schema.subscriberContacts)
    .values({ ...values, subscriberId, createdBy, updatedBy: createdBy });
}

export async function updateContactRow(
  tx: Tx,
  contactId: number,
  values: ContactValues,
  updatedBy: number | null,
): Promise<void> {
  await tx
    .update(schema.subscriberContacts)
    .set({ ...values, updatedAt: new Date(), updatedBy })
    .where(eq(schema.subscriberContacts.id, contactId));
}
