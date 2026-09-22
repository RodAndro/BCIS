import type { RoleCode } from '@bcis/shared';
import type { UserSummary } from '@bcis/validation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { StatusPill, type StatusTone } from '@renderer/components/status-pill';
import { Button } from '@renderer/components/ui/button';
import { Alert, PageHeader } from '@renderer/components/ui/feedback';
import { CheckboxRow, Field, Input, Select } from '@renderer/components/ui/form';
import { Modal } from '@renderer/components/ui/overlay';
import { DataTable, EmptyRow, Th, Td, Tr } from '@renderer/components/ui/table';
import { Pager } from '@renderer/components/ui/pager';
import { useAuth } from '@renderer/features/auth/auth-context';
import { RolesPanel } from '@renderer/features/users/roles-panel';
import { useRoles } from '@renderer/features/users/use-roles';
import { formatInstant, roleLabel } from '@renderer/lib/format';
import type { JSX } from 'react';
import { useState } from 'react';

/**
 * Users & Roles.
 *
 * ── SERVER-AUTHORITATIVE ────────────────────────────────────────────────────
 * Every button here calls the API, which re-checks `user.manage` against the
 * session. Hiding a control the user lacks is cosmetic; the test that matters
 * (AT-10) calls these endpoints directly as a Cashier and expects 403.
 *
 * ── THE TEMPORARY PASSWORD IS SHOWN ONCE ────────────────────────────────────
 * A reset generates a random password, returns it in the response, and never
 * stores or logs it. It is displayed in a modal that cannot be reopened, and
 * the account must change it at next sign-in.
 */

interface UserFilters {
  readonly search: string;
  readonly status: '' | 'ACTIVE' | 'LOCKED' | 'DISABLED';
  readonly page: number;
  readonly pageSize: number;
}

