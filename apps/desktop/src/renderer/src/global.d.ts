import type { BcisBridge } from '@shared/ipc';

/**
 * Makes `window.bcis` visible to the renderer's TypeScript.
 *
 * Without this declaration the renderer would need a cast at every call site,
 * and casts are exactly where a typo in a channel name would hide.
 */
declare global {
  interface Window {
    readonly bcis: BcisBridge;
  }
}

export {};
