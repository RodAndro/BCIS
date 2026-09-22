import { ConflictError, ForbiddenError, ValidationError } from '@bcis/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../apps/api/src/app';
import { createTestDatabase, type TestDatabase } from './helpers/database';

/**
 * Error envelope tests.
 *
 * §31 requires that a user sees something understandable rather than a raw
 * PostgreSQL error, and §16 requires that nothing sensitive leaks. Both are
 * properties of the central handler, so they are tested directly by registering
 * routes that throw each kind of error.
 *
 * These routes exist only inside this test process. Adding them to the real
 * application would mean shipping endpoints whose only purpose is to fail.
 */

let testDatabase: TestDatabase;
let app: FastifyInstance;

beforeAll(async () => {
  testDatabase = await createTestDatabase();
  app = await buildApp({ logger: false });

  // These routes exist only inside this test process, and they still declare a
  // policy: the auth plugin's `onRoute` hook refuses to let the server start if
  // any route omits one, so a test fixture is not exempt.
  app.get('/__test__/validation', { config: { auth: { public: true } } }, () => {
    throw new ValidationError('That amount is not valid.', { field: 'amount' });
  });

  app.get('/__test__/forbidden', { config: { auth: { public: true } } }, () => {
    throw new ForbiddenError();
  });

  app.get('/__test__/conflict', { config: { auth: { public: true } } }, () => {
    throw new ConflictError('That record already exists.');
  });

  app.get('/__test__/unexpected', { config: { auth: { public: true } } }, () => {
    // Stands in for a genuine bug: a TypeError somewhere deep in a handler.
    const broken: { value?: string } = {};
    return broken.value.length;
  });

  await app.ready();
});

afterAll(async () => {
  await app.close();
  await testDatabase.close();
});

interface ErrorEnvelope {
  error: { code: string; message: string; details?: Record<string, unknown>; requestId: string };
}

describe('application errors', () => {
  it('maps a validation error to 422 with the detail preserved', async () => {
    const response = await app.inject({ method: 'GET', url: '/__test__/validation' });
    const body = response.json<ErrorEnvelope>();

    expect(response.statusCode).toBe(422);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.message).toBe('That amount is not valid.');
    expect(body.error.details).toEqual({ field: 'amount' });
  });

  it('maps a forbidden error to 403 with a safe default message', async () => {
    const response = await app.inject({ method: 'GET', url: '/__test__/forbidden' });
    const body = response.json<ErrorEnvelope>();

    expect(response.statusCode).toBe(403);
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toMatch(/permission/i);
  });

  it('maps a conflict to 409', async () => {
    const response = await app.inject({ method: 'GET', url: '/__test__/conflict' });
    const body = response.json<ErrorEnvelope>();

    expect(response.statusCode).toBe(409);
    expect(body.error.code).toBe('CONFLICT');
  });
});

describe('unexpected errors', () => {
  it('returns a generic message and never leaks the internals', async () => {
    const response = await app.inject({ method: 'GET', url: '/__test__/unexpected' });
    const body = response.json<ErrorEnvelope>();

    expect(response.statusCode).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');

    // The user gets a reference to quote; they do not get a stack trace,
    // a file path, or a message about `undefined`.
    expect(body.error.message).toMatch(/reference/i);
    expect(body.error.message).not.toMatch(/undefined|TypeError|at Object\.|\.ts:/);
    expect(JSON.stringify(body)).not.toMatch(/[A-Za-z]:\\|\/src\//);
  });
});

describe('every error response', () => {
  it('carries a requestId so it can be correlated with the server log', async () => {
    for (const url of [
      '/__test__/validation',
      '/__test__/forbidden',
      '/__test__/conflict',
      '/__test__/unexpected',
      '/definitely-not-a-route',
    ]) {
      const response = await app.inject({ method: 'GET', url });
      const body = response.json<ErrorEnvelope>();

      expect(body.error.requestId, `requestId missing for ${url}`).toBeTruthy();
      expect(typeof body.error.code, `code missing for ${url}`).toBe('string');
    }
  });
});
