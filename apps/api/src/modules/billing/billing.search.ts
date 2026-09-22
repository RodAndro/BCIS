import { schema } from '@bcis/database';
import { sql } from 'drizzle-orm';

import { registerSubscriberSearchProvider } from '../search/search.service';

/**
 * Billing's contribution to subscriber search.
 *
 * ── THIS IS THE POINT OF THE PHASE 3 DESIGN ─────────────────────────────────
 * Phase 3 built search as a registry of providers so that later phases could
 * make new identifiers searchable without touching the search endpoint, the
 * subscriber query, or the UI. This is that promise being kept: one function,
 * registered at startup, and "find the subscriber for INV-2026-000123" works.
 *
 * Phase 5 adds receipt numbers and GCash references the same way.
 */
export function registerBillingSearchProviders(): void {
  registerSubscriberSearchProvider({
    key: 'invoice-number',
    label: 'Invoice number',
    description: "Matches an invoice number on any of the subscriber's service accounts.",
    buildPattern: (pattern) =>
      sql`EXISTS (
            SELECT 1
              FROM invoices i
              JOIN service_accounts sa ON sa.id = i.service_account_id
             WHERE sa.subscriber_id = ${schema.subscribers.id}
               AND i.invoice_number ILIKE ${pattern}
          )`,
  });
}
