import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../../apps/api/src/app';
import { TEST_PASSWORD, createTestUser, loginAs, seedAccess } from '../helpers/auth';
import { createTestDatabase, type TestDatabase } from '../helpers/database';

/**
 * Server-side authorization — AT-10.
 *
 * ── THE CLAIM BEING TESTED ──────────────────────────────────────────────────
 * "A Cashier hitting an admin endpoint directly receives an authorization
 * failure, regardless of what the UI showed them." These requests are made with
 * a perfectly valid Cashier token and no UI involvement at all: this is the
 * server refusing, which is the only kind of refusal that is security.
 */

const ADMIN = 'rbac.admin';
const CASHIER = 'rbac.cashier';
const AUDITOR = 'rbac.auditor';

let testDatabase: TestDatabase;
let app: FastifyInstance;

beforeAll(async () => {
  testDatabase = await createTestDatabase();
  await seedAccess(testDatabase.pool);
  await createTestUser(testDatabase.pool, { username: ADMIN, roleCode: 'OWNER' });
  await createTestUser(testDatabase.pool, { username: CASHIER, roleCode: 'CASHIER' });
  await createTestUser(testDatabase.pool, { username: AUDITOR, roleCode: 'ACCOUNTING_AUDITOR' });

  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await testDatabase.close();
});

describe('unauthenticated access', () => {
  it('refuses a protected endpoint with no token', async () => {
    const response = await app.inject({ method: 'GET', url: '/users' });

    expect(response.statusCode).toBe(401);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('UNAUTHENTICATED');
  });

  it('refuses a protected endpoint with a malformed token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/users',
      headers: { authorization: 'Bearer' },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('authorized access', () => {
  it('allows an Owner to list users', async () => {
    const headers = await loginAs(app, ADMIN);
    const response = await app.inject({ method: 'GET', url: '/users', headers });

    expect(response.statusCode).toBe(200);

    const body = response.json<{ data: { username: string }[]; meta: { total: number } }>();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.some((user) => user.username === ADMIN)).toBe(true);
  });

  it('allows an Owner to create a user, who can then sign in', async () => {
    const headers = await loginAs(app, ADMIN);
    const username = 'rbac.created';

    const response = await app.inject({
      method: 'POST',
      url: '/users',
      headers,
      payload: {
        username,
        fullName: 'Created By Test',
        password: 'Created@2026x',
        roles: ['CASHIER'],
      },
    });

    expect(response.statusCode).toBe(201);

    const signIn = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username, password: 'Created@2026x' },
    });
    expect(signIn.statusCode).toBe(200);
    expect(signIn.json<{ data: { user: { roles: string[] } } }>().data.user.roles).toEqual([
      'CASHIER',
    ]);
  });

  it('rejects a duplicate username with a message a person can act on', async () => {
    const headers = await loginAs(app, ADMIN);

    const response = await app.inject({
      method: 'POST',
      url: '/users',
      headers,
      payload: {
        username: CASHIER,
        fullName: 'Duplicate',
        password: 'Duplicate@2026x',
        roles: ['CASHIER'],
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { message: string } }>().error.message).toMatch(/already taken/i);
  });
});

describe('role permission behaviour', () => {
  it('refuses a Cashier listing users', async () => {
    const headers = await loginAs(app, CASHIER);
    const response = await app.inject({ method: 'GET', url: '/users', headers });

    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('FORBIDDEN');
  });

  it('refuses a Cashier creating a user — AT-10', async () => {
    const headers = await loginAs(app, CASHIER);

    const response = await app.inject({
      method: 'POST',
      url: '/users',
      headers,
      payload: {
        username: 'rbac.must-not-exist',
        fullName: 'Should Not Exist',
        password: 'ShouldNot@2026x',
        roles: ['OWNER'],
      },
    });

    expect(response.statusCode).toBe(403);

    // And the write genuinely did not happen — a 403 that still created the row
    // would be worse than no check at all.
    const rows = await testDatabase.pool.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM users WHERE username = 'rbac.must-not-exist'`,
    );
    expect(Number(rows.rows[0]?.total ?? '0')).toBe(0);
  });

  it('refuses a Cashier resetting another user’s password', async () => {
    const headers = await loginAs(app, CASHIER);
    const owners = await testDatabase.pool.query<{ id: number }>(
      `SELECT id FROM users WHERE username = $1`,
      [ADMIN],
    );
    const ownerId = owners.rows[0]?.id ?? 0;

    const response = await app.inject({
      method: 'POST',
      url: `/users/${String(ownerId)}/reset-password`,
      headers,
    });

    expect(response.statusCode).toBe(403);
  });

  it('allows an Auditor to read the audit log but not to administer users', async () => {
    const headers = await loginAs(app, AUDITOR);

    expect((await app.inject({ method: 'GET', url: '/audit-logs', headers })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/users', headers })).statusCode).toBe(403);
  });

  it('refuses a Cashier touching role permissions', async () => {
    const headers = await loginAs(app, CASHIER);

    const response = await app.inject({
      method: 'PUT',
      url: '/roles/CASHIER/permissions',
      headers,
      payload: { permissions: ['user.manage'] },
    });

    expect(response.statusCode).toBe(403);
  });

  it('reports each role’s grants so the UI can describe them', async () => {
    const headers = await loginAs(app, ADMIN);
    const response = await app.inject({ method: 'GET', url: '/roles', headers });

    expect(response.statusCode).toBe(200);

    const roles = response.json<{ data: { code: string; permissions: string[] }[] }>().data;
    const cashier = roles.find((role) => role.code === 'CASHIER');
    const owner = roles.find((role) => role.code === 'OWNER');

    expect(cashier?.permissions).not.toContain('user.manage');
    // Owner holds every permission, including ones added in later phases.
    expect(owner?.permissions).toContain('user.manage');
    expect(owner?.permissions).toContain('backup.restore');
  });
});

describe('the startup guard', () => {
  it('refuses to start when a route declares no policy', async () => {
    // Registered inside a plugin so the route is added while the server is
    // still booting — after the auth plugin has installed its `onRoute` hook —
    // which is exactly the situation the guard exists for.
    const guarded = await buildApp({ logger: false });

    try {
      // The throw can surface from `register` or from `ready` depending on where
      // avvio is in the boot sequence, so both are inside the expectation —
      // what matters is that the server never becomes usable.
      await expect(
        (async () => {
          await guarded.register(async (scope) => {
            scope.get('/__no_policy__', async () => ({ ok: true }));
          });
          await guarded.ready();
        })(),
      ).rejects.toThrow(/does not declare config\.auth/);
    } finally {
      await guarded.close().catch(() => undefined);
    }
  });

  it('starts when every route declares a policy', async () => {
    // The application under test in this file is the proof: it registered the
    // full route set and reached ready(), so a policy on every route is
    // compatible with a working server rather than merely restrictive.
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
  });
});
