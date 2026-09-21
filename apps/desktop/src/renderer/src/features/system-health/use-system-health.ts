import { useQuery } from '@tanstack/react-query';

import type { AppInfo, HealthCheckResult } from '@shared/ipc';

/**
 * Queries for the Phase 1 system health screen.
 *
 * These are the only reads in the application so far, and they establish the
 * pattern every later screen follows: the renderer asks the main process
 * through `window.bcis`, never the network directly.
 */

export const SYSTEM_HEALTH_QUERY_KEY = ['system-health'] as const;
export const APP_INFO_QUERY_KEY = ['app-info'] as const;

/**
 * Polls the API and, through it, the database.
 *
 * 10 seconds is frequent enough that an operator notices a problem while
 * looking at the screen, and cheap enough to leave running: `/health` does no
 * work beyond reading process uptime, and `/health/db` runs a single `SELECT
 * version()`.
 */
export function useSystemHealth() {
  return useQuery<HealthCheckResult>({
    queryKey: SYSTEM_HEALTH_QUERY_KEY,
    queryFn: () => window.bcis.health.check(),
    refetchInterval: 10_000,
    // A failure here is information to display, not something to retry: the
    // whole point of the screen is to show that the API is down.
    retry: false,
  });
}

/** Main-process and Electron versions. Fetched once; they cannot change while running. */
export function useAppInfo() {
  return useQuery<AppInfo>({
    queryKey: APP_INFO_QUERY_KEY,
    queryFn: () => window.bcis.app.info(),
    staleTime: Number.POSITIVE_INFINITY,
  });
}
