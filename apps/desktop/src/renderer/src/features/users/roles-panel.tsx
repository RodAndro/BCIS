import type { Permission } from '@bcis/shared';
import type { PermissionSummary, RoleSummary } from '@bcis/validation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@renderer/components/ui/button';
import { Alert } from '@renderer/components/ui/feedback';
import { CheckboxRow } from '@renderer/components/ui/form';
import { Modal } from '@renderer/components/ui/overlay';
import { DataTable, EmptyRow, Th, Td, Tr } from '@renderer/components/ui/table';
import { useRoles } from '@renderer/features/users/use-roles';
import type { JSX } from 'react';
import { useState } from 'react';

/**
 * Roles and the permission matrix.
 *
 * ── WHAT CHANGING A ROLE AFFECTS ────────────────────────────────────────────
 * Permissions are resolved from the database on every request, so removing one
 * from a role takes effect on the very next call from anyone holding that role
 * — there is no token to expire. The editor therefore shows how many users hold
 * the role before you change it.
 *
 * The Owner role is shown but not editable. It holds every permission by
 * design, including ones added in later phases, and the API refuses to narrow
 * it: a system whose only administrator can remove their own access is one
 * support call away from being unadministrable.
 */
export function RolesPanel({ canManage }: { readonly canManage: boolean }): JSX.Element {
  const roles = useRoles();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<RoleSummary | null>(null);

  const items = roles.data?.items ?? [];

  function refresh(): void {
    void queryClient.invalidateQueries({ queryKey: ['roles'] });
    void queryClient.invalidateQueries({ queryKey: ['permissions'] });
    void queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
  }

  return (
    <div className="flex flex-col gap-4">
      {roles.data?.ok === false && (
        <Alert tone="danger" title="Could not load roles">
          {roles.data.error ?? 'Unknown error.'}
        </Alert>
      )}

      <DataTable>
        <thead>
          <tr>
            <Th>Role</Th>
            <Th>Code</Th>
            <Th>Description</Th>
            <Th align="right">Permissions</Th>
            <Th align="right">Users</Th>
            <Th align="right">Actions</Th>
          </tr>
        </thead>
        <tbody>
          {roles.isLoading && <EmptyRow colSpan={6}>Loading…</EmptyRow>}

          {items.map((role) => (
            <Tr key={role.code}>
              <Td>{role.name}</Td>
              <Td>
                <span className="font-mono text-[13px]">{role.code}</span>
              </Td>
              <Td className="text-muted-foreground">{role.description ?? '—'}</Td>
              <Td align="right">{role.permissions.length}</Td>
              <Td align="right">{role.userCount}</Td>
              <Td align="right">
                {canManage ? (
                  <Button
                    size="sm"
                    disabled={role.code === 'OWNER'}
                    title={
                      role.code === 'OWNER'
                        ? 'The Owner role always holds every permission.'
                        : undefined
                    }
                    onClick={() => {
                      setEditing(role);
                    }}
                  >
                    Edit permissions
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">read-only</span>
                )}
              </Td>
            </Tr>
          ))}
        </tbody>
      </DataTable>

      <p className="text-xs text-muted-foreground">
        Owner always holds every permission, including ones added in later phases.
      </p>

      <RolePermissionModal
        key={editing?.code ?? 'none'}
        role={editing}
        onClose={() => {
          setEditing(null);
        }}
        onSaved={refresh}
      />
    </div>
  );
}

function RolePermissionModal({
  role,
  onClose,
  onSaved,
}: {
  readonly role: RoleSummary | null;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}): JSX.Element {
  const permissions = useQuery({
    queryKey: ['permissions'],
    queryFn: () => window.bcis.permissions.list(),
  });

  const [selected, setSelected] = useState<Permission[]>(
    role === null ? [] : [...role.permissions],
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const grouped = groupByCategory(permissions.data?.items ?? []);

  async function submit(): Promise<void> {
    if (role === null) return;
    setBusy(true);
    setError(null);

    const result = await window.bcis.roles.setPermissions(role.code, { permissions: selected });

    if (!result.ok) {
      setError(result.error ?? 'Could not save the permissions.');
    } else {
      onSaved();
      onClose();
    }

    setBusy(false);
  }

  return (
    <Modal
      open={role !== null}
      title={role === null ? 'Permissions' : `${role.name} — permissions`}
      description={
        role === null
          ? undefined
          : `${String(role.permissions.length)} of ${String(permissions.data?.total ?? 0)} granted · ${String(role.userCount)} active user(s)`
      }
      onClose={onClose}
      width="lg"
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
            {busy ? 'Saving…' : 'Save permissions'}
          </Button>
        </>
      }
    >
      <div className="max-h-[60vh] overflow-y-auto pr-1">
        {permissions.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

        <div className="grid gap-5 md:grid-cols-2">
          {[...grouped.entries()].map(([category, entries]) => (
            <fieldset key={category} className="flex flex-col gap-2">
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {category}
              </legend>

              {entries.map((permission) => (
                <CheckboxRow
                  key={permission.code}
                  checked={selected.includes(permission.code as Permission)}
                  onChange={(checked) => {
                    const code = permission.code as Permission;
                    setSelected((current) =>
                      checked ? [...current, code] : current.filter((value) => value !== code),
                    );
                  }}
                  label={
                    <>
                      <span className="font-mono text-[12px]">{permission.code}</span>
                      {permission.description !== null && (
                        <span className="ml-2 text-[11px] text-muted-foreground">
                          {permission.description}
                        </span>
                      )}
                    </>
                  }
                />
              ))}
            </fieldset>
          ))}
        </div>
      </div>

      {error !== null && (
        <div className="mt-4">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
    </Modal>
  );
}

function groupByCategory(
  permissions: readonly PermissionSummary[],
): Map<string, PermissionSummary[]> {
  const grouped = new Map<string, PermissionSummary[]>();

  for (const permission of permissions) {
    const existing = grouped.get(permission.category);
    if (existing === undefined) {
      grouped.set(permission.category, [permission]);
    } else {
      existing.push(permission);
    }
  }

  return grouped;
}
