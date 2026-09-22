import { z } from 'zod';

/**
 * Search.
 *
 * ── THE DESIGN POINT ────────────────────────────────────────────────────────
 * Subscriber search is not a `LIKE` on one column. It is a set of registered
 * PROVIDERS, each of which knows how to match one kind of identifier and return
 * the subscribers it identifies:
 *
 *   Phase 3   account number, display name, contact value, address
 *   Phase 4   invoice number       (added by the billing module)
 *   Phase 5   receipt number, GCash reference   (added by payments)
 *
 * The endpoint does not change when a provider is added, and neither does the
 * UI: it renders whatever providers report themselves as. That is what makes
 * "search by receipt number" a registration rather than a rewrite.
 *
 * `key` is for machines, `label` for the search box's "searching by" hint.
 */
export const searchProviderSchema = z.object({
  key: z.string(),
  label: z.string(),
  /** What the provider matches, for the tooltip. */
  description: z.string(),
});

export type SearchProvider = z.infer<typeof searchProviderSchema>;

/** The subscriber search box. `q` may be a partial account number, name, phone, or street. */
export const subscriberSearchQuerySchema = z.object({
  q: z.string().trim().min(1, 'Enter something to search for.').max(120),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type SubscriberSearchQuery = z.infer<typeof subscriberSearchQuerySchema>;
