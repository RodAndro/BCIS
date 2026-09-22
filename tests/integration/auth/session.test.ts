import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../../apps/api/src/app';
import { TEST_PASSWORD, createTestUser, login, loginAs, seedAccess } from '../helpers/auth';
import { createTestDatabase, type TestDatabase } from '../helpers/database';

/**
 * Session handling: /auth/me, logout, session lock, and password change.
 *
 * The lock tests are the interesting ones. A session lock that only hides
 * screens is not a control; the assertion that matters is that an endpoint the
 * user IS entitled to call is still refused while the session is locked.
 */

const ADMIN = 'session.admin';
const CHANGER = 'session.changer';

let testDatabase: TestDatabase;
let app: FastifyInstance;

beforeAll(async () => {
  testDatabase = await createTestDatabase();
  await seedAccess(testDatabase.pool);
  await createTestUser(testDatabase.pool, { username: ADMIN, roleCode: 'OWNER' });
  await createTestUser(testDatabase.pool, { username: CHANGER, roleCode: 'CASHIER' });

  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await testDatabase.close();
});

describe('GET /auth/me', () => {
  it('rejects a request with no token', async () => {
    const response = await app.inject({ method: 'GET', url: '/auth/me' });

    expect(response.statusCode).toBe(401);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a token that is not a real session', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: 'Bearer not-a-real-token' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('SESSION_EXPIRED');
  });

  it('describes the signed-in user', async () => {
    const headers = await loginAs(app, ADMIN);
    const response = await app.inject({ method: 'GET', url: '/auth/me', headers });

    const body = response.json<{
      data: { authenticated: boolean; locked: boolean; user: { username: string } };
    }>();

    expect(response.statusCode).toBe(200);
    expect(body.data.authenticated).toBe(true);
    expect(body.data.locked).toBe(false);
    expect(body.data.user.username).toBe(ADMIN);
  });
});

describe('logout', () => {
  it('invalidates the token immediately', async () => {
    const headers = await loginAs(app, ADMIN);

    const before = await app.inject({ method: 'GET', url: '/auth/me', headers });
    expect(before.statusCode).toBe(200);

    const logout = await app.inject({ method: 'POST', url: '/auth/logout', headers });
    expect(logout.statusCode).toBe(200);

    // The token is not merely flagged; the very next request fails.
    const after = await app.inject({ method: 'GET', url: '/auth/me', headers });
    expect(after.statusCode).toBe(401);
    expect(after.json<{ error: { code: string } }>().error.code).toBe('SESSION_EXPIRED');
  });
});

describe('session lock', () => {
  it('refuses an endpoint the session is otherwise entitled to use', async () => {
    const headers = await loginAs(app, ADMIN);

    const lock = await app.inject({ method: 'POST', url: '/auth/lock', headers });
    expect(lock.statusCode).toBe(200);

    // Still authenticated, and told so — the client needs to render the lock
    // screen rather than the sign-in screen.
    const me = await app.inject({ method: 'GET', url: '/auth/me', headers });
    expect(me.statusCode).toBe(200);
    expect(me.json<{ data: { locked: boolean } }>().data.locked).toBe(true);

    // ...but the Owner's own user list is refused. This is the assertion that
    // makes the lock a control rather than a screen.
    const users = await app.inject({ method: 'GET', url: '/users', headers });
    expect(users.statusCode).toBe(423);
    expect(users.json<{ error: { code: string } }>().error.code).toBe('SESSION_LOCKED');
  });

  it('requires the password to unlock, and then restores access', async () => {
    const headers = await loginAs(app, ADMIN);
    await app.inject({ method: 'POST', url: '/auth/lock', headers });

    const wrong = await app.inject({
      method: 'POST',
      url: '/auth/unlock',
      headers,
      payload: { password: 'not-the-password' },
    });
    expect(wrong.statusCode).toBe(401);

    const stillLocked = await app.inject({ method: 'GET', url: '/users', headers });
    expect(stillLocked.statusCode).toBe(423);

    const unlock = await app.inject({
      method: 'POST',
      url: '/auth/unlock',
      headers,
      payload: { password: TEST_PASSWORD },
    });
    expect(unlock.statusCode).toBe(200);

    const unlocked = await app.inject({ method: 'GET', url: '/users', headers });
    expect(unlocked.statusCode).toBe(200);
  });
});

describe('changing your own password', () => {
  it('rejects a wrong current password', async () => {
    const headers = await loginAs(app, CHANGER);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/change-password',
      headers,
      payload: { currentPassword: 'wrong', newPassword: 'BrandNew@2026x' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects a new password that does not meet the policy', async () => {
    const headers = await loginAs(app, CHANGER);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/change-password',
      headers,
      payload: { currentPassword: TEST_PASSWORD, newPassword: 'short' },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_FAILED');
  });

  it('changes the password, revokes other sessions, and keeps the current one', async () => {
    const first = await loginAs(app, CHANGER);
    const second = await loginAs(app, CHANGER);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/change-password',
      headers: second,
      payload: { currentPassword: TEST_PASSWORD, newPassword: 'BrandNew@2026x' },
    });
    expect(response.statusCode).toBe(200);

    // The session that changed it survives...
    expect((await app.inject({ method: 'GET', url: '/auth/me', headers: second })).statusCode).toBe(
      200,
    );
    // ...and the other one does not, because a password change is exactly the
    // situation where an older session should stop working.
    expect((await app.inject({ method: 'GET', url: '/auth/me', headers: first })).statusCode).toBe(
      401,
    );

    // The old password no longer signs in; the new one does.
    expect((await login(app, CHANGER, TEST_PASSWORD)).status).toBe(401);
    expect((await login(app, CHANGER, 'BrandNew@2026x')).status).toBe(200);

    // Put it back so the fixture state is stable for any later file.
    await createTestUser(testDatabase.pool, { username: CHANGER, roleCode: 'CASHIER' });
  });
});
