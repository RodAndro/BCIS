import { Button } from '@renderer/components/ui/button';
import { Alert, PageHeader, SectionCard } from '@renderer/components/ui/feedback';
import { CheckboxRow, Field, Input, Select } from '@renderer/components/ui/form';
import {
  useCollectionAreas,
  useCollectors,
} from '@renderer/features/subscribers/use-reference-data';
import type { JSX } from 'react';
import { useState } from 'react';

/**
 * Register a subscriber.
 *
 * ── WHY THE FORM VALIDATES NOTHING ITSELF ───────────────────────────────────
 * The API owns the rules: the mobile format, the primary-per-type constraint,
 * the uniqueness of an account number. Re-implementing them here would create a
 * second copy that drifts, and the copy the user sees would be the one that is
 * wrong. The form therefore sends what was typed and shows the API's message
 * against the form.
 *
 * The account number is optional and lives behind a disclosure: the API
 * allocates one unless a migrated subscriber already has a number.
 */

interface AddressDraft {
  readonly key: number;
  addressType: 'SERVICE' | 'BILLING' | 'MAILING';
  line1: string;
  barangay: string;
  cityMunicipality: string;
  province: string;
  isPrimary: boolean;
}

interface ContactDraft {
  readonly key: number;
  contactType: 'MOBILE' | 'LANDLINE' | 'EMAIL';
  value: string;
  isPrimary: boolean;
}

let nextKey = 1;

export interface NewSubscriberScreenProps {
  readonly onCreated: (subscriberId: number) => void;
  readonly onCancel: () => void;
}

