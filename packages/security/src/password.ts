import { randomBytes } from 'node:crypto';

import { hash, verify } from '@node-rs/argon2';

/**
 * Password hashing.
 *
 * ── WHY ARGON2ID ────────────────────────────────────────────────────────────
 * Argon2id is the current OWASP first choice for password storage: it is
 * memory-hard, which makes GPU and ASIC cracking expensive in a way bcrypt and
 * PBKDF2 are not. The parameters below are the OWASP-recommended minimums
 * (19 MiB, 2 iterations, 1 lane) and are recorded explicitly rather than left
 * to the library default, so a future upgrade is a visible change.
 *
 * ── WHY THIS LIVES IN ITS OWN PACKAGE ───────────────────────────────────────
 * Two packages must agree on hashing: `apps/api` hashes on password change and
 * verifies on login, and `database` hashes when seeding development accounts.
 * Duplicating the parameters in both would let them drift, and a drift here
 * produces accounts that cannot sign in. One implementation, two callers.
 *
 * It is deliberately NOT in `@bcis/shared`, which is bundled into the sandboxed
 * renderer: pulling a native crypto module into the window process would break
 * that build and violate the rule that the renderer holds no secrets.
 */

/**
 * OWASP-recommended argon2id parameters.
 *
 * ── WHY THE ALGORITHM IS NOT NAMED HERE ─────────────────────────────────────
 * `@node-rs/argon2` exports `Algorithm` as an ambient const enum, and
 * `verbatimModuleSyntax` (set project-wide) forbids referencing a const enum as
 * a value. Rather than smuggle in a numeric literal — `algorithm: 2` would be
 * a magic number whose meaning is invisible — the library default is used,
 * which is Argon2id, and the *produced* hash is asserted to begin with
 * `$argon2id$` in the unit test.
 *
 * That is a stronger guarantee than setting the option: it verifies what the
 * function actually produced rather than what it was asked for.
 */
export const PASSWORD_HASH_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * A valid hash of a value nobody knows, verified against when the username does
 * not exist.
 *
 * Without this, a missing account returns in microseconds while a wrong
 * password takes ~50 ms, and that timing difference enumerates usernames just
 * as effectively as a different error message would. Verifying against this
 * constant makes both paths cost the same.
 */
const TIMING_SYMMETRY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$G63n0k0f7pMEYlZZFb31wg$YqsrAEj1DZmTnPgqaKYKDqK73gvbumScaTwP+A1Jb3g';

/** Hash a plaintext password for storage. */
export async function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, PASSWORD_HASH_OPTIONS);
}

/**
 * Verify a plaintext password against a stored hash.
 *
 * Returns false rather than throwing on a malformed stored hash: a corrupt row
 * must fail the login, not crash the request handler.
 */
export async function verifyPassword(storedHash: string, plaintext: string): Promise<boolean> {
  try {
    return await verify(storedHash, plaintext);
  } catch {
    return false;
  }
}

/**
 * Burn the same amount of time as a real verification.
 *
 * Call this when the username does not exist so the response time matches the
 * wrong-password path.
 */
export async function performTimingSymmetryWork(): Promise<void> {
  await verifyPassword(TIMING_SYMMETRY_HASH, 'never-matches');
}

/**
 * Generate a temporary password for an administrator-initiated reset.
 *
 * ── WHY A GENERATOR AND NOT A FIXED DEFAULT ─────────────────────────────────
 * A shared "welcome123" would mean one leaked email grants access to every
 * reset account. This is random per call, and it satisfies the same policy the
 * account will be required to replace — it contains upper case, lower case, and
 * a digit — so it cannot be rejected by the very form it is used on.
 *
 * The caller returns it to the administrator once and flags the account
 * `mustChangePassword`, so the temporary value cannot become permanent.
 */
export function generateTemporaryPassword(): string {
  const random = randomBytes(9).toString('base64url');
  return `Bcis-${random}9a`;
}
