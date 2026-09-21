import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit configuration.
 *
 * Drizzle Kit is the migration author. It never runs against production
 * directly — migrations are SQL files committed to the repository and applied
 * by `src/migrate.ts`, so every schema change is reviewable in a diff.
 */

/**
 * ── WHY NOT import.meta.dirname ─────────────────────────────────────────────
 * Drizzle Kit transpiles this file before loading it, and `import.meta.dirname`
 * is undefined in the transpiled output. Using it produced
 * `The "paths[0]" argument must be of type string. Received undefined` — a
 * crash inside `resolve()` rather than anything resembling a config error.
 *
 * Searching upward for the workspace marker from the working directory is
 * depth-independent and works whether the config is imported directly, bundled,
 * or run from a workspace subdirectory.
 */
function findRepoRoot(startDirectory: string): string {
  let current = startDirectory;

  for (;;) {
    if (existsSync(resolve(current, 'pnpm-workspace.yaml'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(
        `Could not locate pnpm-workspace.yaml above ${startDirectory}. ` +
          'Run drizzle-kit from inside the BCIS repository.',
      );
    }
    current = parent;
  }
}

const rootEnvPath = resolve(findRepoRoot(process.cwd()), '.env');
if (existsSync(rootEnvPath)) {
  // Node's built-in .env loader: no dotenv dependency, and it refuses to
  // overwrite variables that are already set in the real environment, which is
  // what we want in CI.
  process.loadEnvFile(rootEnvPath);
}

const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env and fill it in, ' +
      'or start the local cluster with `pnpm pg:start`.',
  );
}

export default defineConfig({
  // Schema is authored in TypeScript and read by Drizzle Kit to generate SQL.
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: { url: databaseUrl },

  // Fail rather than guess when a change is ambiguous (for example, a rename
  // that looks like a drop plus an add). A wrong guess here means data loss.
  strict: true,
  verbose: true,

  migrations: {
    // Keep the journal and SQL files in the repository, never gitignored.
    table: '__drizzle_migrations',
    schema: 'drizzle',
  },
});
