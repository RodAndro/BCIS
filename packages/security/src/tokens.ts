import { createHash, randomBytes } from 'node:crypto';

/**
 * Session token generation.
 *
 * ── OPAQUE, NOT A JWT ───────────────────────────────────────────────────────
 * The token carries no claims. It is a random string whose SHA-256 is the only
 * thing stored, so the server is the sole authority on what it means. That is
 * what allows a session to be revoked instantly — a JWT cannot be, which is
 * disqualifying for a till that must be lockable on request.
 */

/** Bytes of entropy in a session token. 256 bits, well beyond guessing range. */
const TOKEN_BYTES = 32;

/**
 * Generate a new session token.
 *
 * `base64url` keeps the value header-safe: it can travel in an
 * `Authorization: Bearer` header without escaping.
 */
export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * Hash a token for storage and lookup.
 *
 * SHA-256 rather than argon2 is correct here: the token is 256 bits of uniform
 * randomness, so it is not brute-forceable by the means a slow KDF defends
 * against, and login happens on every request, where a 50 ms hash would be a
 * severe cost for no security gain.
 */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
