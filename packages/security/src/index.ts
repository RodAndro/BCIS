/**
 * @bcis/security — server-only security primitives.
 *
 * Node-only. This package must never be imported by the Electron renderer or by
 * `@bcis/shared`, because it depends on a native crypto module and because the
 * renderer is required to hold no secrets.
 */

export {
  PASSWORD_HASH_OPTIONS,
  generateTemporaryPassword,
  hashPassword,
  performTimingSymmetryWork,
  verifyPassword,
} from './password';

export { generateSessionToken, hashSessionToken } from './tokens';
export { magicBytesMatch, safeRelativeStoragePath } from './file-safety';
