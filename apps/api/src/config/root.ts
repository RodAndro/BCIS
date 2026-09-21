import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Locate the repository root by walking up until we find the workspace file.
 *
 * ── WHY NOT A RELATIVE PATH ─────────────────────────────────────────────────
 * `resolve(import.meta.dirname, '../../..')` works while the API is run from
 * source by tsx, and breaks the moment it is bundled into `dist/` or packaged
 * inside an Electron build, because the file's depth changes. A marker-based
 * search is depth-independent, so the same code is correct in development, in
 * a production bundle, and under the test runner.
 */
const ROOT_MARKER = 'pnpm-workspace.yaml';

export function findRepoRoot(startDirectory: string = import.meta.dirname): string {
  let current = startDirectory;

  for (;;) {
    if (existsSync(resolve(current, ROOT_MARKER))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      throw new Error(
        `Could not find "${ROOT_MARKER}" in any parent of ${startDirectory}. ` +
          'The API must run from inside the BCIS repository.',
      );
    }
    current = parent;
  }
}

/** Absolute path to the `.env` file, whether or not it exists. */
export function repoEnvPath(root: string = findRepoRoot()): string {
  return resolve(root, '.env');
}

/** Absolute path to the `database` package, which owns the migrations folder. */
export function databasePackagePath(root: string = findRepoRoot()): string {
  return resolve(root, 'database');
}
