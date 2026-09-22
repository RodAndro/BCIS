# Phase 9 Operations and Deployment

## Architecture

- **PC 1: API/database server and Admin client**
  - Fastify API listens on the server LAN address, default port `4000`.
  - PostgreSQL listens only on the server host, not on the LAN.
  - The Admin Electron client may run on this machine, but still uses the API.
- **PC 2: Cashier client**
  - Electron only. It calls the API over LAN and never connects to PostgreSQL.
- **PC 3: Operations client**
  - Electron only. It calls the API over LAN and never connects to PostgreSQL.

Example addressing:

```text
Server/API: 192.168.1.10:4000
Admin:       BCIS_API_URL=http://192.168.1.10:4000
Cashier:     BCIS_API_URL=http://192.168.1.10:4000
Operations:  BCIS_API_URL=http://192.168.1.10:4000
```

Use a reserved DHCP lease or static address for the server. The firewall opens TCP `4000` only to the office LAN subnet. PostgreSQL port `5432`/`5433` remains blocked from client machines and binds to loopback or the server-only interface. For production, terminate TLS at the API host or a LAN reverse proxy and use an `https://` API URL.

## Startup

1. Start PostgreSQL on the server.
2. Set the server `.env` with the real database credential, LAN `API_HOST`, `BACKUP_ROOT`, and `PROOF_STORAGE_ROOT`.
3. Run `pnpm db:migrate`.
4. Start the API with `pnpm --filter @bcis/api start` or the approved service wrapper.
5. Check `http://192.168.1.10:4000/health/db` from the server and one client.
6. Start each Electron client with its `BCIS_API_URL` pointing to the server.

The clients never receive `DATABASE_URL`, PostgreSQL credentials, session-token storage, or filesystem paths. Only the API process reads the database.

## Backup workflow

The Owner calls `POST /backups` with the `backup.create` permission. The API:

1. Creates a PostgreSQL custom-format dump with `pg_dump`.
2. Copies `PROOF_STORAGE_ROOT` into the backup directory.
3. Writes a manifest containing attachment paths, byte sizes, and SHA-256 hashes.
4. Runs `pg_restore --list` against the archive.
5. Re-hashes every copied attachment.
6. Records `VERIFIED` only after all checks pass. Failures are recorded as `FAILED`.

Backup history is available through `GET /backups`. Keep the backup root on a separate disk or network share and rotate daily backups, weekly full backups, and monthly retained backups. Copy at least one verified backup off the server.

## Restore test procedure

Restore only into an isolated PostgreSQL database first. Never point `RESTORE_DATABASE_URL` at the live `DATABASE_URL`.

```powershell
$env:BACKUP_ARCHIVE = 'D:\BCIS-backups\<backup-id>\database.dump'
$env:RESTORE_DATABASE_URL = 'postgresql://bcis_restore:...@127.0.0.1:5433/bcis_restore'
$env:PRE_RESTORE_BACKUP_ROOT = 'D:\BCIS-backups\pre-restore'
pnpm --filter @bcis/database db:restore
pnpm --filter @bcis/database db:migrate
```

The command refuses an empty archive, verifies the archive listing, creates a pre-restore dump of the isolated target, restores with `pg_restore --clean --if-exists`, and prints the pre-restore snapshot path. Afterward:

1. Compare known subscriber, invoice, payment, ledger, and audit rows.
2. Run the database integrity checks and `pnpm db:check`.
3. Start a test API with the restored `RESTORE_DATABASE_URL`.
4. Verify `/health/db`, authentication, authorization, reports, and a subscriber statement.
5. Verify proof attachment hashes against the backup manifest.
6. Only after sign-off, schedule a maintenance window for production replacement.

A restore is not considered successful because `pg_restore` exited zero alone. Records, integrity checks, application reconnection, and attachment hashes must all pass.

## Hardening checklist

- Electron uses `contextIsolation`, `sandbox`, `nodeIntegration: false`, disabled webviews, blocked navigation, blocked popups, and CSP.
- Renderer code has no database, filesystem, network credential, or session-token access.
- Every API route declares authentication policy and protected routes declare server-side permissions.
- Zod validates API and IPC payloads; Drizzle parameterizes queries.
- Passwords, session tokens, authorization headers, and connection strings are redacted or excluded from logs.
- `.env` is ignored and `.env.example` contains placeholders only.
- Payment proof paths must remain relative to `PROOF_STORAGE_ROOT`; reject absolute paths, `..` segments, symlinks, unsupported MIME types, and files whose magic bytes do not match the declared type before storing metadata.
- Session tokens are opaque hashes in PostgreSQL; failed login lockout and revocation remain server-side.
- API error responses do not disclose SQLSTATE, constraint names, stacks, or connection strings.
- Audit, ledger, and posted allocation rows are append-only and database-protected.

## Performance and concurrency

The API owns pagination and aggregation. Client screens request bounded pages and do not load whole tables. Existing indexes cover invoice due dates, payment dates/methods, ledger account/date, audit timestamps, collection batch dates, and service-account filters. Before production sign-off, run `EXPLAIN (ANALYZE, BUFFERS)` for overdue, aging, reports, and statements against representative 20,000-subscriber / 500,000-invoice data.

Concurrency acceptance tests must run three authenticated clients concurrently: one reads a subscriber, one posts a payment, and one reads collection/report data. Verify unique receipt/invoice constraints, ledger balance reconciliation, transaction rollback on audit failure, and session isolation.
