/**
 * The IPC contract between the Electron main process and the renderer.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * The renderer runs with `contextIsolation: true`, `nodeIntegration: false`,
 * and `sandbox: true`. It has no network access, no filesystem access, and no
 * session token. Every resource it needs comes through a named channel listed
 * below, and the preload script exposes exactly these channels and nothing
 * else.
 *
 * Keeping the channel names and payload types in one shared file means the
 * main process handler and the renderer caller cannot drift apart without the
 * type checker noticing.
 *
 * ── ADDING A CHANNEL ────────────────────────────────────────────────────────
 * 1. Add the channel constant here.
 * 2. Add its request/response types here.
 * 3. Handle it in `src/main/index.ts` with `ipcMain.handle`.
 * 4. Expose it in `src/preload/index.ts`.
 * 5. Validate the payload in the main process. The renderer is not trusted:
 *    a user can open DevTools and call any exposed function with any argument.
 */

export const IPC_CHANNELS = {
  HEALTH_CHECK: 'health:check',
  APP_INFO: 'app:info',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

/** Result of probing the API, and through it the database. */
export interface HealthCheckResult {
  /** True only when the API is reachable AND the database is connected. */
  readonly ok: boolean;
  readonly api: {
    readonly reachable: boolean;
    readonly baseUrl: string;
    readonly status: string | null;
    readonly version: string | null;
    readonly latencyMs: number;
    readonly error: string | null;
  };
  readonly database: {
    readonly connected: boolean;
    /**
     * `ok`      — reachable and fully migrated
     * `degraded`— reachable but migrations are pending
     * `unavailable` — not reachable
     */
    readonly status: 'ok' | 'degraded' | 'unavailable' | null;
    readonly latencyMs: number | null;
    readonly serverVersion: string | null;
    readonly appliedMigrations: number | null;
    readonly pendingMigrations: readonly string[];
    readonly error: string | null;
  };
  readonly checkedAt: string;
}

export interface AppInfo {
  readonly name: string;
  readonly version: string;
  readonly electronVersion: string;
  readonly chromeVersion: string;
  readonly nodeVersion: string;
  readonly platform: string;
  readonly apiBaseUrl: string;
}

/** The complete surface exposed to the renderer as `window.bcis`. */
export interface BcisBridge {
  readonly health: {
    readonly check: () => Promise<HealthCheckResult>;
  };
  readonly app: {
    readonly info: () => Promise<AppInfo>;
  };
}
