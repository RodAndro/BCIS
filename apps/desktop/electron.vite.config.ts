import { resolve } from 'node:path';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import type { Plugin } from 'vite';

/**
 * The production Content Security Policy.
 *
 * ── WHY IT IS INJECTED INTO THE HTML RATHER THAN SENT AS A HEADER ───────────
 * In production the renderer is loaded from `file://`. Electron's
 * `webRequest.onHeadersReceived` does not reliably fire for file URLs, so a
 * header-based policy would silently not apply — the worst kind of security
 * control, one that looks present and is not.
 *
 * A `meta http-equiv` tag travels with the document instead, so it applies
 * however the page was loaded. In development the renderer is served over HTTP
 * by Vite, where a (necessarily looser) header policy is applied in
 * `src/main/index.ts`; this plugin is build-only so the two never conflict.
 *
 * `connect-src 'none'` is correct because the renderer never makes network
 * requests: all API traffic goes through the main process. That closes the
 * simplest data-exfiltration path if a renderer-side dependency is ever
 * compromised.
 */
const PRODUCTION_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

function productionCspPlugin(): Plugin {
  return {
    name: 'bcis-production-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html: string) {
        const metaTag = `<meta http-equiv="Content-Security-Policy" content="${PRODUCTION_CSP}" />`;

        // Placed immediately after the charset declaration, which is the
        // earliest point a meta tag may appear.
        //
        // ── WHY NOT JUST BEFORE </head> ────────────────────────────────────
        // Vite injects the module script and stylesheet link at the end of
        // <head>. Inserting the policy there left it AFTER the script it is
        // supposed to govern, and a meta CSP only applies to content that
        // follows it — so the entry bundle would have been fetched before the
        // policy took effect. It has to come first to mean anything.
        const anchor = '<meta charset="UTF-8" />';
        if (html.includes(anchor)) {
          return html.replace(anchor, `${anchor}\n    ${metaTag}`);
        }

        // Fallback if the charset tag is ever written differently.
        return html.replace('<head>', `<head>\n    ${metaTag}`);
      },
    },
  };
}

/**
 * Workspace packages are BUNDLED, not externalized.
 *
 * ── WHY THIS IS NOT THE DEFAULT ─────────────────────────────────────────────
 * `externalizeDepsPlugin` turns every declared dependency into a runtime
 * `require()`. That is right for compiled npm packages and wrong for these two:
 * their `exports` map points at TypeScript source (`./src/index.ts`), because
 * the API consumes them through tsx and Vite. A `require('@bcis/validation')`
 * from `out/main/index.js` would therefore try to load a `.ts` file at runtime
 * and fail.
 *
 * Excluding them lets Vite bundle and transpile them along with the main
 * process. `zod`, which `@bcis/validation` depends on, is not a dependency of
 * this package, so it is not externalized either and is bundled too.
 */
const BUNDLED_WORKSPACE_PACKAGES = ['@bcis/shared', '@bcis/validation'];

const workspaceAliases = {
  '@bcis/shared': resolve('../../packages/shared/src/index.ts'),
  '@bcis/validation': resolve('../../packages/validation/src/index.ts'),
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: BUNDLED_WORKSPACE_PACKAGES })],
    resolve: {
      alias: { '@shared': resolve('src/shared'), ...workspaceAliases },
    },
  },

  preload: {
    plugins: [externalizeDepsPlugin({ exclude: BUNDLED_WORKSPACE_PACKAGES })],
    resolve: {
      alias: { '@shared': resolve('src/shared'), ...workspaceAliases },
    },
  },

  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared'),
        ...workspaceAliases,
      },
    },
    plugins: [react(), tailwindcss(), productionCspPlugin()],
  },
});
