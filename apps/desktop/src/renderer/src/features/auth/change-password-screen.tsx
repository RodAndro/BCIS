import { Button } from '@renderer/components/ui/button';
import { Alert } from '@renderer/components/ui/feedback';
import { Field, Input } from '@renderer/components/ui/form';
import { useAuth } from '@renderer/features/auth/auth-context';
import { MIN_PASSWORD_LENGTH } from '@bcis/validation';
import type { JSX } from 'react';
import { useState } from 'react';

/**
 * Change password.
 *
 * ── TWO MODES, ONE SCREEN ───────────────────────────────────────────────────
 * `forced` is set when the account is flagged `mustChangePassword` — after an
 * administrator resets it, for example. In that mode there is no cancel,
 * because the temporary password is known to the administrator and must not
 * become the password in use.
 *
 * The API revokes every OTHER session on success, so a password that was shared
 * or exposed stops working elsewhere while this workstation stays signed in.
 */
export function ChangePasswordScreen({
  forced = false,
}: {
  readonly forced?: boolean;
}): JSX.Element {
  const { changePassword, state } = useAuth();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const mismatch = confirmPassword.length > 0 && confirmPassword !== newPassword;

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const result = await changePassword(currentPassword, newPassword);

    if (!result.ok) {
      setError(result.error ?? 'Could not change the password.');
    } else {
      setDone(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    }

    setBusy(false);
  }

  return (
    <div className={forced ? 'flex h-full items-center justify-center bg-background px-6' : ''}>
      <div className={forced ? 'w-full max-w-sm' : 'max-w-lg'}>
        {forced && (
          <header className="mb-6 text-center">
            <h1 className="text-lg font-semibold tracking-tight text-foreground">
              Set a new password
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {state.user?.username} must choose a new password before continuing.
            </p>
          </header>
        )}

        <form
          onSubmit={(event) => {
            void submit(event);
          }}
          className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-6"
        >
          {!forced && (
            <div>
              <h2 className="text-sm font-semibold text-foreground">Change password</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Signing in elsewhere with the old password will stop working.
              </p>
            </div>
          )}

          <Field label="Current password">
            {({ id, invalid }) => (
              <Input
                id={id}
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                invalid={invalid}
                onChange={(event) => {
                  setCurrentPassword(event.target.value);
                }}
              />
            )}
          </Field>

          <Field
            label="New password"
            hint={`At least ${String(MIN_PASSWORD_LENGTH)} characters, with upper and lower case and a digit.`}
          >
            {({ id, invalid }) => (
              <Input
                id={id}
                type="password"
                autoComplete="new-password"
                value={newPassword}
                invalid={invalid}
                onChange={(event) => {
                  setNewPassword(event.target.value);
                }}
              />
            )}
          </Field>

          <Field
            label="Confirm new password"
            error={mismatch ? 'The two passwords do not match.' : null}
          >
            {({ id, invalid }) => (
              <Input
                id={id}
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                invalid={invalid || mismatch}
                onChange={(event) => {
                  setConfirmPassword(event.target.value);
                }}
              />
            )}
          </Field>

          {error !== null && <Alert tone="danger">{error}</Alert>}
          {done && <Alert tone="success">Password changed.</Alert>}

          <div className="flex items-center justify-end gap-2">
            <Button
              type="submit"
              variant="primary"
              disabled={
                busy ||
                currentPassword.length === 0 ||
                newPassword.length === 0 ||
                mismatch ||
                confirmPassword.length === 0
              }
            >
              {busy ? 'Saving…' : 'Change password'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
