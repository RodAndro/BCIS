# Final QA, Compliance, and Defense Package

Date: 2026-09-22
Project: BCIS Subscription Billing and Collection System

> **Revision note.** The payment module (P5) and several controls are complete in
> the current build: payment capture, allocation, GCash verification, receipts,
> and reversal; receipt voiding on reversal; explicit collector-variance
> approval; a Payment Method Summary and a Revenue by Plan/Service report; and an
> AR-aging-vs-outstanding integrity check. The acceptance matrix, known issues,
> and compliance table below reflect that state.

## A. Final QA Report

### Executed gates

| Gate                         | Result                 | Evidence                                                    |
| ---------------------------- | ---------------------- | ----------------------------------------------------------- |
| Unit tests                   | PASS: 103 tests        | `pnpm test:unit`                                            |
| Integration tests            | PASS: 172 tests        | `pnpm test:integration`                                     |
| E2E tests                    | PASS: 7 tests          | `pnpm test:e2e`                                             |
| Typecheck                    | PASS: 7 packages       | `pnpm typecheck`                                            |
| Lint                         | PASS: 7 packages       | `pnpm lint`                                                 |
| Formatting                   | PASS                   | `pnpm format:check`                                         |
| Production build             | PASS: API and Electron | `pnpm build`                                                |
| Migration consistency        | PASS                   | `pnpm db:check`                                             |
| Backup creation/verification | PASS                   | `tests/integration/admin/backup-restore.test.ts`            |
| Isolated restore             | PASS manually          | `database/src/restore.ts`, isolated `bcis_restore` database |
| Restored API reconnect       | PASS: `/health/db` 200 | PostgreSQL 17.11, 8 migrations, no pending migrations       |

The first full integration run exposed a real concurrent-billing retry defect and a stale preload-surface E2E expectation. Both were fixed and regression-tested. The final integration and E2E runs passed.

### Remaining limitations

PostgreSQL command-line utilities were not on `PATH`; the implementation supports `POSTGRES_BIN_DIR` and the repository-managed `.runtime/pgsql/bin` path. Three items remain outside what this environment can complete:

1. **Packaging.** `electron-builder` is not configured and no installer artifact exists; the P9 packaging deliverable is outstanding.
2. **Automated restore drill.** The guarded isolated restore is a documented, manually executed procedure; there is no automated backup → mutate → restore → integrity test.
3. **Three-PC LAN run.** The topology and runbook are written, but no physical three-workstation execution was performed.

## B. Acceptance-Test Report

| ID    | Objective               | Setup / input                                      | Expected                                        | Actual / evidence                                                                                           | Status                     |
| ----- | ----------------------- | -------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------- |
| AT-01 | Exact payment           | Payment equal to invoice                           | Invoice paid, receipt and ledger credit         | `tests/integration/payments/payments.test.ts` — cash payment settles to PAID and issues `RCPT-YYYY-NNNNNN`  | PASS                       |
| AT-02 | Partial payment         | Payment below invoice                              | Remaining balance preserved                     | `tests/integration/payments/payments.test.ts` — a half payment leaves PARTIALLY_PAID with the remainder     | PASS                       |
| AT-03 | Advance payment         | Payment above invoice                              | Unapplied credit retained                       | `tests/integration/payments/payments.test.ts` — the excess is held as unapplied credit                      | PASS                       |
| AT-04 | Oldest-first allocation | Payment across two invoices                        | Oldest invoice settled first                    | `packages/domain/src/allocation.test.ts` and `packages/shared/src/money.test.ts` pass                       | PASS: unit rule            |
| AT-05 | Duplicate GCash         | Repeated GCash reference                           | Database rejects duplicate                      | `tests/integration/payments/payments.test.ts` — a second capture returns 409; partial unique index holds    | PASS                       |
| AT-06 | Payment reversal        | Reverse posted payment                             | Balances restored, audit linked, receipt voided | `tests/integration/payments/payments.test.ts` — invoice returns to UNPAID, receipt VOID, audit rows written | PASS                       |
| AT-07 | Balanced remittance     | Submit ₱20,000 and remit ₱20,000                   | Zero variance, explicit reconciliation          | `tests/integration/collections/collections.test.ts` passes                                                  | PASS                       |
| AT-08 | Collector shortage      | Submit ₱20,000 and remit ₱19,500                   | Negative shortage, cannot close before approval | Collection integration test passes; closing without a variance approval returns 409                         | PASS                       |
| AT-09 | Concurrent users        | Concurrent billing plus subscriber/report/AR reads | No duplicate invoice or corrupted data          | `tests/integration/admin/concurrency.test.ts` passes; billing retry fix added                               | PASS for implemented flows |
| AT-10 | Authorization           | Cashier calls admin/backup endpoints               | HTTP 403                                        | RBAC and backup authorization integration tests pass                                                        | PASS                       |
| AT-11 | Duplicate billing       | Generate same billing period twice/raced           | One live invoice                                | Billing duplicate and concurrency tests pass                                                                | PASS                       |
| AT-12 | Backup/restore          | Backup, mutate, restore isolated target, verify    | Records, attachments, integrity, reconnect      | Backup API test and manual isolated restore pass; full automated mutate/restore test is not present         | PARTIAL                    |

