import { Button } from '@renderer/components/ui/button';
import { Alert, PageHeader, SectionCard } from '@renderer/components/ui/feedback';
import { useAuth } from '@renderer/features/auth/auth-context';
import { ChangePasswordScreen } from '@renderer/features/auth/change-password-screen';
import { formatInstant, roleLabel } from '@renderer/lib/format';
import type { JSX } from 'react';

/**
 * My Account.
 *
 * Shows the identity and permission set the server reported at sign-in. The
 * permission list is worth showing rather than hiding: when someone asks "why
 * can I not reverse a payment?", the answer is visible on their own account
 * instead of requiring an administrator to look it up.
 */
export function MyAccountPanel(): JSX.Element {
  const { state, lock } = useAuth();
  const user = state.user;

  if (user === null) {
    return (
      <Alert tone="warning" title="Not signed in">
        Sign in to view your account.
      </Alert>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <PageHeader
        title="My Account"
        description="Your identity, role, and effective permissions for this session."
        actions={
          <Button
            onClick={() => {
              void lock();
            }}
          >
            Lock session
          </Button>
        }
      />

      <SectionCard title="Identity">
        <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
          <Row label="Username">{user.username}</Row>
          <Row label="Full name">{user.fullName}</Row>
          <Row label="Account status">{user.status}</Row>
          <Row label="Roles">{user.roles.map(roleLabel).join(', ') || '—'}</Row>
        </dl>

        {user.mustChangePassword && (
          <div className="mt-4">
            <Alert tone="warning" title="Password change required">
              An administrator reset this password. Choose a new one below before continuing.
            </Alert>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Permissions"
        description={`${String(user.permissions.length)} permission(s) granted through your roles`}
      >
        {user.permissions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No permissions. Your role assignment grants no access to any screen.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {user.permissions.map((permission) => (
              <code
                key={permission}
                className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
              >
                {permission}
              </code>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Session">
        <p className="text-sm text-muted-foreground">
          The session token is held by the desktop client, never by this window. Locking keeps the
          session alive but requires your password before any screen becomes usable again.
        </p>
        <div className="mt-3">
          <Alert tone="info">
            Last checked at {formatInstant(new Date().toISOString())}. Signing out ends the session
            immediately, and the token stops working on the server.
          </Alert>
        </div>
      </SectionCard>

      <SectionCard
        title="Password"
        description="Changing your password signs out every other session for this account."
      >
        <ChangePasswordScreen />
      </SectionCard>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  readonly label: string;
  readonly children: JSX.Element | string;
}): JSX.Element {
  return (
    <div className="flex flex-col">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  );
}
