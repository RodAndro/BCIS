import { describe, expect, it } from 'vitest';

import {
  PASSWORD_HASH_OPTIONS,
  hashPassword,
  performTimingSymmetryWork,
  verifyPassword,
} from './password';

/**
 * Password handling.
 *
 * The point of these tests is that the properties a security review asks about
 * are checked here rather than asserted in a document: the algorithm, the salt,
 * and the fact that a plaintext password is never recoverable from the stored
 * value.
 */
describe('hashPassword', () => {
  it('produces an argon2id hash with the configured parameters', async () => {
    const hash = await hashPassword('correct horse battery staple');

    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).toContain(`m=${String(PASSWORD_HASH_OPTIONS.memoryCost)}`);
    expect(hash).toContain(`t=${String(PASSWORD_HASH_OPTIONS.timeCost)}`);
    expect(hash).toContain(`p=${String(PASSWORD_HASH_OPTIONS.parallelism)}`);
  });

  it('never contains the plaintext', async () => {
    const plaintext = 'correct horse battery staple';
    const hash = await hashPassword(plaintext);

    expect(hash).not.toContain(plaintext);
    expect(hash).not.toContain('correct');
  });

  it('salts, so the same password hashes differently every time', async () => {
    const first = await hashPassword('same-password');
    const second = await hashPassword('same-password');

    expect(first).not.toBe(second);
    // ...but both still verify, which is what the salt is for.
    expect(await verifyPassword(first, 'same-password')).toBe(true);
    expect(await verifyPassword(second, 'same-password')).toBe(true);
  });
});

describe('verifyPassword', () => {
  it('accepts the correct password', async () => {
    const hash = await hashPassword('Cashier@BCIS2026');
    expect(await verifyPassword(hash, 'Cashier@BCIS2026')).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('Cashier@BCIS2026');
    expect(await verifyPassword(hash, 'cashier@bcis2026')).toBe(false);
  });

  it('rejects an empty password rather than treating it as a match', async () => {
    const hash = await hashPassword('Cashier@BCIS2026');
    expect(await verifyPassword(hash, '')).toBe(false);
  });

  it('returns false for a corrupt stored hash instead of throwing', async () => {
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false);
    expect(await verifyPassword('', 'anything')).toBe(false);
  });
});

describe('performTimingSymmetryWork', () => {
  it('completes without revealing a result', async () => {
    await expect(performTimingSymmetryWork()).resolves.toBeUndefined();
  });
});
