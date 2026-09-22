import { schema } from '@bcis/database';
import type { SearchProvider } from '@bcis/validation';
import { ilike, or, sql, type SQL } from 'drizzle-orm';

/**
 * Subscriber search.
 *
 * ── THE DESIGN ──────────────────────────────────────────────────────────────
 * Searching for a subscriber is not a `LIKE` on one column. It is a list of
 * PROVIDERS, each of which knows how to match one kind of identifier and return
 * the subscribers it identifies:
 *
 *   account number    `SUB-000123` or a fragment of it
 *   subscriber name   partial, case-insensitive
 *   contact value     mobile, landline, or email
 *   service address   street, barangay, or city
 *
 * ── THIS IS THE PART THAT HAS TO SURVIVE LATER PHASES ───────────────────────
 * Phase 4 needs "find the subscriber for invoice INV-2026-000123"; Phase 5 needs
 * "find the subscriber for receipt RCPT-2026-000456" and "for GCash reference
 * 1234567890". Neither needs a new search endpoint, a new screen, or a change
 * to the query in `subscribers.repository` — each registers a provider:
 *
 *   registerSubscriberSearchProvider({
 *     key: 'invoice-number',
 *     label: 'Invoice number',
 *     description: 'Matches an invoice number on any of the subscriber's accounts.',
 *     buildPattern: (pattern) => sql`EXISTS (
 *       SELECT 1 FROM invoices i
 *       JOIN service_accounts sa ON sa.id = i.service_account_id
 *       WHERE sa.subscriber_id = ${schema.subscribers.id}
 *         AND i.invoice_number ILIKE ${pattern}
 *     )`,
 *   });
 *
 * A provider returns a condition on `subscribers.id` and nothing else, so the
 * union across providers is a plain `OR` and the subscriber list does not care
 * how many providers exist.
 */

export interface SubscriberSearchProvider {
  /** Machine key, e.g. `account-number`. */
  readonly key: string;
  /** Label for the "searching by" hint in the UI. */
  readonly label: string;
  readonly description: string;
  /**
   * A condition on `subscribers.id` for an already-escaped LIKE pattern.
   *
   * Returning `undefined` means "this provider cannot match that input" — for
   * example a provider that needs a numeric-looking term.
   */
  buildPattern(pattern: string): SQL | undefined;
}

const builtInProviders: readonly SubscriberSearchProvider[] = [
  {
    key: 'account-number',
    label: 'Account number',
    description: 'Matches any part of a subscriber account number.',
    buildPattern: (pattern) => ilike(schema.subscribers.accountNumber, pattern),
  },
  {
    key: 'name',
    label: 'Subscriber name',
    description: 'Matches any part of the subscriber name.',
    buildPattern: (pattern) => ilike(schema.subscribers.displayName, pattern),
  },
  {
    key: 'contact',
    label: 'Contact number',
    description: "Matches a mobile, landline, or email on the subscriber's record.",
    // Raw SQL because the match is on a different table, correlated by
    // `subscribers.id`. The table reference is interpolated by Drizzle, so the
    // column stays qualified and the pattern stays parameterised.
    buildPattern: (pattern) =>
      sql`EXISTS (
            SELECT 1 FROM subscriber_contacts c
            WHERE c.subscriber_id = ${schema.subscribers.id}
              AND c.value ILIKE ${pattern}
          )`,
  },
  {
    key: 'address',
    label: 'Service address',
    description: 'Matches the street, barangay, or city on any of the addresses.',
    buildPattern: (pattern) =>
      sql`EXISTS (
            SELECT 1 FROM subscriber_addresses a
            WHERE a.subscriber_id = ${schema.subscribers.id}
              AND (a.line1 ILIKE ${pattern}
                   OR coalesce(a.line2, '') ILIKE ${pattern}
                   OR coalesce(a.barangay, '') ILIKE ${pattern}
                   OR coalesce(a.city_municipality, '') ILIKE ${pattern})
          )`,
  },
];

/**
 * Providers registered by later phases.
 *
 * Mutable by design: `builtInProviders` is frozen, this is the extension point.
 */
const registeredProviders: SubscriberSearchProvider[] = [];

/**
 * Register an additional provider. Called by the module that owns the data.
 *
 * Idempotent by key: `buildApp()` runs more than once in a test process, and a
 * registry that threw on a repeated registration would make every integration
 * file after the first fail for a reason that has nothing to do with the
 * behaviour under test.
 */
export function registerSubscriberSearchProvider(provider: SubscriberSearchProvider): void {
  const existingIndex = registeredProviders.findIndex((existing) => existing.key === provider.key);

  if (existingIndex === -1) {
    registeredProviders.push(provider);
    return;
  }

  registeredProviders[existingIndex] = provider;
}

function allProviders(): readonly SubscriberSearchProvider[] {
  return [...builtInProviders, ...registeredProviders];
}

/** The provider list, for the search box's "searching by" hint. */
export function listSubscriberSearchProviders(): readonly SearchProvider[] {
  return allProviders().map((provider) => ({
    key: provider.key,
    label: provider.label,
    description: provider.description,
  }));
}

/**
 * Turn user input into a LIKE pattern.
 *
 * ── WHY THE WILDCARDS ARE ESCAPED ───────────────────────────────────────────
 * A user typing `100%` is looking for an account number containing "100%", not
 * for "everything". Without escaping, the `%` is a wildcard and the search
 * quietly returns the whole table. Postgres uses backslash as the default LIKE
 * escape character, so escaping these three is enough.
 */
export function toLikePattern(term: string): string {
  const escaped = term.replaceAll(/[\\%_]/g, (character) => `\\${character}`);
  return `%${escaped}%`;
}

/**
 * The `OR` across every provider, or `undefined` when the term was empty.
 *
 * An empty condition must not be turned into "match everything" by a caller, so
 * the absence is explicit.
 */
export function buildSubscriberSearchCondition(term: string): SQL | undefined {
  const trimmed = term.trim();
  if (trimmed.length === 0) return undefined;

  const pattern = toLikePattern(trimmed);
  const conditions = allProviders()
    .map((provider) => provider.buildPattern(pattern))
    .filter((condition): condition is SQL => condition !== undefined);

  if (conditions.length === 0) return undefined;
  return or(...conditions);
}
