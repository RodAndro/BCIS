import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Locate the API base URL for the main process.
 *
 * ── WHY THIS IS DUPLICATED FROM apps/api ────────────────────────────────────
 * The API's `config/root.ts` does the same walk, but it lives in a Node-only
 * package that the renderer must never import. Keeping a small copy here is
 * preferable to publishing a filesystem-touching helper from `@bcis/shared`,
 * because that package is also bundled into the sandboxed renderer.
 *
 * ── WHY A MARKER, NOT A RELATIVE PATH ───────────────────────────────────────
 * In development the main process runs from `apps/desktop/out/main`, and in a
 * packaged build it runs from inside an asar archive. A marker-based upward
 * search is depth-independent, so the same code works in both.
 */

const ROOT_MARKER = 'pnpm-workspace.yaml';
const DEFAULT_API_BASE_URL = 'http://127.0.0.1:4000';

function findRepoRoot(startDirectory: string): string | null {
  let current = startDirectory;

  for (;;) {
    if (existsSync(resolve(current, ROOT_MARKER))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

/**
 * Only http and https are acceptable.
 *
 * A `file://` or `javascript:` base URL would turn the API client into a
 * local-file reader. The value comes from configuration, but configuration is
 * exactly the sort of thing that gets edited in a hurry.
 */
function assertHttpUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`BCIS_API_URL is not a valid URL: "${value}".`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`BCIS_API_URL must use http or https, received "${parsed.protocol}".`);
  }

  return value.endsWith('/') ? value.slice(0, -1) : value;
}

export function loadApiBaseUrl(): string {
  const fromEnvironment = process.env.BCIS_API_URL;
  if (fromEnvironment !== undefined && fromEnvironment.length > 0) {
    return assertHttpUrl(fromEnvironment);
  }

  const root = findRepoRoot(__dirname);
  if (root !== null) {
    const envPath = resolve(root, '.env');
    if (existsSync(envPath)) {
      try {
        // Does not overwrite variables already present in the environment,
        // which is what we want when a deployment sets them properly.
        process.loadEnvFile(envPath);
      } catch {
        // A malformed .env must not stop the app from starting; the default
        // below is still usable and the health panel will report the problem.
      }

      const fromFile = process.env.BCIS_API_URL;
      if (fromFile !== undefined && fromFile.length > 0) {
        return assertHttpUrl(fromFile);
      }
    }
  }

  return DEFAULT_API_BASE_URL;
}
