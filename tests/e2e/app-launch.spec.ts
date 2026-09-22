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
 * End-to-end tests: the desktop application launches, renders, and keeps its
 * security posture.
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
 *     sandbox and the one property a regression would silently remove;
 *   - the session token is NOT reachable from the renderer.
 *
 * ── WHY THE APP IS LAUNCHED FROM ITS BUILD OUTPUT ───────────────────────────
 * This runs `out/`, the same artefact a packaged installation runs. Launching
 * the Vite dev server instead would exercise a different CSP and a different
 * module-loading path, and would prove less about what actually ships. The
 * root `test:e2e` script builds the desktop app first for that reason.
 *
 * ── WHY NO API IS STARTED HERE ──────────────────────────────────────────────
 * With no token, the client asks for its session state and gets "not signed
 * in" without making a request, so the sign-in screen is what renders. Every
 * assertion below is about the shell and the bridge, not about connectivity, so
 * the suite is deterministic whether or not an API happens to be running.
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

test('renders the sign-in screen when no session is present', async () => {
  await expect(page.getByText('BCIS Billing')).toBeVisible();

  // No token exists in the main process, so the client reports "not signed in"
  // without making a request and the gate renders the sign-in form.
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByLabel('Username')).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();

  // The shell is NOT rendered behind it: a sign-in screen that is a modal over
  // a live workspace is how another user's data ends up visible.
  await expect(page.getByRole('heading', { name: 'System Health' })).toHaveCount(0);
});

test('reports a failed sign-in to the user rather than failing silently', async () => {
  await page.getByLabel('Username').fill('no.such.user');
  await page.getByLabel('Password').fill('definitely-not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Whether the API is unreachable or the credentials are wrong, the user must
  // be told something. The specific message is asserted by the integration
  // suite, which controls both variables.
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 15_000 });
});

test('exposes exactly the declared preload surface to the renderer', async () => {
  const bridge = await page.evaluate(() => {
    const exposed = (window as unknown as { bcis?: Record<string, Record<string, unknown>> }).bcis;

    return {
      namespaces: Object.keys(exposed ?? {}).sort(),
      healthCheck: typeof exposed?.['health']?.['check'],
      authLogin: typeof exposed?.['auth']?.['login'],
      usersList: typeof exposed?.['users']?.['list'],
      rolesList: typeof exposed?.['roles']?.['list'],
      auditList: typeof exposed?.['audit']?.['list'],
      settingsList: typeof exposed?.['settings']?.['list'],
      subscribersList: typeof exposed?.['subscribers']?.['list'],
      serviceAccountsList: typeof exposed?.['serviceAccounts']?.['list'],
      plansList: typeof exposed?.['plans']?.['list'],
      searchSubscribers: typeof exposed?.['search']?.['subscribers'],
      billingDashboard: typeof exposed?.['billing']?.['dashboard'],
      billingGenerate: typeof exposed?.['billing']?.['generate'],
      invoicesList: typeof exposed?.['invoices']?.['list'],
      invoiceVoid: typeof exposed?.['invoices']?.['void'],
      ledgerSubscriber: typeof exposed?.['ledger']?.['subscriber'],
      ledgerServiceAccount: typeof exposed?.['ledger']?.['serviceAccount'],
      receivablesList: typeof exposed?.['receivables']?.['list'],
      reportsDashboard: typeof exposed?.['reports']?.['dashboard'],
      // A generic passthrough would let the renderer reach every channel the
      // main process handles, including privileged ones added later.
      hasGenericInvoke: exposed?.['invoke'] !== undefined,
      hasIpcRenderer: exposed?.['ipcRenderer'] !== undefined,
    };
  });

  expect(bridge.namespaces).toEqual([
    'app',
    'audit',
    'auth',
    'billing',
    'collectionAreas',
    'collectors',
    'health',
    'invoices',
    'ledger',
    'permissions',
    'plans',
    'receivables',
    'reports',
    'roles',
    'search',
    'serviceAccounts',
    'serviceTypes',
    'settings',
    'subscribers',
    'users',
  ]);

  expect(bridge.healthCheck).toBe('function');
  expect(bridge.authLogin).toBe('function');
  expect(bridge.usersList).toBe('function');
  expect(bridge.rolesList).toBe('function');
  expect(bridge.auditList).toBe('function');
  expect(bridge.settingsList).toBe('function');
  expect(bridge.subscribersList).toBe('function');
  expect(bridge.serviceAccountsList).toBe('function');
  expect(bridge.plansList).toBe('function');
  expect(bridge.searchSubscribers).toBe('function');
  expect(bridge.billingDashboard).toBe('function');
  expect(bridge.billingGenerate).toBe('function');
  expect(bridge.invoicesList).toBe('function');
  expect(bridge.invoiceVoid).toBe('function');
  expect(bridge.ledgerSubscriber).toBe('function');
  expect(bridge.ledgerServiceAccount).toBe('function');
  expect(bridge.receivablesList).toBe('function');
  expect(bridge.reportsDashboard).toBe('function');

  expect(bridge.hasGenericInvoke).toBe(false);
  expect(bridge.hasIpcRenderer).toBe(false);
});

test('never exposes the session token to the renderer', async () => {
  const state = await page.evaluate(async () => {
    const bridge = (
      window as unknown as {
        bcis: { auth: { me: () => Promise<Record<string, unknown>> } };
      }
    ).bcis;

    const result = await bridge.auth.me();

    return {
      keys: Object.keys(result).sort(),
      stateKeys: Object.keys((result['state'] ?? {}) as Record<string, unknown>).sort(),
      serialised: JSON.stringify(result),
    };
  });

  // The token lives in main-process memory. If it ever appears in this payload,
  // a renderer compromise becomes a session compromise.
  expect(state.serialised).not.toContain('token');
  expect(state.keys).toEqual(['error', 'errorCode', 'ok', 'state']);
  expect(state.stateKeys).toEqual(['authenticated', 'locked', 'user']);
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
