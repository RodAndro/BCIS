import { seedAccessControl } from '@bcis/database';
import { hashPassword } from '@bcis/security';
import type { RoleCode } from '@bcis/shared';
import type { FastifyInstance } from 'fastify';

/**
 * Authentication test helpers.
 *
 * ── WHY USERS ARE CREATED WITH SQL RATHER THAN THROUGH THE API ──────────────
 * Sign-in tests need an account to exist before anyone can sign in, which is
 * the definition of a chicken-and-egg problem. Creating the fixture directly
 * also means a test for "a Cashier is refused" does not depend on the
 * user-creation endpoint working.
 *
 * The password is hashed with the real `@bcis/security` implementation, so a
 * fixture cannot sign in with a hash the production code would reject.
 */

export const TEST_PASSWORD = 'Test@BCIS2026x';

type Pool = Parameters<typeof seedAccessControl>[0];

/** The pool type the integration harness hands out, for other helper modules. */
export type TestPool = Pool;

/** Seed roles, permissions, and settings into the test database. */
export async function seedAccess(pool: Pool): Promise<void> {
  await seedAccessControl(pool);
}

export interface TestUserOptions {
  readonly username: string;
  readonly password?: string;
  readonly roleCode: RoleCode;
  readonly status?: 'ACTIVE' | 'LOCKED' | 'DISABLED';
  readonly mustChangePassword?: boolean;
}

/**
 * Create or reset a user and assign exactly one role.
 *
 * `ON CONFLICT ... DO UPDATE` resets the password, status, and failure counter,
 * so a test that deliberately locked an account cannot make a later file fail.
 */
export async function createTestUser(pool: Pool, options: TestUserOptions): Promise<number> {
  const password = options.password ?? TEST_PASSWORD;
  const passwordHash = await hashPassword(password);

  const result = await pool.query<{ id: number }>(
    `INSERT INTO users (username, password_hash, full_name, status, must_change_password)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (username) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           full_name = EXCLUDED.full_name,
           status = EXCLUDED.status,
           must_change_password = EXCLUDED.must_change_password,
           failed_login_count = 0,
           locked_until = NULL
     RETURNING id`,
    [
      options.username,
      passwordHash,
      `Test ${options.username}`,
      options.status ?? 'ACTIVE',
      options.mustChangePassword ?? false,
    ],
  );

  const userId = result.rows[0]?.id;
  if (userId === undefined)
    throw new Error(`Creating test user ${options.username} returned no id.`);

  await pool.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
  await pool.query(
    `INSERT INTO user_roles (user_id, role_id)
     SELECT $1, r.id FROM roles r WHERE r.code = $2`,
    [userId, options.roleCode],
  );

  return userId;
}

export interface LoginResponse {
  readonly status: number;
  readonly token: string | null;
  readonly body: {
    data?: { token?: string; user?: { id: number; username: string; permissions: string[] } };
    error?: { code: string; message: string };
  };
}

export async function login(
  app: FastifyInstance,
  username: string,
  password: string,
): Promise<LoginResponse> {
  const response = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { username, password },
  });

  const body = response.json<LoginResponse['body']>();

  return {
    status: response.statusCode,
    token: body.data?.token ?? null,
    body,
  };
}

/** Sign in and return the bearer header, failing the test if sign-in fails. */
export async function loginAs(
  app: FastifyInstance,
  username: string,
  password: string = TEST_PASSWORD,
): Promise<Record<string, string>> {
  const result = await login(app, username, password);
  if (result.token === null) {
    throw new Error(`Expected ${username} to sign in, got ${String(result.status)}.`);
  }
  return { authorization: `Bearer ${result.token}` };
}

export function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}
