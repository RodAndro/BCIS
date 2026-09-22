# BCIS User Manual

This manual describes the implemented screens. Payment capture, GCash verification, receipts, and payment reversal are not yet available in the current build.

## Login

Start the API and desktop client. Sign in with the account created for your role. Lock the session before leaving a workstation. Failed sign-ins are rate-limited and can lock the account temporarily.

## Dashboard and reports

Open Dashboard & Reports to view live receivables, overdue totals, billing/collection values, and report tables. Choose a report, then use the API export action for PDF, XLSX, or CSV. Values come from the server database.

## Subscribers and service accounts

Use Subscribers to register a synthetic subscriber, add addresses and contacts, then create a service account. Plans are versioned; changing a plan price does not silently reprice existing accounts.

## Billing and ledger

Use Billing to preview a month before generating it. Finalized invoices are immutable. Open a subscriber or service-account ledger to see debits, credits, opening balance, running balance, and closing balance.

## Collections

1. Open a collection area and assign a collector.
2. Create a batch with assigned service accounts.
3. Start the batch and later submit cash, non-cash, and uncollected totals.
4. Record remittance.
5. Reconcile the batch with an authorized user.
6. Close only after reconciliation.

A negative remittance difference is a shortage. A positive difference is an overage.

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
