import { QueryClient } from '@tanstack/react-query';

/**
 * Shared TanStack Query client.
 *
 * ── WHY RETRY IS OFF BY DEFAULT ─────────────────────────────────────────────
 * The default of three retries is wrong for this application. When the API is
 * unreachable, three silent retries delay the error a cashier needs to see by
 * several seconds, and for a POST a retry can mean a duplicate payment. Writes
 * are never retried automatically; reads that genuinely benefit opt in
 * explicitly at the call site.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      // Financial data must not be served from a stale cache: an invoice
      // balance shown thirty seconds behind reality is how a cashier
      // over-collects. Phase 5 revisits this per-query with explicit
      // invalidation after each posting.
      staleTime: 0,
      refetchOnWindowFocus: true,
    },
    mutations: {
      retry: false,
    },
  },
});
