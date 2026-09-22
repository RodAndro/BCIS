import { ConflictError, NotFoundError, ValidationError } from '@bcis/shared';
import {
  offsetFor,
  type CreateSubscriberInput,
  type SetSubscriberStatusInput,
  type SubscriberAddressInput,
  type SubscriberContactInput,
  type SubscriberDetail,
  type SubscriberListQuery,
  type SubscriberSummary,
  type UpdateSubscriberInput,
} from '@bcis/validation';

import type { Db } from '../../shared/database';
import { NUMBER_SCOPES, allocateDocumentNumber } from '../../shared/numbering';
import type { ActorContext } from '../../shared/request-context';
import { AUDIT_ACTIONS, AUDIT_ENTITIES } from '../audit/audit.actions';
import { writeAudit } from '../audit/audit.service';
import { findCollectionAreaById, isAssignableUser } from '../collection/collection.repository';
import { toSubscriberDetail, toSubscriberSummary } from './subscribers.mapper';
import * as repository from './subscribers.repository';

/**
 * Subscribers.
 *
 * ── WHAT THIS SERVICE GUARDS ────────────────────────────────────────────────
 *   - an account number is unique, and the database enforces it even if two
 *     registrations race past the check
 *   - a referenced collection area or collector actually exists
 *   - an address that a service account is installed at cannot be removed
 *   - a subscriber cannot be archived or terminated while it still has live
 *     service accounts, because that would leave service running for a closed
 *     customer with nothing in the UI to explain it
 */

export interface SubscriberPage {
  readonly subscribers: readonly SubscriberSummary[];
  readonly total: number;
}

export async function listSubscribers(db: Db, query: SubscriberListQuery): Promise<SubscriberPage> {
  const offset = offsetFor(query.page, query.pageSize);

  const [rows, total] = await Promise.all([
    repository.listSubscribers(db, query, offset),
    repository.countSubscribers(db, query),
  ]);

  return { subscribers: rows.map(toSubscriberSummary), total };
}

export async function getSubscriber(db: Db, subscriberId: number): Promise<SubscriberDetail> {
  const row = await repository.findSubscriberRow(db, subscriberId);
  if (row === null) {
    throw new NotFoundError('That subscriber does not exist.');
  }

  const [addresses, contacts] = await Promise.all([
    repository.listAddresses(db, subscriberId),
    repository.listContacts(db, subscriberId),
  ]);

  return toSubscriberDetail(row, addresses, contacts);
}

/** The global search box. Uses the same provider registry as the list filter. */
export async function searchSubscribers(
  db: Db,
  term: string,
  limit: number,
): Promise<readonly SubscriberSummary[]> {
  const rows = await repository.listSubscribers(db, { search: term, page: 1, pageSize: limit }, 0);

  return rows.map(toSubscriberSummary);
}

export async function createSubscriber(
  db: Db,
  input: CreateSubscriberInput,
  actor: ActorContext,
): Promise<SubscriberDetail> {
  if (input.accountNumber !== undefined) {
    if (await repository.subscriberAccountNumberExists(db, input.accountNumber)) {
      throw new ConflictError(`Account number ${input.accountNumber} is already in use.`);
    }
  }

  await assertReferences(db, input.collectionAreaId ?? null, input.assignedCollectorId ?? null);

  const addresses = normaliseAddressPrimaries(input.addresses);
  const contacts = normaliseContactPrimaries(input.contacts);

  const subscriberId = await db.transaction(async (tx) => {
    // Allocated inside the transaction, so a failed registration does not
    // consume a number and two concurrent registrations cannot collide.
    const accountNumber =
      input.accountNumber ?? (await allocateDocumentNumber(tx, NUMBER_SCOPES.SUBSCRIBER));

    const id = await repository.insertSubscriber(tx, {
      accountNumber,
      displayName: input.displayName,
      subscriberType: input.subscriberType,
      collectionAreaId: input.collectionAreaId ?? null,
      assignedCollectorId: input.assignedCollectorId ?? null,
      billingDay: input.billingDay,
      dueDay: input.dueDay,
      notes: input.notes ?? null,
      createdBy: actor.userId,
    });

    for (const address of addresses) {
      await repository.insertAddress(tx, id, toAddressValues(address), actor.userId);
    }

    for (const contact of contacts) {
      await repository.insertContact(tx, id, toContactValues(contact), actor.userId);
    }

    await writeAudit(tx, {
      action: AUDIT_ACTIONS.SUBSCRIBER_CREATED,
      entityType: AUDIT_ENTITIES.SUBSCRIBER,
      entityId: String(id),
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ip: actor.ip,
      newValues: {
        accountNumber,
        displayName: input.displayName,
        subscriberType: input.subscriberType,
        addresses: addresses.length,
        contacts: contacts.length,
      },
    });

    return id;
  });

  return getSubscriber(db, subscriberId);
}