export function NewSubscriberScreen({
  onCreated,
  onCancel,
}: NewSubscriberScreenProps): JSX.Element {
  const areas = useCollectionAreas();
  const collectors = useCollectors();

  const [displayName, setDisplayName] = useState('');
  const [subscriberType, setSubscriberType] = useState('RESIDENTIAL');
  const [collectionAreaId, setCollectionAreaId] = useState('');
  const [assignedCollectorId, setAssignedCollectorId] = useState('');
  const [billingDay, setBillingDay] = useState(1);
  const [dueDay, setDueDay] = useState(15);
  const [notes, setNotes] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [addresses, setAddresses] = useState<AddressDraft[]>([
    {
      key: nextKey++,
      addressType: 'SERVICE',
      line1: '',
      barangay: '',
      cityMunicipality: 'Malaybalay',
      province: 'Bukidnon',
      isPrimary: true,
    },
  ]);
  const [contacts, setContacts] = useState<ContactDraft[]>([
    { key: nextKey++, contactType: 'MOBILE', value: '', isPrimary: true },
  ]);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const usableAddresses = addresses.filter((address) => address.line1.trim().length > 0);
  const usableContacts = contacts.filter((contact) => contact.value.trim().length > 0);
  const canSubmit = displayName.trim().length > 0 && !busy;

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);

    const result = await window.bcis.subscribers.create({
      displayName: displayName.trim(),
      subscriberType: subscriberType as 'RESIDENTIAL' | 'COMMERCIAL' | 'GOVERNMENT',
      ...(accountNumber.trim().length > 0 ? { accountNumber: accountNumber.trim() } : {}),
      ...(collectionAreaId === '' ? {} : { collectionAreaId: Number(collectionAreaId) }),
      ...(assignedCollectorId === '' ? {} : { assignedCollectorId: Number(assignedCollectorId) }),
      billingDay,
      dueDay,
      ...(notes.trim().length > 0 ? { notes: notes.trim() } : {}),
      addresses: usableAddresses.map((address) => ({
        addressType: address.addressType,
        line1: address.line1.trim(),
        ...(address.barangay.trim().length > 0 ? { barangay: address.barangay.trim() } : {}),
        ...(address.cityMunicipality.trim().length > 0
          ? { cityMunicipality: address.cityMunicipality.trim() }
          : {}),
        ...(address.province.trim().length > 0 ? { province: address.province.trim() } : {}),
        isPrimary: address.isPrimary,
      })),
      contacts: usableContacts.map((contact) => ({
        contactType: contact.contactType,
        value: contact.value.trim(),
        isPrimary: contact.isPrimary,
      })),
    });

    if (!result.ok || result.item === null) {
      setError(result.error ?? 'Could not register the subscriber.');
      setBusy(false);
      return;
    }

    setBusy(false);
    onCreated(result.item.id);
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <PageHeader
        title="New subscriber"
        description="The account number is allocated automatically unless an existing number is supplied."
        actions={
          <>
            <Button onClick={onCancel}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!canSubmit}
              onClick={() => {
                void submit();
              }}
            >
              {busy ? 'Registering…' : 'Register subscriber'}
            </Button>
          </>
        }
      />

      {error !== null && (
        <Alert tone="danger" title="Could not register the subscriber">
          {error}
        </Alert>
      )}

      <SectionCard title="Account">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            {({ id, invalid }) => (
              <Input
                id={id}
                value={displayName}
                invalid={invalid}
                placeholder="Household or business name"
                onChange={(event) => {
                  setDisplayName(event.target.value);
                }}
              />
            )}
          </Field>

          <Field label="Subscriber type">
            {({ id }) => (
              <Select
                id={id}
                value={subscriberType}
                onChange={(event) => {
                  setSubscriberType(event.target.value);
                }}
              >
                <option value="RESIDENTIAL">Residential</option>
                <option value="COMMERCIAL">Commercial</option>
                <option value="GOVERNMENT">Government</option>
              </Select>
            )}
          </Field>

          <Field label="Collection area">
            {({ id }) => (
              <Select
                id={id}
                value={collectionAreaId}
                onChange={(event) => {
                  setCollectionAreaId(event.target.value);
                }}
              >
                <option value="">Not assigned yet</option>
                {(areas.data?.items ?? []).map((area) => (
                  <option key={area.id} value={String(area.id)}>
                    {area.code} — {area.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Assigned collector">
            {({ id }) => (
              <Select
                id={id}
                value={assignedCollectorId}
                onChange={(event) => {
                  setAssignedCollectorId(event.target.value);
                }}
              >
                <option value="">Not assigned yet</option>
                {(collectors.data?.items ?? []).map((collector) => (
                  <option key={collector.id} value={String(collector.id)}>
                    {collector.fullName}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Billing day" hint="1–28, so every month has that day.">
            {({ id }) => (
              <Input
                id={id}
                type="number"
                min={1}
                max={28}
                value={billingDay}
                onChange={(event) => {
                  setBillingDay(Number(event.target.value));
                }}
              />
            )}
          </Field>

          <Field label="Due day" hint="1–28, when payment is expected.">
            {({ id }) => (
              <Input
                id={id}
                type="number"
                min={1}
                max={28}
                value={dueDay}
                onChange={(event) => {
                  setDueDay(Number(event.target.value));
                }}
              />
            )}
          </Field>
        </div>

        <div className="mt-4">
          <CheckboxRow
            checked={showAdvanced}
            onChange={setShowAdvanced}
            label="Migrating an existing account number"
          />
        </div>

        {showAdvanced && (
          <div className="mt-3 max-w-xs">
            <Field label="Account number" hint="Must be unique. Leave blank to allocate one.">
              {({ id, invalid }) => (
                <Input
                  id={id}
                  value={accountNumber}
                  invalid={invalid}
                  placeholder="LEGACY-00001"
                  onChange={(event) => {
                    setAccountNumber(event.target.value);
                  }}
                />
              )}
            </Field>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Addresses"
        description="The service address is where a technician is sent; the billing address is where the statement goes."
        actions={
          <Button
            size="sm"
            onClick={() => {
              setAddresses((current) => [
                ...current,
                {
                  key: nextKey++,
                  addressType: 'SERVICE',
                  line1: '',
                  barangay: '',
                  cityMunicipality: 'Malaybalay',
                  province: 'Bukidnon',
                  isPrimary: false,
                },
              ]);
            }}
          >
            Add address
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          {addresses.map((address) => (
            <div
              key={address.key}
              className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-[10rem_1fr_12rem_12rem_auto]"
            >
              <Select
                aria-label="Address type"
                value={address.addressType}
                onChange={(event) => {
                  updateAddress(address.key, {
                    addressType: event.target.value as AddressDraft['addressType'],
                  });
                }}
              >
                <option value="SERVICE">Service</option>
                <option value="BILLING">Billing</option>
                <option value="MAILING">Mailing</option>
              </Select>

              <Input
                aria-label="Street"
                placeholder="Street and number"
                value={address.line1}
                onChange={(event) => {
                  updateAddress(address.key, { line1: event.target.value });
                }}
              />

              <Input
                aria-label="Barangay"
                placeholder="Barangay"
                value={address.barangay}
                onChange={(event) => {
                  updateAddress(address.key, { barangay: event.target.value });
                }}
              />

              <Input
                aria-label="City or municipality"
                placeholder="City / municipality"
                value={address.cityMunicipality}
                onChange={(event) => {
                  updateAddress(address.key, { cityMunicipality: event.target.value });
                }}
              />

              <div className="flex items-center gap-3">
                <CheckboxRow
                  checked={address.isPrimary}
                  onChange={(checked) => {
                    updateAddress(address.key, { isPrimary: checked });
                  }}
                  label="Primary"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={addresses.length === 1}
                  onClick={() => {
                    setAddresses((current) =>
                      current.filter((candidate) => candidate.key !== address.key),
                    );
                  }}
                >
                  Remove
                </Button>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        title="Contacts"
        description="A mobile number is what a collector dials, so it is validated for the Philippine format."
        actions={
          <Button
            size="sm"
            onClick={() => {
              setContacts((current) => [
                ...current,
                { key: nextKey++, contactType: 'MOBILE', value: '', isPrimary: false },
              ]);
            }}
          >
            Add contact
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          {contacts.map((contact) => (
            <div
              key={contact.key}
              className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-[10rem_1fr_auto]"
            >
              <Select
                aria-label="Contact type"
                value={contact.contactType}
                onChange={(event) => {
                  updateContact(contact.key, {
                    contactType: event.target.value as ContactDraft['contactType'],
                  });
                }}
              >
                <option value="MOBILE">Mobile</option>
                <option value="LANDLINE">Landline</option>
                <option value="EMAIL">Email</option>
              </Select>

              <Input
                aria-label="Contact detail"
                placeholder="09171234567"
                value={contact.value}
                onChange={(event) => {
                  updateContact(contact.key, { value: event.target.value });
                }}
              />

              <div className="flex items-center gap-3">
                <CheckboxRow
                  checked={contact.isPrimary}
                  onChange={(checked) => {
                    updateContact(contact.key, { isPrimary: checked });
                  }}
                  label="Primary"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={contacts.length === 1}
                  onClick={() => {
                    setContacts((current) =>
                      current.filter((candidate) => candidate.key !== contact.key),
                    );
                  }}
                >
                  Remove
                </Button>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Notes">
        <Field label="Internal notes">
          {({ id }) => (
            <Input
              id={id}
              value={notes}
              placeholder="Anything the next person should know"
              onChange={(event) => {
                setNotes(event.target.value);
              }}
            />
          )}
        </Field>
      </SectionCard>
    </div>
  );

  function updateAddress(key: number, patch: Partial<AddressDraft>): void {
    setAddresses((current) =>
      current.map((address) => (address.key === key ? { ...address, ...patch } : address)),
    );
  }

  function updateContact(key: number, patch: Partial<ContactDraft>): void {
    setContacts((current) =>
      current.map((contact) => (contact.key === key ? { ...contact, ...patch } : contact)),
    );
  }
}
