import { Button } from '@renderer/components/ui/button';
import { Alert } from '@renderer/components/ui/feedback';
import { Field, Input } from '@renderer/components/ui/form';
import { useAuth } from '@renderer/features/auth/auth-context';
import type { JSX } from 'react';
import { useState } from 'react';

/**
 * Sign-in screen.
 *
 * ── WHAT IT DOES NOT DO ─────────────────────────────────────────────────────
 * It does not decide whether the credentials are good, and it does not reveal
 * why a sign-in failed. The API answers "Incorrect username or password." for
 * both an unknown username and a wrong password, and this screen shows that
 * message verbatim rather than trying to be more helpful — being more helpful
 * here is how an application tells an attacker which usernames exist.
 */
export function LoginScreen(): JSX.Element {
  const { login } = useAuth();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const result = await login(username.trim(), password);

    if (!result.ok) {
      setError(result.error ?? 'Sign-in failed.');
      setPassword('');
    }

    setBusy(false);
  }

  return (
    <div className="flex h-full items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm">
        <header className="mb-6 text-center">
          <h1 className="text-lg font-semibold tracking-tight text-foreground">BCIS Billing</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Subscription Billing and Collection System
          </p>
        </header>

        <form
          onSubmit={(event) => {
            void submit(event);
          }}
          className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-6"
        >
          <Field label="Username">
            {({ id, invalid }) => (
              <Input
                id={id}
                name="username"
                autoComplete="username"
                autoFocus
                value={username}
                invalid={invalid}
                onChange={(event) => {
                  setUsername(event.target.value);
                }}
              />
            )}
          </Field>

          <Field label="Password">
            {({ id, invalid }) => (
              <Input
                id={id}
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                invalid={invalid}
                onChange={(event) => {
                  setPassword(event.target.value);
                }}
              />
            )}
          </Field>

          {error !== null && <Alert tone="danger">{error}</Alert>}

          <Button
            type="submit"
            variant="primary"
            disabled={busy || username.trim().length === 0 || password.length === 0}
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        <p className="mt-4 text-center text-[11px] leading-relaxed text-muted-foreground">
          Signed-in sessions belong to the workstation. Lock the session before leaving the till.
        </p>
      </div>
    </div>
  );
}
