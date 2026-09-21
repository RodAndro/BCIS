#!/usr/bin/env node
/**
 * Ensures the Electron runtime binary is present after `pnpm install`.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * Electron 44 no longer declares a `postinstall` script in its published
 * manifest. It ships `install-electron` as a bin entry instead, so a plain
 * `pnpm install` installs the JavaScript wrapper and NOT the ~100 MB runtime.
 *
 * The failure mode is nasty: installation reports success, then
 * `electron-vite dev` dies with a missing-binary error that looks like a
 * configuration problem. On a fresh clone — or on the second and third office
 * PCs — that would be the first thing anyone hit.
 *
 * This script is idempotent and cheap: when the binary already exists it does
 * nothing and exits in a few milliseconds, so running on every install is fine.
 *
 * Deliberately NOT a `postinstall` in apps/desktop: dependency install order
 * across workspace projects is not something to rely on, and the root project
 * is always installed as part of the workspace.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const electronDir = join(repoRoot, 'apps', 'desktop', 'node_modules', 'electron');

if (!existsSync(join(electronDir, 'package.json'))) {
  // A filtered or partial install may not include the desktop app. That is not
  // an error here; whoever installs the desktop app will run this again.
  process.exit(0);
}

const binaryName =
  process.platform === 'win32'
    ? 'electron.exe'
    : process.platform === 'darwin'
      ? '' /* macOS ships an .app bundle; the directory check below covers it */
      : 'electron';

const distDir = join(electronDir, 'dist');
const binaryPath =
  process.platform === 'darwin' ? join(distDir, 'Electron.app') : join(distDir, binaryName);

if (existsSync(binaryPath)) {
  process.exit(0);
}

const installerPath = join(electronDir, 'install.js');

if (!existsSync(installerPath)) {
  console.error(
    '[electron] Cannot find install.js in the electron package. The install may be corrupt; ' +
      'try removing node_modules and running pnpm install again.',
  );
  process.exit(1);
}

console.log('[electron] Runtime binary missing. Downloading it now (one time, ~100 MB)...');

const result = spawnSync(process.execPath, [installerPath], {
  cwd: electronDir,
  stdio: 'inherit',
});

if (result.status !== 0 || !existsSync(binaryPath)) {
  console.error(
    '\n[electron] The runtime binary could not be installed.\n' +
      '  This is usually a network or proxy problem reaching github.com releases.\n' +
      '  Retry manually with:\n' +
      `    node "${installerPath}"\n`,
  );
  process.exit(result.status ?? 1);
}

console.log('[electron] Runtime binary installed.');
