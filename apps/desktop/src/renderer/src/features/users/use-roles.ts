import { useQuery } from '@tanstack/react-query';

/**
 * The role list, shared by the users screen and the role editor.
 *
 * A single query key means whichever component mounts first does the fetch and
 * the other reuses it, so opening the role editor does not produce a second
 * request for data already on screen.
 */
export function useRoles() {
  return useQuery({
    queryKey: ['roles'],
    queryFn: () => window.bcis.roles.list(),
  });
}