export async function updateSubscriber(
  db: Db,
  subscriberId: number,
  input: UpdateSubscriberInput,
  actor: ActorContext,
): Promise<SubscriberDetail> {
  const existing = await repository.findSubscriberRow(db, subscriberId);
  if (existing === null) {
    throw new NotFoundError('That subscriber does not exist.');
  }

  await assertReferences(db, input.collectionAreaId ?? null, input.assignedCollectorId ?? null);

  await db.transaction(async (tx) => {
    await repository.updateSubscriberRow(
      tx,
      subscriberId,
      {
        displayName: input.displayName,
        subscriberType: input.subscriberType,
        collectionAreaId: input.collectionAreaId ?? null,
        assignedCollectorId: input.assignedCollectorId ?? null,
        billingDay: input.billingDay,
        dueDay: input.dueDay,
        notes: input.notes ?? null,
      },
      actor.userId,
    );

    await writeAudit(tx, {
      action: AUDIT_ACTIONS.SUBSCRIBER_UPDATED,
      entityType: AUDIT_ENTITIES.SUBSCRIBER,
      entityId: String(subscriberId),
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ip: actor.ip,
      oldValues: {
        displayName: existing.displayName,
        subscriberType: existing.subscriberType,
        billingDay: existing.billingDay,
        dueDay: existing.dueDay,
      },
      newValues: {
        displayName: input.displayName,
        subscriberType: input.subscriberType,
        billingDay: input.billingDay,
        dueDay: input.dueDay,
      },
    });
  });

  return getSubscriber(db, subscriberId);
}

/**
 * Change status.
 *
 * ── THE GUARD THAT MATTERS ──────────────────────────────────────────────────
 * Archiving or terminating a subscriber that still has live service accounts
 * would leave billed service attached to a closed customer. The operator is
 * told to disconnect first, which is a real step with its own history record.
 */
export async function setSubscriberStatus(
  db: Db,
  subscriberId: number,
  input: SetSubscriberStatusInput,
  actor: ActorContext,
): Promise<SubscriberDetail> {
  const existing = await repository.findSubscriberRow(db, subscriberId);
  if (existing === null) {
    throw new NotFoundError('That subscriber does not exist.');
  }

  const closing = input.status === 'ARCHIVED' || input.status === 'TERMINATED';
  if (closing && existing.activeServiceCount > 0) {
    throw new ConflictError(
      `This subscriber still has ${String(existing.activeServiceCount)} active service account(s). ` +
        'Close them before archiving or terminating the subscriber.',
    );
  }

  // `archived_at` records WHEN the record was archived; the other statuses are
  // operational states that can be reversed.
  const archivedAt = input.status === 'ARCHIVED' ? new Date() : null;

  await db.transaction(async (tx) => {
    await repository.setSubscriberStatusRow(
      tx,
      subscriberId,
      input.status,
      archivedAt,
      actor.userId,
    );

    await writeAudit(tx, {
      action: AUDIT_ACTIONS.SUBSCRIBER_STATUS_CHANGED,
      entityType: AUDIT_ENTITIES.SUBSCRIBER,
      entityId: String(subscriberId),
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ip: actor.ip,
      reason: input.reason ?? null,
      oldValues: { status: existing.status },
      newValues: { status: input.status },
    });
  });

  return getSubscriber(db, subscriberId);
}

/**
 * Replace the address set.
 *
 * Rows are matched by id, so an address that a service account points at is
 * updated rather than recreated, and an address still in use cannot be dropped.
 */
export async function replaceAddresses(
  db: Db,
  subscriberId: number,
  addresses: readonly SubscriberAddressInput[],
  actor: ActorContext,
): Promise<SubscriberDetail> {
  const existing = await repository.listAddresses(db, subscriberId);
  const existingIds = new Set(existing.map((address) => address.id));

  const incoming = normaliseAddressPrimaries([...addresses]);
  const keptIds = new Set<number>();

  for (const address of incoming) {
    if (address.id === undefined) continue;
    if (!existingIds.has(address.id)) {
      throw new ValidationError(
        `Address ${String(address.id)} does not belong to this subscriber.`,
        { field: 'addresses' },
      );
    }
    keptIds.add(address.id);
  }

  const removals = existing.filter((address) => !keptIds.has(address.id)).map((a) => a.id);

  if (removals.length > 0) {
    const inUse = await repository.findAddressesInUse(db, removals);
    if (inUse.length > 0) {
      throw new ConflictError(
        `Address ${inUse.join(', ')} is the installation address of a service account, ` +
          'so it cannot be removed. Change that account first.',
      );
    }
  }

  await db.transaction(async (tx) => {
    await repository.deleteAddresses(tx, removals);

    for (const address of incoming) {
      const values = toAddressValues(address);
      if (address.id === undefined) {
        await repository.insertAddress(tx, subscriberId, values, actor.userId);
      } else {
        await repository.updateAddressRow(tx, address.id, values, actor.userId);
      }
    }

    await writeAudit(tx, {
      action: AUDIT_ACTIONS.SUBSCRIBER_ADDRESSES_CHANGED,
      entityType: AUDIT_ENTITIES.SUBSCRIBER,
      entityId: String(subscriberId),
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ip: actor.ip,
      oldValues: { count: existing.length },
      newValues: { count: incoming.length, removed: removals },
    });
  });

  return getSubscriber(db, subscriberId);
}

