import { existsSync } from 'node:fs';

import { z } from 'zod';

import { repoEnvPath, repoPath } from './root';

/**
 * Environment configuration.
 *
 * ── FAIL FAST ───────────────────────────────────────────────────────────────
 * A missing or malformed setting stops the process at startup with a precise
 * message, rather than surfacing later as an undefined connection string or a
 * port of NaN. A server that starts in a broken state is worse than one that
 * refuses to start, because the broken state is discovered by a cashier.
 *
 * ── TRAPS HANDLED HERE ──────────────────────────────────────────────────────
 * 1. `z.coerce.boolean()` is WRONG for environment variables. Every non-empty
 *    string is truthy, so `DB_LOG_QUERIES=false` would coerce to `true`. The
 *    `envBoolean` helper below parses the literal text instead.
 * 2. Node's `process.loadEnvFile` does not overwrite variables that are
 *    already set, so a real environment always wins over the `.env` file.
 *    That is the behaviour we want in CI and in production.
 */

const envPath = repoEnvPath();
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

/** Parses `true`/`1`/`yes` as true and anything else as false. */
function booleanFromEnv(description: string) {
  return z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined || value.trim() === '') return false;
      const normalised = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(normalised)) return true;
      if (['false', '0', 'no', 'off'].includes(normalised)) return false;
      throw new Error(`${description} must be true or false, received "${value}".`);
    });
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  API_HOST: z.string().trim().min(1).default('127.0.0.1'),

  API_PORT: z.coerce
    .number()
    .int('API_PORT must be a whole number.')
    .min(1)
    .max(65_535)
    .default(4000),

  DATABASE_URL: z
    .string()
    .trim()
    .min(1, 'DATABASE_URL is required.')
    .refine(
      (value) => value.startsWith('postgresql://') || value.startsWith('postgres://'),
      'DATABASE_URL must be a postgresql:// connection string.',
    ),

  DB_LOG_QUERIES: booleanFromEnv('DB_LOG_QUERIES'),

  // --- Sessions and lockout (Phase 2) -------------------------------------
  /** How long a session stays valid. Twelve hours covers one long shift. */
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(12),

  /** Consecutive failures before the account is locked. */
  MAX_FAILED_LOGIN_ATTEMPTS: z.coerce.number().int().min(1).max(50).default(5),

  /** How long the account stays locked once the threshold is reached. */
  ACCOUNT_LOCK_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),

  BACKUP_ROOT: z.string().trim().min(1).default('data/backups'),
  PROOF_STORAGE_ROOT: z.string().trim().min(1).default('data/proofs'),
  POSTGRES_BIN_DIR: z.string().trim().min(1).default('.runtime/pgsql/bin'),
});

export type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const lines = result.error.issues.map((issue) => {
      const key = issue.path.join('.') || '(root)';
      return `  - ${key}: ${issue.message}`;
    });

    throw new Error(
      `Invalid environment configuration.\n${lines.join('\n')}\n\n` +
        `Checked ${envPath}. Copy .env.example to .env if it does not exist.`,
    );
  }

  /*
   * Filesystem settings are written in repository-root terms, so they are
   * anchored to the repository root here rather than left as written. The API's
   * working directory is `apps/api`, and a relative `.runtime/pgsql/bin`
   * resolved against it points at a directory that does not exist — which is
   * how every backup failed with `spawn ... ENOENT`.
   */
  return {
    ...result.data,
    BACKUP_ROOT: repoPath(result.data.BACKUP_ROOT),
    PROOF_STORAGE_ROOT: repoPath(result.data.PROOF_STORAGE_ROOT),
    POSTGRES_BIN_DIR: repoPath(result.data.POSTGRES_BIN_DIR),
  };
}

const DEV_PASSWORD = 'bcis_dev_password';

const parsed = parseEnv();

// A development password reaching production is a real risk when the same
// .env.example is copied between machines and the deployment step is manual.
if (parsed.NODE_ENV === 'production' && parsed.DATABASE_URL.includes(DEV_PASSWORD)) {
  throw new Error(
    'Refusing to start: NODE_ENV is production but DATABASE_URL still uses the ' +
      'development password from .env.example. Set a real credential.',
  );
}

export const env: Env = Object.freeze(parsed);

export const isDevelopment = env.NODE_ENV === 'development';
export const isTest = env.NODE_ENV === 'test';
export const isProduction = env.NODE_ENV === 'production';
