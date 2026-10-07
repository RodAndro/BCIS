import { join } from 'node:path';

import { BrowserWindow, Menu, app, session, shell } from 'electron';

import { registerIpcHandlers } from './ipc';

/**
 * Electron main process.
 *
 * ── SECURITY POSTURE ────────────────────────────────────────────────────────
 * The renderer is treated as untrusted. It runs with:
 *   contextIsolation: true   — preload and page scripts get separate worlds
 *   nodeIntegration:  false  — no `require`, no `process`, no filesystem
 *   sandbox:          true   — the renderer runs in the OS sandbox
 * and it can reach the outside world only through the named channels in
 * `@shared/ipc`. Everything else in this file exists to keep it that way:
 * navigation is blocked, new windows are refused, and the only permitted
 * outbound HTTP is from this process to the API.
 *
 * The IPC handlers themselves live in `ipc.ts`, and the session token they
 * manage lives in `api.ts` — in this process, never in the renderer.
 */

// A business application should not run two copies on one workstation: two
// windows would mean two sessions and, potentially, two cashiers at one till.
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  void start();
}

async function start(): Promise<void> {
  app.on('second-instance', () => {
    const existing = BrowserWindow.getAllWindows()[0];
    if (existing !== undefined) {
      if (existing.isMinimized()) existing.restore();
      existing.focus();
    }
  });

  app.on('web-contents-created', (_event, contents) => {
    // Never navigate away from the application shell. A compromised or
    // misconfigured page must not be able to turn the window into a browser
    // pointed at attacker-controlled content.
    contents.on('will-navigate', (event, url) => {
      if (!isApplicationUrl(url)) {
        event.preventDefault();
        logBlocked('navigation', url);
      }
    });

    contents.setWindowOpenHandler(({ url }) => {
      // Refuse every popup. Genuine external links (help pages, for example)
      // are opened in the system browser, and only when the scheme is safe.
      if (url.startsWith('https://')) {
        void shell.openExternal(url);
      } else {
        logBlocked('window-open', url);
      }
      return { action: 'deny' };
    });

    // Attaching to a webview would let the page bypass the preload contract.
    contents.on('will-attach-webview', (event) => {
      event.preventDefault();
    });
  });

  await app.whenReady();

  applyContentSecurityPolicy();
  applyApplicationMenu();
  registerIpcHandlers();

  await createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
}

async function createMainWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    // Matches --background so the window does not flash white before React
    // paints, which is jarring on a screen a cashier looks at all day.
    backgroundColor: '#f2f6fb',
    title: 'BCIS Subscription Billing and Collection System',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),

      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      // The renderer never loads remote content, so there is nothing to
      // validate; leaving this enabled would only add noise.
      spellcheck: false,
    },
  });

  window.once('ready-to-show', () => {
    window.show();
  });

  const rendererDevUrl = process.env.ELECTRON_RENDERER_URL;

  if (rendererDevUrl !== undefined && rendererDevUrl.length > 0) {
    await window.loadURL(rendererDevUrl);
  } else {
    await window.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return window;
}

/**
 * Development-only CSP header.
 *
 * ── WHY ONLY IN DEVELOPMENT ─────────────────────────────────────────────────
 * In development the renderer is served over HTTP by the Vite dev server, so
 * response headers are available and `onHeadersReceived` applies. It has to
 * permit `'unsafe-inline'` scripts because Vite injects the React Refresh
 * preamble inline, and a websocket because HMR needs one.
 *
 * In production the renderer is loaded from `file://`, where response headers
 * do not reliably exist. The strict production policy is therefore injected
 * into the HTML at build time by a plugin in `electron.vite.config.ts`. Putting
 * a second, looser policy here would only weaken it.
 */
function applyContentSecurityPolicy(): void {
  const rendererDevUrl = process.env.ELECTRON_RENDERER_URL;

  if (rendererDevUrl === undefined || rendererDevUrl.length === 0) {
    return;
  }

  const devPolicy = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self' ws://localhost:* ws://127.0.0.1:* http://localhost:* http://127.0.0.1:*",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [devPolicy],
      },
    });
  });
}

/**
 * Removes the default menu, which exposes developer tooling and reload
 * shortcuts that have no place in a production till. In development a reduced
 * menu keeps DevTools reachable.
 */
function applyApplicationMenu(): void {
  const isDevelopment = process.env.ELECTRON_RENDERER_URL !== undefined;

  if (!isDevelopment) {
    Menu.setApplicationMenu(null);
    return;
  }

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'forceReload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
    ]),
  );
}

/** Only the dev server URL, or the packaged app's own files, are navigable. */
function isApplicationUrl(url: string): boolean {
  const rendererDevUrl = process.env.ELECTRON_RENDERER_URL;

  if (rendererDevUrl !== undefined && url.startsWith(rendererDevUrl)) {
    return true;
  }
  return url.startsWith('file://');
}

function logBlocked(action: string, url: string): void {
  // Written to stderr rather than the renderer console: a blocked navigation is
  // a security event and must be visible outside the page it came from.
  process.stderr.write(`[security] blocked ${action} to ${url}\n`);
}

app.on('window-all-closed', () => {
  // On Windows closing the last window should exit. This application is
  // Windows-only, so the macOS convention of staying resident does not apply.
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
