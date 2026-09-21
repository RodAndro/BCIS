import { defineConfig } from '@playwright/test';

/**
 * Playwright configuration for the Electron end-to-end suite.
 *
 * ── SCOPE IN PHASE 1 ────────────────────────────────────────────────────────
 * Phase 1 owns exactly one end-to-end test: the application launches and the
 * shell renders. That is not a placeholder. It is the only claim Phase 1 makes
 * about the desktop, and it is the claim most likely to break silently — a
 * wrong preload path, a sandbox flag that hides the bridge, or a renderer that
 * throws on first paint all produce an application that "starts" and is
 * unusable. The full acceptance scenarios (AT-01 … AT-12) belong to the phases
 * that build the workflows they exercise, not here.
 *
 * ── WHY VITEST AND PLAYWRIGHT BOTH EXIST ────────────────────────────────────
 * They answer different questions and must not be merged. Vitest runs the unit
 * and integration suites in-process, including against a real PostgreSQL.
 * Playwright drives a real Electron process, which is the only way to observe
 * the renderer → preload → main → HTTP chain from the outside.
 *
 * The two are kept apart by file name: Vitest includes `tests/integration` and
 * `tests/unit`, Playwright owns `tests/e2e`. Neither pattern matches the
 * other's files, so `pnpm test` never tries to run an Electron window.
 *
 * ── WHY NO BROWSER DOWNLOAD IS NEEDED ───────────────────────────────────────
 * These tests drive the Electron binary already installed for `@bcis/desktop`,
 * not a Playwright-managed Chromium. `playwright install` is therefore not
 * part of the setup, and a fresh clone does not pull several hundred megabytes
 * it will never use.
 */
export default defineConfig({
  testDir: './tests/e2e',

  // One Electron application at a time. These tests drive a real desktop
  // process that takes a single-instance lock, so running them concurrently
  // would make the outcome depend on scheduling rather than on the code.
  fullyParallel: false,
  workers: 1,

  // A launch failure is a real failure. Retrying it would hide flakiness in the
  // main-process wiring instead of reporting it.
  retries: 0,

  // Electron cold start plus renderer hydration. Long enough for a loaded
  // workstation, short enough that a hang is reported rather than waited out.
  timeout: 60_000,
  expect: { timeout: 10_000 },

  reporter: [['list']],
});