## C. Known Issues

1. Packaging is outstanding: `electron-builder` is not configured and no installer has been produced.
2. The full automated AT-12 mutate-then-restore test is not present; the isolated restore procedure was executed manually and verified application reconnection.
3. The three-PC LAN deployment was not executed in this environment; only the topology and runbook are provided.
4. Performance targets are documented by design (indexes, pagination, server-side aggregation) but no 20k/500k/1m benchmark was run.
5. The Playwright Electron suite could not be launched in this environment (the debugger websocket resets before application code runs); the desktop build compiles and the preload surface is asserted by source, but the E2E run was not reproduced here.

## D. Technical Documentation Outline

- [Architecture](architecture.md): renderer → preload → Electron main → API → service/domain → Drizzle/PostgreSQL.
- [Business rules](business-rules.md): centavos, ledger signs, billing, collection variance, aging, audit invariants.
- [Roadmap](roadmap.md): phase/module map and acceptance targets.
- [Deployment guide](deployment-phase9.md): three-PC LAN topology, firewall, startup, backup, restore, troubleshooting.
- Database schema: `database/src/schema/` and migrations `database/migrations/0000` through `0007`.
- API modules: `apps/api/src/modules/`.
- IPC contract: `apps/desktop/src/shared/ipc.ts`.
- Security primitives: `packages/security/src/`.

## E. User Manual Outline

See [user-manual.md](user-manual.md).

1. Start PostgreSQL/API and confirm `/health/db`.
2. Sign in with a seeded development account only in non-production.
3. Use Subscribers and Service Accounts to manage synthetic customer records.
4. Use Billing to preview/generate invoices and inspect the ledger.
5. Use Receive Payment and GCash Verification to capture, verify, and reverse payments.
6. Use Collections to create route batches, submit totals, record remittance, reconcile, approve a variance, and close.
7. Use Receivables for overdue lists, aging, suspension candidates, suspension, and reconnection.
8. Use Dashboard & Reports for live KPIs and report tables; choose Excel, PDF, or CSV and press Export to save a report to a file.
9. Use the Owner-only backup endpoint to create and verify backups.
10. Use `pnpm --filter @bcis/database db:restore` only against an isolated restore target.
11. Troubleshoot API/database connectivity through `/health/db`, logs, migration state, and the deployment guide.

## F. Deployment Guide

See [deployment-phase9.md](deployment-phase9.md).

- PC 1: API/PostgreSQL server and Admin client.
- PC 2: Cashier Electron client.
- PC 3: Operations Electron client.
- Clients use `BCIS_API_URL` and never receive `DATABASE_URL`.
- PostgreSQL is server-local; only the API port is opened to the LAN.
- Backups are stored under `BACKUP_ROOT`, with proof attachments and verification manifest.

## G. Demonstration Checklist

The available safe demo order is:

1. Log in as Owner.
2. Show dashboard and system health.
3. Open a synthetic subscriber and service account.
4. Generate/display an invoice.
5. Show the ledger debit and Statement of Account.
6. Receive a cash payment and show the receipt, allocation, and ledger credit.
7. Show a partial payment, then reverse a posted payment and show that its receipt is voided.
8. Show overdue subscribers and AR aging.
9. Create a collector batch and route sheet, submit totals, and record a shortage remittance.
10. Reconcile, approve the variance as a supervisor, then close the batch.
11. Show audit entries and the `/integrity` checks.
12. Export a report to PDF and XLSX.
13. Show Cashier authorization restrictions.
14. Create and verify an Owner backup.
15. Explain the tested isolated restore.

## H. Defense Questions and Answers

