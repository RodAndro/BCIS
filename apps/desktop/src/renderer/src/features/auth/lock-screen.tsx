import { Button } from '@renderer/components/ui/button';
import { Alert } from '@renderer/components/ui/feedback';
import { Field, Input } from '@renderer/components/ui/form';
import { useAuth } from '@renderer/features/auth/auth-context';
import { roleLabel } from '@renderer/lib/format';
import type { JSX } from 'react';
import { useState } from 'react';

/**
 * Lock screen.
 *
 * ── WHY THE PASSWORD IS REQUIRED AGAIN ──────────────────────────────────────
 * The session token is still valid while locked; that is the point of the
 * feature — a cashier stepping to the printer keeps their place. Unlocking with
 * a button instead of a password would mean anyone who walked up to an
 * unattended till could press it and be inside the session, which is exactly
 * what locking is meant to prevent.
 */
export function LockScreen(): JSX.Element {
  const { state, unlock, logout } = useAuth();

  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const result = await unlock(password);

    if (!result.ok) {
      setError(result.error ?? 'Could not unlock the session.');
      setPassword('');
    }

    setBusy(false);
  }

  return (
    <div className="flex h-full items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm">
        <header className="mb-6 text-center">
          <h1 className="text-lg font-semibold tracking-tight text-foreground">Session locked</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {state.user === null
              ? 'Enter your password to continue.'
              : `${state.user.fullName} · ${state.user.roles.map(roleLabel).join(', ')}`}
          </p>
        </header>

        <form
          onSubmit={(event) => {
            void submit(event);
          }}
          className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-6"
        >
          <Field label="Password">
            {({ id, invalid }) => (
              <Input
                id={id}
                name="password"
                type="password"
                autoComplete="current-password"
                autoFocus
                value={password}
                invalid={invalid}
                onChange={(event) => {
                  setPassword(event.target.value);
                }}
              />
            )}
          </Field>

          {error !== null && <Alert tone="danger">{error}</Alert>}

          <Button type="submit" variant="primary" disabled={busy || password.length === 0}>
            {busy ? 'Unlocking…' : 'Unlock'}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void logout();
            }}
          >
            Sign out instead
          </Button>
        </form>
      </div>
    </div>
  );
}
