import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

import {
  type ElectronApplication,
  type Page,
  _electron as electron,
  expect,
  test,
} from '@playwright/test';

/**
 * Phase 1 end-to-end test: the desktop application launches and renders.
 *
 * ── WHAT THIS PROVES THAT THE OTHER SUITES CANNOT ───────────────────────────
 * The integration suite calls `buildApp()` in-process and uses `app.inject()`,
 * which never touches a socket and never touches Electron. It therefore cannot
 * observe any of the following, and all of them are real ways for the
 * application to ship broken:
 *
 *   - the preload script is found at the path the main process expects;
 *   - `contextBridge` actually publishes the bridge into the renderer's world;
 *   - the renderer bundle executes and React mounts;
 *   - the renderer has no Node access, which is the entire point of the
 *     sandbox and the one property a regression would silently remove.
 *
 * ── WHY THE APP IS LAUNCHED FROM ITS BUILD OUTPUT ───────────────────────────
 * This runs `out/`, the same artefact a packaged installation runs. Launching
 * the Vite dev server instead would exercise a different CSP and a different
 * module-loading path, and would prove less about what actually ships. The
 * root `test:e2e` script builds the desktop app first for that reason.
 *
 * ── WHY THE API IS NOT STARTED HERE ─────────────────────────────────────────
 * Every assertion below is about the shell, not about connectivity, so the
 * suite is deterministic whether or not an API happens to be running on the
 * workstation. The "show a real failure rather than a stale healthy" behaviour
 * is verified in §13 of the roadmap and covered from the API side by
 * `tests/integration/health.test.ts`.
 */

const ROOT_MARKER = 'pnpm-workspace.yaml';

/**
 * Locate the repository root by walking up until the workspace marker is found.
 *
 * ── WHY NOT import.meta.dirname ─────────────────────────────────────────────
 * Playwright compiles spec files without an ESM context here, because the root
 * package.json is not `"type": "module"`. `import.meta` is unavailable in that
 * output, so the marker search used by `apps/api/src/config/root.ts`,
 * `apps/desktop/src/main/repo-env.ts`, and `database/drizzle.config.ts` is
 * reused — the same problem, the same solution, one convention.
 */
function findRepoRoot(startDirectory: string): string {
  let current = startDirectory;

  for (;;) {
    if (existsSync(resolve(current, ROOT_MARKER))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      throw new Error(
        `Could not find "${ROOT_MARKER}" above ${startDirectory}. ` +
          'Run the end-to-end suite from inside the BCIS repository.',
      );
    }
    current = parent;
  }
}

const desktopAppDirectory = resolve(findRepoRoot(process.cwd()), 'apps', 'desktop');

/**
 * Resolve the Electron executable the way Electron itself does.
 *
 * ── WHY createRequire ───────────────────────────────────────────────────────
 * `electron` is a dependency of `@bcis/desktop`, not of the repository root,
 * and pnpm's isolated `node_modules` means a plain `require('electron')` from
 * this file would not resolve at all. Asking from the desktop package's own
 * directory puts the question where the answer is.
 *
 * `require('electron')` returns the absolute path to the binary, not a module:
 * that is what the package deliberately exports outside of an Electron runtime.
 */
const requireFromDesktop = createRequire(resolve(desktopAppDirectory, 'package.json'));

function resolveElectronExecutable(): string {
  const resolved: unknown = requireFromDesktop('electron');

  if (typeof resolved !== 'string') {
    throw new Error(
      'The electron package did not resolve to an executable path. ' +
        'The runtime binary may be missing; run `pnpm install` again.',
    );
  }

  return resolved;
}

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  app = await electron.launch({
    executablePath: resolveElectronExecutable(),
    // The application directory, exactly as `electron .` would receive it.
    args: [desktopAppDirectory],
    cwd: desktopAppDirectory,
  });

  page = await app.firstWindow();
});

test.afterAll(async () => {
  // A leaked Electron process would hold port state and the single-instance
  // lock, making the next run fail for reasons that have nothing to do with
  // the code under test.
  await app.close();
});

test('starts the main process and opens the application window', async () => {
  await expect(page).toHaveTitle('BCIS Subscription Billing and Collection System');

  const url = page.url();
  const isDevServer = url.startsWith('http://');
  const isPackagedFile = url.startsWith('file://');

  expect(isDevServer || isPackagedFile).toBe(true);
});

test('renders the application shell and the system health screen', async () => {
  await expect(page.getByText('BCIS Billing')).toBeVisible();

  await expect(page.getByRole('heading', { name: 'System Health' })).toBeVisible();

  // The health screen is the only screen Phase 1 implements, and it is marked
  // as the current page. Everything else in the sidebar advertises the phase
  // that will build it rather than pretending to be navigable.
  await expect(page.locator('[aria-current="page"]')).toHaveText('System Health');

  await expect(page.getByText('Live status of the API and the PostgreSQL database')).toBeVisible();
});

test('exposes exactly the declared preload surface to the renderer', async () => {
  const bridge = await page.evaluate(() => {
    const exposed = (window as unknown as { bcis?: Record<string, Record<string, unknown>> }).bcis;

    const typeOfMember = (namespace: string, member: string): string =>
      typeof exposed?.[namespace]?.[member];

    return {
      namespaces: Object.keys(exposed ?? {}).sort(),
      healthCheck: typeOfMember('health', 'check'),
      appInfo: typeOfMember('app', 'info'),
    };
  });

  // The bridge is a fixed set of named functions. If a generic
  // `invoke(channel, payload)` passthrough were ever added, this assertion
  // would fail — which is the point, because that passthrough would let the
  // renderer reach every channel the main process handles, including ones
  // added later for privileged operations.
  expect(bridge.namespaces).toEqual(['app', 'health']);
  expect(bridge.healthCheck).toBe('function');
  expect(bridge.appInfo).toBe('function');
});

test('leaves the renderer without Node access', async () => {
  const nodeGlobals = await page.evaluate(() => {
    const scope = window as unknown as Record<string, unknown>;

    return {
      require: typeof scope['require'],
      process: typeof scope['process'],
      module: typeof scope['module'],
      Buffer: typeof scope['Buffer'],
    };
  });

  expect(nodeGlobals).toEqual({
    require: 'undefined',
    process: 'undefined',
    module: 'undefined',
    Buffer: 'undefined',
  });
});

test('runs the renderer with the sandbox, context isolation, and no Node integration', async () => {
  // Read back from the main process rather than trusting the source: this is
  // the effective configuration of the window that actually opened, which is
  // what a security review needs to see. The renderer cannot report this about
  // itself, and should not be able to.
  const preferences = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.webContents.getLastWebPreferences(),
  );

  expect(preferences).toBeDefined();
  expect(preferences?.sandbox).toBe(true);
  expect(preferences?.contextIsolation).toBe(true);
  expect(preferences?.nodeIntegration).toBe(false);
  expect(preferences?.webSecurity).toBe(true);
  expect(preferences?.webviewTag).toBeFalsy();
});