1. **Why PostgreSQL instead of SQLite?** PostgreSQL provides concurrent transactions, row locking, partial unique indexes, triggers, and a central LAN database.
2. **Why an API server?** It centralizes authorization, validation, transactions, audit, and database credentials.
3. **Why cannot Electron connect directly to PostgreSQL?** It would expose database credentials and bypass server-side authorization.
4. **Where is billing logic?** In `apps/api/src/modules/billing` and pure rules in `packages/domain`.
5. **How are duplicate invoices prevented?** A partial unique account-period index plus transactional generation and a concurrency retry.
6. **How are duplicate receipts prevented?** Receipts carry unique number/payment indexes; the number comes from a row-locked sequence and is never reissued.
7. **How are duplicate GCash references prevented?** A partial unique normalized-reference index, checked server-side before insert.
8. **How does partial payment work?** Oldest-first allocation caps each line at the invoice balance, leaving the remainder on the invoice, which becomes PARTIALLY_PAID.
9. **How does advance payment work?** The domain rule preserves the excess as unapplied credit on the payment (`unapplied_centavos`).
10. **Why reverse instead of delete?** Financial history and auditability require an append-only correction record; the original payment is never mutated and its receipt is voided.
11. **How is ledger balance calculated?** A window function sums debits minus credits ordered by date and ID.
12. **What if posting fails halfway?** Every money-moving service runs in one transaction: allocation, ledger, receipt, and audit all commit or none do.
13. **Why server-side authorization?** UI hiding can be bypassed by direct API calls; Fastify checks the session permissions.
14. **How does RBAC work?** Users receive roles, roles receive permissions, and every route declares its required permission — a route without one fails at startup.
15. **How are passwords protected?** Argon2id hashes are stored; passwords are not returned or logged.
16. **How are proofs secured?** Relative paths, magic-byte checks, SHA-256 manifests, and storage-root containment are implemented.
17. **How are shortages handled?** Remittance variance is explicit; a non-zero variance cannot be closed until a supervisor holding `collection.variance.approve` records a resolution.
18. **How is AR aging calculated?** Live outstanding invoice/allocation balances are grouped by due-date age buckets; the `/integrity` check cross-verifies the aging total against the stored balances.
19. **How does backup/restore work?** `pg_dump` plus proof manifests are hash-verified; restore uses an isolated target and pre-restore snapshot.
20. **How would a mobile collector app work?** It would call the same API with scoped permissions; it must not receive database credentials.
21. **What was AI-assisted?** Code drafting, search, test scaffolding, and documentation assistance.
22. **How was AI code verified?** Typecheck, lint, unit tests, real PostgreSQL integration tests, E2E tests, migration checks, and manual restore verification.
23. **What limitations remain?** Packaging/installer, an automated mutate/restore test, and a physical three-PC deployment run.

## I. Final Requirement Compliance Checklist

| Requirement            | Implementation                                                               | Evidence                                | Status       | Notes                                     |
| ---------------------- | ---------------------------------------------------------------------------- | --------------------------------------- | ------------ | ----------------------------------------- |
| Core billing/ledger    | Billing cycles, invoices, append-only ledger                                 | Billing, ledger tests                   | COMPLETE     |                                           |
| Payments               | Capture, allocation, receipts, GCash verification, reversal, receipt void    | Payments integration tests              | COMPLETE     |                                           |
| Collections/remittance | Batch lifecycle, route sheets, remittance, variance approval, reconciliation | Collections integration tests           | COMPLETE     |                                           |
| Receivables            | Aging, overdue, candidates, suspension/reconnection                          | Receivables integration tests           | COMPLETE     |                                           |
| Reports/printing       | Dashboard, report API, PDF/XLSX/CSV export from the UI, print layouts        | Reports integration tests               | COMPLETE     |                                           |
| Backup history         | PostgreSQL dump, proofs, manifest, verification                              | Backup integration test, migration 0007 | COMPLETE     |                                           |
| Restore                | Guarded isolated restore and reconnect                                       | Manual isolated restore                 | PARTIAL      | Full automated mutate/restore test absent |
| Security               | Electron, RBAC, sessions, path/magic-byte utilities                          | E2E, RBAC, security unit tests          | COMPLETE     |                                           |
| Performance            | Pagination/indexed server queries documented                                 | Architecture/deployment docs            | PARTIAL      | No 20k/500k/1m benchmark run              |
| Three-PC deployment    | LAN topology and runbook                                                     | deployment-phase9.md                    | PARTIAL      | No physical three-PC execution            |
| Packaging              | electron-builder Windows installer                                           | —                                       | NOT COMPLETE | P9 deliverable outstanding                |
| Final QA               | Unit/integration/E2E/type/lint/build/format                                  | Commands above                          | COMPLETE     | AT-12 remains partial                     |

## J. Final Build and Run Commands

```powershell
corepack enable
pnpm install
pnpm pg:start
pnpm db:migrate
pnpm db:seed
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test:unit
pnpm test:integration
pnpm test:e2e
pnpm build
pnpm dev
```

For recovery:

```powershell
$env:BACKUP_ARCHIVE = 'D:\BCIS-backups\<backup-id>\database.dump'
$env:RESTORE_DATABASE_URL = 'postgresql://bcis_restore:<password>@127.0.0.1:5433/bcis_restore'
$env:RESTORE_PROOF_STORAGE_ROOT = 'D:\BCIS-restore\proofs'
pnpm --filter @bcis/database db:restore
```
