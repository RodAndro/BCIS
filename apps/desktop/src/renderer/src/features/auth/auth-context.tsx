import type { Permission } from '@bcis/shared';
import type { AuthResult, AuthState } from '@shared/ipc';
import type { JSX, ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/**
 * Session state for the renderer.
 *
 * ── WHAT LIVES HERE AND WHAT DOES NOT ───────────────────────────────────────
 * This holds WHO is signed in and WHAT they may do — both of which the server
 * told us, and both of which the server re-checks on every request. It does not
 * hold the token: that is in the main process, so a renderer compromise cannot
 * lift a session.
 *
 * ── WHY EVERY MUTATION RE-READS THE SERVER STATE ────────────────────────────
 * `lock`, `unlock`, `changePassword`, and `login` all end by taking the state
 * the main process reports, which it in turn got from `/auth/me`. Assembling
 * state locally would create a second source of truth — and the failure mode
 * would be a UI that believes the session is unlocked while the server refuses
 * every request.
 */

export interface AuthContextValue {
  readonly state: AuthState;
  /** True only until the first `auth.me` resolves. */
  readonly loading: boolean;
  readonly login: (username: string, password: string) => Promise<AuthResult>;
  readonly logout: () => Promise<void>;
  readonly lock: () => Promise<AuthResult>;
  readonly unlock: (password: string) => Promise<AuthResult>;
  readonly changePassword: (currentPassword: string, newPassword: string) => Promise<AuthResult>;
  /** Whether the signed-in user holds a permission. A UI hint, not a control. */
  readonly can: (permission: Permission) => boolean;
}

const ANONYMOUS: AuthState = { authenticated: false, locked: false, user: null };

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { readonly children: ReactNode }): JSX.Element {
  const [state, setState] = useState<AuthState>(ANONYMOUS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const result = await window.bcis.auth.me();
      if (cancelled) return;
      setState(result.state);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (username: string, password: string): Promise<AuthResult> => {
    const result = await window.bcis.auth.login({ username, password });
    if (result.ok) setState(result.state);
    return result;
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    const result = await window.bcis.auth.logout();
    setState(result.state);
  }, []);

  const lock = useCallback(async (): Promise<AuthResult> => {
    const result = await window.bcis.auth.lock();
    setState(result.state);
    return result;
  }, []);

  const unlock = useCallback(async (password: string): Promise<AuthResult> => {
    const result = await window.bcis.auth.unlock({ password });
    if (result.ok) setState(result.state);
    return result;
  }, []);

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string): Promise<AuthResult> => {
      const result = await window.bcis.auth.changePassword({ currentPassword, newPassword });
      if (result.ok) setState(result.state);
      return result;
    },
    [],
  );

  const can = useCallback(
    (permission: Permission): boolean => state.user?.permissions.includes(permission) ?? false,
    [state.user],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ state, loading, login, logout, lock, unlock, changePassword, can }),
    [state, loading, login, logout, lock, unlock, changePassword, can],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error('useAuth must be used inside an AuthProvider.');
  }
  return context;
}
