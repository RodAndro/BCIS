import { contextBridge, ipcRenderer } from 'electron';

import { IPC_CHANNELS, type BcisBridge } from '@shared/ipc';

/**
 * Preload script — the entire trust boundary between the renderer and Node.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 * This file exposes a FIXED SET OF NAMED FUNCTIONS. It never exposes
 * `ipcRenderer` itself, never exposes a generic `invoke(channel, payload)`
 * passthrough, and never exposes `require`, `process`, or any Node module.
 *
 * Exposing `ipcRenderer.invoke` directly would be the classic mistake: the
 * renderer could then call ANY channel the main process handles, including
 * ones added later for privileged operations, which turns the whole IPC
 * surface into an attack surface.
 *
 * ── ARGUMENTS ARE NOT TRUSTED ───────────────────────────────────────────────
 * A user can open DevTools and call `window.bcis.health.check()` with
 * anything. These particular functions take no arguments, and every future
 * channel must validate its payload in the main process with a Zod schema
 * before using it.
 */

const bridge: BcisBridge = {
  health: {
    check: () => ipcRenderer.invoke(IPC_CHANNELS.HEALTH_CHECK),
  },
  app: {
    info: () => ipcRenderer.invoke(IPC_CHANNELS.APP_INFO),
  },
};

contextBridge.exposeInMainWorld('bcis', bridge);
