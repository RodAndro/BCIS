import { useQuery } from '@tanstack/react-query';

/**
 * Reference data shared by several screens.
 *
 * ── ONE QUERY KEY PER RESOURCE ──────────────────────────────────────────────
 * Areas, collectors, plans, and service types are read by more than one screen.
 * A shared key means whichever screen mounts first does the fetch and the rest
 * reuse it, so navigating between a subscriber and a service-account form does
 * not re-request data that has not changed.
 */

export function useCollectionAreas() {
  return useQuery({
    queryKey: ['collection-areas'],
    queryFn: () => window.bcis.collectionAreas.list(),
  });
}

export function useCollectors() {
  return useQuery({
    queryKey: ['collectors'],
    queryFn: () => window.bcis.collectors.list(),
  });
}

export function useServiceTypes() {
  return useQuery({
    queryKey: ['service-types'],
    queryFn: () => window.bcis.serviceTypes.list(),
  });
}

/**
 * Only the plans a NEW account may use: current version, not retired.
 *
 * The API enforces the same rule, so a stale list here produces a clear refusal
 * rather than a wrong account.
 */
export function useSelectablePlans() {
  return useQuery({
    queryKey: ['plans', 'selectable'],
    queryFn: () => window.bcis.plans.list({ currentOnly: true, status: 'ACTIVE', pageSize: 200 }),
  });
}

export function useSearchProviders() {
  return useQuery({
    queryKey: ['search-providers'],
    queryFn: () => window.bcis.search.providers(),
  });
}
