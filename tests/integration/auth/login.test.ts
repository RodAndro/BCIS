import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../../apps/api/src/app';
import { env } from '../../../apps/api/src/config/env';
import { TEST_PASSWORD, createTestUser, login, seedAccess } from '../helpers/auth';
import { createTestDatabase, type TestDatabase } from '../helpers/database';

/**
 * Sign-in.
 *
 * ── WHAT THESE TESTS ARE ACTUALLY GUARDING ──────────────────────────────────
 * Not "does a correct password return 200". They guard two properties that are
 * easy to lose in a refactor and expensive to discover in production:
 *
 *   1. An unknown username and a wrong password are indistinguishable — same
 *      status, same code, same message — so the endpoint cannot be used to
 *      enumerate accounts.
 *   2. Account state (disabled, locked) is revealed only after the password has
 *      been verified, so it is not enumerable either.
 *
 * The lockout test is the one that would fail first if the failure counter were
 * ever dropped from the update.
 */

const ADMIN = 'login.admin';
const CASHIER = 'login.cashier';
const DISABLED = 'login.disabled';
const LOCKOUT = 'login.lockout';

let testDatabase: TestDatabase;
let app: FastifyInstance;

beforeAll(async () => {
  testDatabase = await createTestDatabase();
  await seedAccess(testDatabase.pool);

  await createTestUser(testDatabase.pool, { username: ADMIN, roleCode: 'OWNER' });
  await createTestUser(testDatabase.pool, { username: CASHIER, roleCode: 'CASHIER' });
  await createTestUser(testDatabase.pool, {
    username: DISABLED,
    roleCode: 'TECHNICIAN',
    status: 'DISABLED',
  });
  await createTestUser(testDatabase.pool, { username: LOCKOUT, roleCode: 'CASHIER' });

  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await testDatabase.close();
});

describe('successful sign-in', () => {
  it('returns an opaque token and the user with their permissions', async () => {
    const result = await login(app, ADMIN, TEST_PASSWORD);

    expect(result.status).toBe(200);
    expect(result.token).toBeTruthy();
    expect(result.body.data?.user?.username).toBe(ADMIN);
    // Owner holds every permission, so this asserts the RBAC graph resolved
    // rather than merely that the user row was read.
    expect(result.body.data?.user?.permissions).toContain('user.manage');
    expect(result.body.data?.user?.permissions).toContain('audit.view');
  });

  it('treats the username case-insensitively', async () => {
    // `users.username` is citext, so this must work without the application
    // lowercasing anything.
    const result = await login(app, ADMIN.toUpperCase(), TEST_PASSWORD);

    expect(result.status).toBe(200);
    expect(result.body.data?.user?.username).toBe(ADMIN);
  });

  it('never returns a password hash or the password itself', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: ADMIN, password: TEST_PASSWORD },
    });

    const text = response.body;
    expect(text).not.toContain('$argon2');
    expect(text).not.toContain('passwordHash');
    expect(text).not.toContain(TEST_PASSWORD);
  });

  it('records the sign-in in the audit log', async () => {
    const rows = await testDatabase.pool.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM audit_logs WHERE action = 'LOGIN_SUCCEEDED'`,
    );

    expect(Number(rows.rows[0]?.total ?? '0')).toBeGreaterThan(0);
  });
});

describe('failed sign-in', () => {
  it('rejects a wrong password with 401 INVALID_CREDENTIALS', async () => {
    const result = await login(app, CASHIER, 'definitely-not-the-password');

    expect(result.status).toBe(401);
    expect(result.body.error?.code).toBe('INVALID_CREDENTIALS');
  });

  it('answers an unknown username exactly as it answers a wrong password', async () => {
    const unknown = await login(app, 'no.such.user.exists', TEST_PASSWORD);
    const wrongPassword = await login(app, CASHIER, 'definitely-not-the-password');

    // The whole point: a caller cannot tell the two apart, so the endpoint
    // cannot be used to discover which usernames exist.
    expect(unknown.status).toBe(wrongPassword.status);
    expect(unknown.body.error?.code).toBe(wrongPassword.body.error?.code);
    expect(unknown.body.error?.message).toBe(wrongPassword.body.error?.message);
  });

  it('rejects a request with no password as a validation failure', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: CASHIER },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_FAILED');
  });
});

describe('inactive accounts', () => {
  it('refuses a disabled account once the password is correct', async () => {
    const result = await login(app, DISABLED, TEST_PASSWORD);

    expect(result.status).toBe(403);
    expect(result.body.error?.code).toBe('ACCOUNT_DISABLED');
  });
});

describe('lockout after repeated failures', () => {
  it(`locks the account after ${String(env.MAX_FAILED_LOGIN_ATTEMPTS)} failed attempts`, async () => {
    for (let attempt = 0; attempt < env.MAX_FAILED_LOGIN_ATTEMPTS; attempt += 1) {
      const failure = await login(app, LOCKOUT, 'wrong-password');
      // Every attempt before the last is an ordinary credential failure.
      expect(failure.status).toBe(401);
    }

    // The threshold has now been reached. Even the CORRECT password is refused,
    // which is what proves the lock is enforced and not merely recorded.
    const locked = await login(app, LOCKOUT, TEST_PASSWORD);

    expect(locked.status).toBe(423);
    expect(locked.body.error?.code).toBe('ACCOUNT_LOCKED');
    expect(locked.body.error?.message).toMatch(/try again/i);
  });

  it('leaves a successful sign-in able to clear the counter', async () => {
    // A fresh account, one wrong attempt, then a correct one.
    await createTestUser(testDatabase.pool, { username: 'login.recovery', roleCode: 'CASHIER' });
    await login(app, 'login.recovery', 'wrong-password');

    const recovered = await login(app, 'login.recovery', TEST_PASSWORD);
    expect(recovered.status).toBe(200);

    const rows = await testDatabase.pool.query<{ failed_login_count: number }>(
      `SELECT failed_login_count FROM users WHERE username = $1`,
      ['login.recovery'],
    );
    expect(rows.rows[0]?.failed_login_count).toBe(0);
  });
});