/** Replace the contact set. Contacts hold no foreign keys, so removal is safe. */
export async function replaceContacts(
  db: Db,
  subscriberId: number,
  contacts: readonly SubscriberContactInput[],
  actor: ActorContext,
): Promise<SubscriberDetail> {
  const existing = await repository.listContacts(db, subscriberId);
  const existingIds = new Set(existing.map((contact) => contact.id));

  const incoming = normaliseContactPrimaries([...contacts]);
  const keptIds = new Set<number>();

  for (const contact of incoming) {
    if (contact.id === undefined) continue;
    if (!existingIds.has(contact.id)) {
      throw new ValidationError(
        `Contact ${String(contact.id)} does not belong to this subscriber.`,
        { field: 'contacts' },
      );
    }
    keptIds.add(contact.id);
  }

  const removals = existing.filter((contact) => !keptIds.has(contact.id)).map((c) => c.id);

  await db.transaction(async (tx) => {
    await repository.deleteContacts(tx, removals);

    for (const contact of incoming) {
      const values = toContactValues(contact);
      if (contact.id === undefined) {
        await repository.insertContact(tx, subscriberId, values, actor.userId);
      } else {
        await repository.updateContactRow(tx, contact.id, values, actor.userId);
      }
    }

    await writeAudit(tx, {
      action: AUDIT_ACTIONS.SUBSCRIBER_CONTACTS_CHANGED,
      entityType: AUDIT_ENTITIES.SUBSCRIBER,
      entityId: String(subscriberId),
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ip: actor.ip,
      oldValues: { count: existing.length },
      newValues: { count: incoming.length, removed: removals },
    });
  });

  return getSubscriber(db, subscriberId);
}

/** Both foreign keys must point at something real before a write happens. */
async function assertReferences(
  db: Db,
  collectionAreaId: number | null,
  assignedCollectorId: number | null,
): Promise<void> {
  if (collectionAreaId !== null) {
    const area = await findCollectionAreaById(db, collectionAreaId);
    if (area === null) {
      throw new ValidationError('That collection area does not exist.', {
        field: 'collectionAreaId',
      });
    }
  }

  if (assignedCollectorId !== null) {
    if (!(await isAssignableUser(db, assignedCollectorId))) {
      throw new ValidationError('That collector does not exist.', { field: 'assignedCollectorId' });
    }
  }
}

function toAddressValues(address: SubscriberAddressInput): repository.AddressValues {
  return {
    addressType: address.addressType,
    label: address.label ?? null,
    line1: address.line1,
    line2: address.line2 ?? null,
    barangay: address.barangay ?? null,
    cityMunicipality: address.cityMunicipality ?? null,
    province: address.province ?? null,
    postalCode: address.postalCode ?? null,
    isPrimary: address.isPrimary,
  };
}

function toContactValues(contact: SubscriberContactInput): repository.ContactValues {
  return {
    contactType: contact.contactType,
    value: contact.value,
    isPrimary: contact.isPrimary,
  };
}

/**
 * If a type has exactly one entry and none is flagged primary, flag it.
 *
 * Without this a subscriber registered with a single mobile number would have
 * no primary contact, and the list would show a blank phone column for a
 * customer who plainly has one.
 */
function normaliseAddressPrimaries(
  addresses: readonly SubscriberAddressInput[],
): SubscriberAddressInput[] {
  const byType = new Map<string, SubscriberAddressInput[]>();
  for (const address of addresses) {
    const list = byType.get(address.addressType);
    if (list === undefined) byType.set(address.addressType, [address]);
    else list.push(address);
  }

  return addresses.map((address) => {
    const sameType = byType.get(address.addressType) ?? [];
    const anyPrimary = sameType.some((candidate) => candidate.isPrimary);
    if (!anyPrimary && sameType.length === 1) {
      return { ...address, isPrimary: true };
    }
    return address;
  });
}

function normaliseContactPrimaries(
  contacts: readonly SubscriberContactInput[],
): SubscriberContactInput[] {
  const byType = new Map<string, SubscriberContactInput[]>();
  for (const contact of contacts) {
    const list = byType.get(contact.contactType);
    if (list === undefined) byType.set(contact.contactType, [contact]);
    else list.push(contact);
  }

  return contacts.map((contact) => {
    const sameType = byType.get(contact.contactType) ?? [];
    const anyPrimary = sameType.some((candidate) => candidate.isPrimary);
    if (!anyPrimary && sameType.length === 1) {
      return { ...contact, isPrimary: true };
    }
    return contact;
  });
}
