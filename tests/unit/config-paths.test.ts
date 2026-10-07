import { isAbsolute, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { findRepoRoot, repoPath } from '../../apps/api/src/config/root';

/**
 * Regression: every backup failed with `spawn …\.runtime\pgsql\bin\pg_dump.exe
 * ENOENT`.
 *
 * The cause was not the setting, it was where the setting was resolved. `.env`
 * writes `POSTGRES_BIN_DIR=.runtime/pgsql/bin` in repository-root terms, but it
 * was resolved against the process's working directory — and the API runs with
 * `apps/api` as its cwd, so the binary was sought one directory too deep. The
 * same applied to `BACKUP_ROOT`, which wrote its output under
 * `apps/api/data/backups` instead of the repository's `data/backups`.
 *
 * Asserting on absoluteness is what makes this robust: `env.BACKUP_ROOT` was
 * the literal string `"data/backups"` before the fix and an absolute path
 * after, whatever a particular `.env` happens to contain.
 */
describe('API filesystem configuration', () => {
  it('anchors a repository-relative setting at the repository root', () => {
    const root = findRepoRoot();

    expect(repoPath('.runtime/pgsql/bin')).toBe(resolve(root, '.runtime/pgsql/bin'));
    expect(repoPath('data/backups')).toBe(resolve(root, 'data/backups'));
  });

  it('leaves an already-absolute setting alone', () => {
    const absolute = resolve(findRepoRoot(), 'somewhere', 'else');

    expect(repoPath(absolute)).toBe(absolute);
  });

  it('exposes the configured paths as absolute paths', async () => {
    /*
     * Provided so the module parses on a machine with no `.env`: the values are
     * not the point, only that whatever is configured comes back absolute.
     * `process.loadEnvFile` never overwrites a variable that is already set, so
     * these win over the file either way.
     */
    process.env['NODE_ENV'] = 'test';
    process.env['DATABASE_URL'] = 'postgresql://bcis:test@127.0.0.1:5432/bcis_test';

    const { env } = await import('../../apps/api/src/config/env');

    expect(isAbsolute(env.BACKUP_ROOT)).toBe(true);
    expect(isAbsolute(env.PROOF_STORAGE_ROOT)).toBe(true);
    expect(isAbsolute(env.POSTGRES_BIN_DIR)).toBe(true);
  });
});
