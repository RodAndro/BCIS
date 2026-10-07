import { Button } from '@renderer/components/ui/button';
import { Alert } from '@renderer/components/ui/feedback';
import { EyeIcon, EyeOffIcon } from '@renderer/components/ui/icons';
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
  const [showPassword, setShowPassword] = useState(false);
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
    <div className="flex h-full overflow-y-auto bg-background p-2 sm:p-4">
      <div className="flex min-h-full w-full overflow-hidden rounded-lg border border-border bg-surface shadow-panel">
        <section className="relative hidden w-[48%] min-w-[420px] flex-col justify-between overflow-hidden bg-primary px-10 py-9 text-primary-foreground lg:flex">
          <header className="relative flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-lg bg-accent text-sm font-bold text-accent-foreground">
              B
            </span>
            <div>
              <p className="text-base font-semibold leading-tight">BCIS Billing</p>
              <p className="mt-0.5 text-xs text-primary-foreground/70">
                Bukidnon Cable &amp; Internet Services
              </p>
            </div>
          </header>

          <div className="relative max-w-lg">
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-primary-foreground/60">
              Receivables, made clear
            </p>
            <h1 className="max-w-md text-4xl font-semibold leading-[1.08] tracking-tight">
              Keep every account <span className="text-primary-highlight">moving forward.</span>
            </h1>
            <p className="mt-5 max-w-md text-sm leading-relaxed text-primary-foreground/75">
              Billing, collections, and subscriber service in one dependable workspace for the
              team at BCIS.
            </p>

            <div className="mt-10 grid max-w-md grid-cols-2 gap-3">
              <div className="rounded-lg border border-white/15 bg-white/10 p-4 backdrop-blur-sm">
                <p className="text-2xl font-semibold">01</p>
                <p className="mt-1 text-xs text-primary-foreground/65">Subscriber records</p>
              </div>
              <div className="rounded-lg border border-white/15 bg-white/10 p-4 backdrop-blur-sm">
                <p className="text-2xl font-semibold">24/7</p>
                <p className="mt-1 text-xs text-primary-foreground/65">Ledger visibility</p>
              </div>
            </div>
          </div>

          <p className="relative text-xs text-primary-foreground/60">© 2026 BCIS Billing System</p>
        </section>

        <section className="flex min-w-0 flex-1 items-center justify-center px-6 py-12 sm:px-12 lg:px-16">
          <div className="w-full max-w-md">
            <header className="mb-8">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-accent">
                Secure workspace
              </p>
              <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                Sign in to BCIS Billing
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Use your assigned account to access subscriber and collection records.
              </p>
            </header>

            <form
              onSubmit={(event) => {
                void submit(event);
              }}
              className="flex flex-col gap-5"
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
                    className="h-11 px-3"
                  />
                )}
              </Field>

              <Field label="Password">
                {({ id, invalid }) => (
                  <div className="relative">
                    <Input
                      id={id}
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      value={password}
                      invalid={invalid}
                      onChange={(event) => {
                        setPassword(event.target.value);
                      }}
                      className="h-11 px-3 pr-11"
                    />
                    {password.length > 0 && (
                      <button
                        type="button"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        aria-pressed={showPassword}
                        onMouseDown={(event) => {
                          event.preventDefault();
                        }}
                        onClick={() => {
                          setShowPassword((current) => !current);
                        }}
                        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground active:text-foreground"
                      >
                        {showPassword ? (
                          <EyeOffIcon className="size-4" />
                        ) : (
                          <EyeIcon className="size-4" />
                        )}
                      </button>
                    )}
                  </div>
                )}
              </Field>

              {error !== null && <Alert tone="danger">{error}</Alert>}

              <Button
                type="submit"
                variant="primary"
                className="h-11 w-full"
                disabled={busy || username.trim().length === 0 || password.length === 0}
              >
                {busy ? 'Signing in...' : 'Sign in'}
              </Button>
            </form>

            <p className="mt-7 border-t border-border pt-5 text-xs leading-relaxed text-muted-foreground">
              Signed-in sessions belong to this workstation. Lock the session before leaving the
              till.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
