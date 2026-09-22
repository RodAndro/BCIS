# Defense Answers

These answers describe the current implementation honestly.

1. **Why PostgreSQL?** It supports the transactions, indexes, triggers, row locks, and central multi-client database required by a billing system.
2. **Why an API?** It keeps database credentials and authorization on one server boundary.
3. **Why no direct Electron database connection?** Direct access would expose credentials and bypass RBAC.
4. **Where is billing logic?** API billing services plus pure domain functions.
5. **Duplicate invoices?** A database partial unique index on service account and billing period, plus transactional generation and concurrent retry handling.
6. **Duplicate receipts?** The schema has unique receipt constraints, but receipt posting is not yet a finished payment feature.
7. **Duplicate GCash?** A normalized partial unique index exists, but there is no completed GCash capture endpoint yet.
8. **Partial and advance payment?** Pure allocation rules support both; payment posting is not yet wired.
9. **Why reverse instead of delete?** Posted financial history must remain auditable and immutable.
10. **Ledger balance?** SQL window functions compute debits minus credits in date/ID order.
11. **Half-failed transaction?** The service transaction rolls back its writes and audit record together.
12. **Server authorization?** Route policies are checked from database-backed session permissions, so direct API calls cannot bypass the UI.
13. **RBAC?** Users have roles; roles grant permissions; protected routes declare required permissions.
14. **Passwords?** Argon2id hashes only; plaintext passwords are not returned or logged.
15. **Payment proofs?** Storage paths are constrained, file signatures are checked, and backup manifests hash attachments.
16. **Collector shortages?** Remittance variance is stored explicitly; reconciliation and closure are separate authorized actions.
17. **AR aging?** Live outstanding balances are grouped by due-date age buckets on the server.
18. **Backup/restore?** `pg_dump` plus proof manifests are verified; restore requires an isolated target and pre-restore snapshot.
19. **Future mobile app?** It would use the same API and scoped permissions, never PostgreSQL credentials.
20. **AI assistance?** AI helped draft code and documentation; the repository was verified with tests, typecheck, lint, builds, real PostgreSQL tests, E2E tests, and manual restore verification.
21. **Remaining limitations?** Payment capture and its AT-01–AT-06 workflows are incomplete; full benchmark and physical three-PC tests remain.
