import { describe, expect, it } from 'vitest';

import { generateSessionToken, hashSessionToken } from './tokens';

describe('generateSessionToken', () => {
  it('produces a URL-safe token with 256 bits of entropy', () => {
    const token = generateSessionToken();

    // 32 bytes base64url-encoded is 43 characters, no padding, no +/= .
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('never repeats', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateSessionToken()));
    expect(tokens.size).toBe(200);
  });
});

describe('hashSessionToken', () => {
  it('is a stable 64-character SHA-256 hex digest', () => {
    const token = 'a-fixed-token';
    const hash = hashSessionToken(token);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionToken(token)).toBe(hash);
  });

  it('differs for different tokens', () => {
    expect(hashSessionToken('one')).not.toBe(hashSessionToken('two'));
  });

  it('does not contain the token, so a stored hash cannot be replayed', () => {
    const token = generateSessionToken();
    expect(hashSessionToken(token)).not.toContain(token);
  });
});
