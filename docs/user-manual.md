# BCIS User Manual

This manual describes the implemented screens. Payment capture, allocation, GCash verification, receipts, and payment reversal are available; reports are read-only views over posted data.

## Login

Start the API and desktop client. Sign in with the account created for your role. Lock the session before leaving a workstation. Failed sign-ins are rate-limited and can lock the account temporarily.

## Dashboard and reports

Open Dashboard & Reports to view live receivables, overdue totals, billing/collection values, and report tables. Choose a report, pick Excel, PDF, or CSV, then press **Export** to save it to a file you choose. Exporting needs the `report.export` permission. Values come from the server database.

## Subscribers and service accounts

Use Subscribers to register a synthetic subscriber, add addresses and contacts, then create a service account. Plans are versioned; changing a plan price does not silently reprice existing accounts.

## Billing and ledger

Use Billing to preview a month before generating it. Finalized invoices are immutable; running billing again for the same period creates nothing and reports the accounts as already invoiced. Open a subscriber or service-account ledger to see debits, credits, opening balance, running balance, and closing balance.

## Payments

1. Receive Payment: search the subscriber, view the balance, enter the amount and method, preview the allocation, then post. Cash posts immediately; GCash and bank transfer park in the verification queue.
2. GCash Verification: open the queue, compare the proof, then approve or reject. A rejection requires a reason. A duplicate GCash reference is blocked.
3. A payment smaller than the balance leaves the invoice PARTIALLY_PAID; a payment larger than all balances holds the excess as unapplied credit.
4. Reversal undoes a posted payment without deleting it: the allocations, ledger, and audit trail are preserved, and the receipt is voided (its number is never reused).

## Collections

1. Open a collection area and assign a collector.
2. Create a batch with assigned service accounts.
3. Start the batch and later submit cash, non-cash, and uncollected totals.
4. Record remittance.
5. Reconcile the batch with an authorized user. A reconciliation with a difference must record a reason.
6. Close only after reconciliation.

A negative remittance difference is a shortage. A positive difference is an overage. A short or over remittance is never balanced away silently: a supervisor holding `collection.variance.approve` must record a resolution before the batch can be closed.

## Receivables and service control

Use Receivables to filter overdue accounts, view aging buckets, and inspect suspension candidates. A candidate list never suspends service automatically. An authorized user must record the reason and effective date. Reconnection requires a qualifying posted payment, optional technician assignment, scheduling, and completion. Each state change is kept in service history.

## Backup and restore

Only the Owner can create or verify backups. A verified backup contains a PostgreSQL archive, proof attachments, a manifest, and hashes. Restore only into an isolated target using `pnpm --filter @bcis/database db:restore`; follow [deployment-phase9.md](deployment-phase9.md).

## Troubleshooting

- Check `/health/db` for database connectivity and pending migrations.
- Confirm `BCIS_API_URL` points to the API host.
- Confirm client machines can reach the API port through the LAN firewall.
- Do not expose PostgreSQL to client machines.
- If a report is empty, verify its date and role filters.
- If restore tools are not found, set `POSTGRES_BIN_DIR` to the PostgreSQL `bin` directory.
