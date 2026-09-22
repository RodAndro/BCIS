import type { SubscriberDetail, SubscriberSummary } from '@bcis/validation';

import type { AddressRow, ContactRow, SubscriberRow } from './subscribers.repository';

/**
 * Row → DTO for subscribers.
 *
 * Timestamps become ISO strings at the edge so the client has one
 * representation to format, in Asia/Manila, on every workstation.
 */
export function toSubscriberSummary(row: SubscriberRow): SubscriberSummary {
  return {
    id: row.id,
    accountNumber: row.accountNumber,
    displayName: row.displayName,
    subscriberType: row.subscriberType as SubscriberSummary['subscriberType'],
    status: row.status as SubscriberSummary['status'],
    collectionAreaId: row.collectionAreaId,
    collectionAreaName: row.collectionAreaName,
    assignedCollectorId: row.assignedCollectorId,
    assignedCollectorName: row.assignedCollectorName,
    billingDay: row.billingDay,
    dueDay: row.dueDay,
    serviceCount: row.serviceCount,
    activeServiceCount: row.activeServiceCount,
    primaryContact: row.primaryContact,
    createdAt: row.createdAt.toISOString(),
    archivedAt: row.archivedAt === null ? null : row.archivedAt.toISOString(),
  };
}

export function toAddress(address: AddressRow): SubscriberDetail['addresses'][number] {
  return {
    id: address.id,
    addressType: address.addressType as SubscriberDetail['addresses'][number]['addressType'],
    label: address.label ?? undefined,
    line1: address.line1,
    line2: address.line2 ?? undefined,
    barangay: address.barangay ?? undefined,
    cityMunicipality: address.cityMunicipality ?? undefined,
    province: address.province ?? undefined,
    postalCode: address.postalCode ?? undefined,
    isPrimary: address.isPrimary,
  };
}

export function toContact(contact: ContactRow): SubscriberDetail['contacts'][number] {
  return {
    id: contact.id,
    contactType: contact.contactType as SubscriberDetail['contacts'][number]['contactType'],
    value: contact.value,
    isPrimary: contact.isPrimary,
  };
}

export function toSubscriberDetail(
  row: SubscriberRow,
  addresses: readonly AddressRow[],
  contacts: readonly ContactRow[],
): SubscriberDetail {
  return {
    ...toSubscriberSummary(row),
    notes: row.notes,
    addresses: addresses.map(toAddress),
    contacts: contacts.map(toContact),
  };
}