export function UsersScreen(): JSX.Element {
  const queryClient = useQueryClient();
  const { can, state } = useAuth();
  const canManage = can('user.manage');

  const [tab, setTab] = useState<'users' | 'roles'>('users');
  const [filters, setFilters] = useState<UserFilters>({
    search: '',
    status: '',
    page: 1,
    pageSize: 25,
  });

  const users = useQuery({
    queryKey: ['users', filters],
    queryFn: () =>
      window.bcis.users.list({
        search: filters.search.length > 0 ? filters.search : undefined,
        status: filters.status === '' ? undefined : filters.status,
        page: filters.page,
        pageSize: filters.pageSize,
      }),
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<UserSummary | null>(null);
  const [statusTarget, setStatusTarget] = useState<UserSummary | null>(null);
  const [resetTarget, setResetTarget] = useState<UserSummary | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);

  const items = users.data?.items ?? [];

  function refresh(): void {
    void queryClient.invalidateQueries({ queryKey: ['users'] });
    void queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHeader
        title="Users & Roles"
        description="Accounts, role assignment, and what each role is allowed to do."
        actions={
          canManage && tab === 'users' ? (
            <Button
              variant="primary"
              onClick={() => {
                setCreateOpen(true);
              }}
            >
              New user
            </Button>
          ) : undefined
        }
      />

      <div className="flex gap-1 border-b border-border">
        <TabButton
          active={tab === 'users'}
          onClick={() => {
            setTab('users');
          }}
        >
          Users
        </TabButton>
        <TabButton
          active={tab === 'roles'}
          onClick={() => {
            setTab('roles');
          }}
        >
          Roles &amp; permissions
        </TabButton>
      </div>

      {tab === 'roles' ? (
        <RolesPanel canManage={can('role.manage')} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className="w-64">
              <Input
                placeholder="Search username or name"
                value={filters.search}
                onChange={(event) => {
                  setFilters((current) => ({ ...current, search: event.target.value, page: 1 }));
                }}
              />
            </div>

            <div className="w-40">
              <Select
                value={filters.status}
                onChange={(event) => {
                  setFilters((current) => ({
                    ...current,
                    status: event.target.value as UserFilters['status'],
                    page: 1,
                  }));
                }}
              >
                <option value="">All statuses</option>
                <option value="ACTIVE">Active</option>
                <option value="LOCKED">Locked</option>
                <option value="DISABLED">Disabled</option>
              </Select>
            </div>

            <span className="text-xs text-muted-foreground">
              {users.data === undefined ? '' : `${String(users.data.total)} user(s)`}
            </span>
          </div>

          {users.data?.ok === false && (
            <Alert tone="danger" title="Could not load users">
              {users.data.error ?? 'Unknown error.'}
            </Alert>
          )}

          <DataTable>
            <thead>
              <tr>
                <Th>Username</Th>
                <Th>Name</Th>
                <Th>Roles</Th>
                <Th>Status</Th>
                <Th>Last sign-in</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {users.isLoading && <EmptyRow colSpan={6}>Loading…</EmptyRow>}

              {!users.isLoading && items.length === 0 && (
                <EmptyRow colSpan={6}>No users match this filter.</EmptyRow>
              )}

              {items.map((user) => (
                <Tr key={user.id}>
                  <Td>
                    <span className="font-mono text-[13px]">{user.username}</span>
                    {user.id === state.user?.id && (
                      <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        you
                      </span>
                    )}
                  </Td>
                  <Td>{user.fullName}</Td>
                  <Td>{user.roles.map(roleLabel).join(', ') || '—'}</Td>
                  <Td>
                    <UserStatusPill user={user} />
                  </Td>
                  <Td>{formatInstant(user.lastLoginAt)}</Td>
                  <Td align="right">
                    {canManage ? (
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          onClick={() => {
                            setEditing(user);
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => {
                            setResetTarget(user);
                          }}
                        >
                          Reset password
                        </Button>
                        <Button
                          size="sm"
                          variant={user.status === 'ACTIVE' ? 'danger' : 'secondary'}
                          onClick={() => {
                            setStatusTarget(user);
                          }}
                        >
                          {user.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">read-only</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>

          <Pager
            page={filters.page}
            total={users.data?.total ?? 0}
            pageSize={filters.pageSize}
            onChange={(page) => {
              setFilters((current) => ({ ...current, page }));
            }}
          />
        </>
      )}

      <CreateUserModal
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
        }}
        onCreated={refresh}
      />

      {/* Keyed by id so each user opens a fresh form rather than inheriting the
          previous user's values. */}
      <EditUserModal
        key={editing?.id ?? 'none'}
        user={editing}
        onClose={() => {
          setEditing(null);
        }}
        onSaved={refresh}
      />

      <StatusModal
        key={statusTarget?.id ?? 'none'}
        user={statusTarget}
        onClose={() => {
          setStatusTarget(null);
        }}
        onSaved={refresh}
      />

      <ResetPasswordModal
        key={resetTarget?.id ?? 'none'}
        user={resetTarget}
        onClose={() => {
          setResetTarget(null);
        }}
        onReset={(temporary) => {
          setTemporaryPassword(temporary);
          refresh();
        }}
      />

      <Modal
        open={temporaryPassword !== null}
        title="Temporary password"
        description="Shown once. Give it to the user directly; it cannot be retrieved again."
        onClose={() => {
          setTemporaryPassword(null);
        }}
        footer={
          <Button
            variant="primary"
            onClick={() => {
              setTemporaryPassword(null);
            }}
          >
            Done
          </Button>
        }
      >
        <p className="select-text rounded-md border border-border bg-muted px-3 py-2 font-mono text-sm">
          {temporaryPassword}
        </p>
        <p className="mt-3 text-xs text-muted-foreground">
          The user must change this password the next time they sign in.
        </p>
      </Modal>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly children: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={
        active
          ? '-mb-px border-b-2 border-accent px-3 py-2 text-sm font-medium text-foreground'
          : '-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground'
      }
    >
      {children}
    </button>
  );
}

function UserStatusPill({ user }: { readonly user: UserSummary }): JSX.Element {
  if (user.lockedOut) {
    return <StatusPill tone="warning" label="Locked out" />;
  }

  const tones: Record<Uppercase<string>, StatusTone> = {
    ACTIVE: 'success',
    LOCKED: 'warning',
    DISABLED: 'neutral',
  };

  return <StatusPill tone={tones[user.status] ?? 'neutral'} label={user.status} />;
}

function UserForm({
  selected,
  onToggle,
}: {
  readonly selected: readonly RoleCode[];
  readonly onToggle: (code: RoleCode, checked: boolean) => void;
}): JSX.Element {
  const roles = useRoles();

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-xs font-medium text-foreground">Roles</legend>
      {(roles.data?.items ?? []).map((role) => (
        <CheckboxRow
          key={role.code}
          checked={selected.includes(role.code)}
          onChange={(checked) => {
            onToggle(role.code, checked);
          }}
          label={
            <>
              <span className="font-medium">{role.name}</span>
              <span className="ml-2 font-mono text-[11px] text-muted-foreground">{role.code}</span>
            </>
          }
        />
      ))}
    </fieldset>
  );
}

function CreateUserModal({
  open,
  onClose,
  onCreated,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onCreated: () => void;
}): JSX.Element {
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [selected, setSelected] = useState<RoleCode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toggle(code: RoleCode, checked: boolean): void {
    setSelected((current) =>
      checked ? [...current, code] : current.filter((value) => value !== code),
    );
  }

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);

    const result = await window.bcis.users.create({
      username: username.trim(),
      fullName: fullName.trim(),
      password,
      roles: selected,
    });

    if (!result.ok) {
      setError(result.error ?? 'Could not create the user.');
    } else {
      onCreated();
      onClose();
    }

    setBusy(false);
  }

  return (
    <Modal
      open={open}
      title="New user"
      description="A user with no role can sign in and do nothing, so at least one is required."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={
              busy ||
              username.trim().length === 0 ||
              fullName.trim().length === 0 ||
              selected.length === 0
            }
            onClick={() => {
              void submit();
            }}
          >
            {busy ? 'Creating…' : 'Create user'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Username">
          {({ id, invalid }) => (
            <Input
              id={id}
              value={username}
              invalid={invalid}
              onChange={(event) => {
                setUsername(event.target.value);
              }}
            />
          )}
        </Field>

        <Field label="Full name">
          {({ id, invalid }) => (
            <Input
              id={id}
              value={fullName}
              invalid={invalid}
              onChange={(event) => {
                setFullName(event.target.value);
              }}
            />
          )}
        </Field>

        <Field
          label="Password"
          hint="At least 12 characters, with upper and lower case and a digit."
        >
          {({ id, invalid }) => (
            <Input
              id={id}
              type="password"
              value={password}
              invalid={invalid}
              onChange={(event) => {
                setPassword(event.target.value);
              }}
            />
          )}
        </Field>

        <UserForm selected={selected} onToggle={toggle} />

        {error !== null && <Alert tone="danger">{error}</Alert>}
      </div>
    </Modal>
  );
}

function EditUserModal({
  user,
  onClose,
  onSaved,
}: {
  readonly user: UserSummary | null;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}): JSX.Element {
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [selected, setSelected] = useState<RoleCode[]>(user === null ? [] : [...user.roles]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toggle(code: RoleCode, checked: boolean): void {
    setSelected((current) =>
      checked ? [...current, code] : current.filter((value) => value !== code),
    );
  }

  async function submit(): Promise<void> {
    if (user === null) return;
    setBusy(true);
    setError(null);

    const result = await window.bcis.users.update(user.id, {
      fullName: fullName.trim(),
      roles: selected,
    });

    if (!result.ok) {
      setError(result.error ?? 'Could not save the user.');
    } else {
      onSaved();
      onClose();
    }

    setBusy(false);
  }

  return (
    <Modal
      open={user !== null}
      title="Edit user"
      description={user === null ? undefined : user.username}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={busy || fullName.trim().length === 0 || selected.length === 0}
            onClick={() => {
              void submit();
            }}
          >
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Full name">
          {({ id, invalid }) => (
            <Input
              id={id}
              value={fullName}
              invalid={invalid}
              onChange={(event) => {
                setFullName(event.target.value);
              }}
            />
          )}
        </Field>

        <UserForm selected={selected} onToggle={toggle} />

        {error !== null && <Alert tone="danger">{error}</Alert>}
      </div>
    </Modal>
  );
}

function StatusModal({
  user,
  onClose,
  onSaved,
}: {
  readonly user: UserSummary | null;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}): JSX.Element {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const disabling = user?.status === 'ACTIVE';

  async function submit(): Promise<void> {
    if (user === null) return;
    setBusy(true);
    setError(null);

    const result = await window.bcis.users.setStatus(user.id, {
      status: disabling ? 'DISABLED' : 'ACTIVE',
      ...(disabling ? { reason: reason.trim() } : {}),
    });

    if (!result.ok) {
      setError(result.error ?? 'Could not change the account status.');
    } else {
      onSaved();
      onClose();
    }

    setBusy(false);
  }

  return (
    <Modal
      open={user !== null}
      title={disabling ? 'Disable account' : 'Enable account'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant={disabling ? 'danger' : 'primary'}
            disabled={busy || (disabling && reason.trim().length < 10)}
            onClick={() => {
              void submit();
            }}
          >
            {busy ? 'Saving…' : disabling ? 'Disable' : 'Enable'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        {disabling ? (
          <>
            <p>
              Disabling <span className="font-semibold">{user?.username}</span> immediately revokes
              every signed-in session for that account.
            </p>
            <Field label="Reason" hint="Recorded in the audit log. At least 10 characters.">
              {({ id, invalid }) => (
                <Input
                  id={id}
                  value={reason}
                  invalid={invalid}
                  onChange={(event) => {
                    setReason(event.target.value);
                  }}
                />
              )}
            </Field>
          </>
        ) : (
          <p>
            Enabling <span className="font-semibold">{user?.username}</span> clears any lockout and
            lets the account sign in again.
          </p>
        )}

        {error !== null && <Alert tone="danger">{error}</Alert>}
      </div>
    </Modal>
  );
}

function ResetPasswordModal({
  user,
  onClose,
  onReset,
}: {
  readonly user: UserSummary | null;
  readonly onClose: () => void;
  readonly onReset: (temporaryPassword: string) => void;
}): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    if (user === null) return;
    setBusy(true);
    setError(null);

    const result = await window.bcis.users.resetPassword(user.id);

    if (!result.ok || result.item === null) {
      setError(result.error ?? 'Could not reset the password.');
    } else {
      onReset(result.item.temporaryPassword);
      onClose();
    }

    setBusy(false);
  }

  return (
    <Modal
      open={user !== null}
      title="Reset password"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => {
              void submit();
            }}
          >
            {busy ? 'Resetting…' : 'Reset password'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <p>
          A random temporary password will be generated for{' '}
          <span className="font-semibold">{user?.username}</span>. Every signed-in session for that
          account is revoked, and the user must choose a new password at next sign-in.
        </p>
        {error !== null && <Alert tone="danger">{error}</Alert>}
      </div>
    </Modal>
  );
}
