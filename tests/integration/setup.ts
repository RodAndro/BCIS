import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Integration test environment.
 *
 * ── WHY THIS MUST RUN BEFORE ANY TEST IMPORTS THE APP ───────────────────────
 * `apps/api/src/config/env.ts` reads `process.env` once, at module load. This
 * setup file runs first and repoints `DATABASE_URL` at the test database, so
 * by the time the app module is imported it sees the test configuration.
 * Without this, integration tests would run against development data and
 * truncate it.
 *
 * ── SAFETY ──────────────────────────────────────────────────────────────────
 * The test database is dropped and rebuilt between runs. Two guards keep that
 * from ever touching the wrong database:
 *   1. TEST_DATABASE_URL must be set explicitly. There is no fallback to
 *      DATABASE_URL, because a missing variable silently becoming the
 *      development database is precisely the accident to avoid.
 *   2. The URL must not equal DATABASE_URL.
 */

const repoRoot = resolve(import.meta.dirname, '../..');
const envPath = resolve(repoRoot, '.env');

if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const developmentDatabaseUrl = process.env.DATABASE_URL;

if (testDatabaseUrl === undefined || testDatabaseUrl.length === 0) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Integration tests need a separate database ' +
      'that they may destroy. Add it to .env (see .env.example).',
  );
}

if (testDatabaseUrl === developmentDatabaseUrl) {
  throw new Error(
    'TEST_DATABASE_URL must not be the same as DATABASE_URL. Integration tests ' +
      'destroy the database they run against.',
  );
}

process.env.DATABASE_URL = testDatabaseUrl;
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
