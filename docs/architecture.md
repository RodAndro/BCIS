# Architecture

Why the system is shaped the way it is. Decisions here are recorded with their
consequences, including the ones that cost performance, so a later reader can tell a
deliberate trade-off from an accident.

---

## 1. The required data path

```
React Renderer  (no Node, no DB, no network credentials)
      ↓  typed, Zod-validated IPC contract
Preload         (contextBridge, exact channel allowlist)
      ↓
Electron Main   (holds the session token in memory, calls HTTP)
      ↓  HTTPS/HTTP + Bearer token over LAN
Fastify API     (authn → authz → Zod validation → service)
      ↓
Domain / Service Layer  (business rules + transaction boundary)
      ↓
Drizzle ORM  →  PostgreSQL
```

This path is the security model, not a suggestion. Every arrow is a place where a boundary
is enforced, and each has a concrete mechanism:

| Boundary                 | Mechanism                                                                                                                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Renderer → Preload       | `contextBridge.exposeInMainWorld('bcis', …)` publishes a fixed set of named functions. `ipcRenderer` itself is never exposed, and there is no generic `invoke(channel, payload)` passthrough.                                        |
| Renderer ↔ Node          | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. The renderer has no `require`, no `process`, no filesystem.                                                                                                     |
| Renderer → outside world | Production CSP has `connect-src 'none'`. The renderer never makes a network request; all traffic goes through the main process.                                                                                                      |
| Preload → Main           | `ipcMain.handle` for each declared channel. Payloads are validated in the main process with Zod — a user can open DevTools and call any exposed function with any argument, so the renderer is not trusted.                          |
| Main → API               | The session token lives in main-process memory only, never in the renderer where `localStorage` is readable from DevTools. Every call has a timeout, so an unreachable API becomes a visible error instead of a hung cashier screen. |
| API → Domain             | `requirePermission(...)` on every protected route; a route declaring no permission fails loudly at startup. Zod validates body, query, and params.                                                                                   |
| Domain → Database        | Business rules and the transaction boundary live in `*.service.ts`; the repository layer only builds queries.                                                                                                                        |

`apps/desktop/src/shared/ipc.ts` is the single declaration of the IPC surface. Adding a
channel means editing that file, then the main handler, then the preload — three places that
the type checker keeps in agreement.

### Navigation and window policy

The main process refuses to navigate away from the application shell, refuses every popup
(`setWindowOpenHandler` → `deny`), blocks webview attachment, and opens genuine `https://`
links in the system browser only. A blocked navigation is logged as
`[security] blocked <action> to <url>` on stderr, because it is a security event and must be
visible outside the page it came from.

### The two CSPs, and why there are two

- **Production**: a strict policy injected into the HTML at build time by a plugin in
  `apps/desktop/electron.vite.config.ts`. It is a `<meta http-equiv>` tag rather than a
  response header because in production the renderer loads from `file://`, where Electron's
  `webRequest.onHeadersReceived` does not reliably fire — a header-based policy would
  silently not apply, which is the worst kind of security control. It is inserted
  immediately after `<meta charset>` because Vite injects the entry script at the end of
  `<head>`, and a meta CSP only governs content that follows it.
- **Development**: a looser header policy in `apps/desktop/src/main/index.ts`, needed
  because Vite injects the React Refresh preamble inline and HMR needs a websocket. Applied
  only when `ELECTRON_RENDERER_URL` is set, so the two never conflict.

---

## 2. Locked decisions

### 2.1 Money is `BIGINT` integer centavos

Every money column is named `*_centavos` and is a `BIGINT`. Every value in TypeScript is a
branded integer.

**Why.** IEEE-754 binary floating point cannot represent most decimal fractions exactly:
`1 / 10 + 2 / 10` is not `3 / 10`. In a billing system that error compounds across
allocation, aging, and remittance until a balance is off by a centavo and cannot be
reconciled. Integers are closed under addition, so a ledger built from integer centavos sums
to exactly zero when everything is paid.

**The two branded types.** `Centavos` is non-negative — invoice totals, payment amounts,
fees — and its constructor rejects negatives. `SignedCentavos` may be negative — account
balances, differences, variances. Keeping them distinct means the compiler stops an account
balance being assigned into an invoice total.

**The one dangerous conversion.** node-postgres returns `BIGINT` (OID 20) as a **string** by
default. Left alone, `"99900" + 100` would silently produce `"99900100"`. `database/src/client.ts`
installs an int8 type parser, and that is only safe because `MAX_CENTAVOS` (≈ ₱10 billion) is
four orders of magnitude below `Number.MAX_SAFE_INTEGER`. A future column needing true 64-bit
integers must **not** use int8 — use `numeric` or text and read it as a string.

**Where it is enforced.** `packages/shared/src/money.ts` (construction, arithmetic,
basis-point rates, integer formatting), `packages/validation/src/primitives.ts` (Zod), the
`BIGINT` column types, and an ESLint rule that rejects non-integer numeric literals outside
test files.

**No function converts `Centavos` back to a peso `number`.** Exposing one would invite float
money back into the codebase. Screens format to a string; arithmetic stays in centavos.

### 2.2 The ledger is an append-only projection

`ledger_entries` rows are written **inside the same transaction** as the event that causes
them (invoice finalize → debit; payment post → credit; adjustment; reversal). Each carries
`(source_type, source_id)` behind a unique index, which makes posting **idempotent**:
replaying the same source document cannot double-post.

The running balance is computed with a window function —
`SUM(amount) OVER (PARTITION BY service_account_id ORDER BY entry_date, id)` — and is
**never stored**.

```sql
CREATE UNIQUE INDEX uq_ledger_source
  ON ledger_entries (source_type, source_id, entry_type);
```

**Why not computed-on-read from invoices and payments.** The ledger is the authoritative
derivation; reading balances out of two mutable tables would make the balance depend on
whatever those tables currently say, which is exactly the property the system must not have.

**Why not a typed-in balance column.** §6 INV-3 forbids it. A stored balance is a second
source of truth that can disagree with the entries.

**Why this is fast enough.** One million entries with the right index is a few milliseconds
per account.

**Sign convention.** Debits increase what the customer owes; credits reduce it. A positive
running balance means the customer owes money; a negative one means the customer has credit.
This single convention determines how every screen and report reads, so it is also written
into `CLAUDE.md`.

### 2.3 Invoice `paid_centavos` / `balance_centavos` are caches, not the truth

The truth is `payment_allocations`. The cached columns exist so that "list 60 overdue
accounts" and AR aging do not have to aggregate allocations across 500,000 payments on every
page load. They are updated inside the payment transaction.

A `verifyIntegrity()` routine rebuilds them from allocations and proves they match (INV-4),
exposed as an admin screen. This is what makes the cache defensible: it is a cache precisely
because it can be rebuilt and checked from the source.

### 2.4 Document numbering uses a row-locked table, not a Postgres `SEQUENCE`

`document_sequences(scope, period_year, prefix, current_value)` is read with
`SELECT … FOR UPDATE` inside the business transaction. This gives gapless numbering per
scope per year (`INV-2026-000123`, `RCPT-2026-000456`).

**Why.** The specification requires **voided receipt numbers to be reserved and never
reused**. A native `SEQUENCE` is faster but leaves gaps on rollback.

**Trade-off accepted.** Numbering is a serialization point — one short row lock per document.
For financial documents that is the correct behaviour. Note also the scope decision (A11):
numbering is **per year, global**, not per workstation; per-workstation numbering would create
duplicates across the three PCs.

### 2.5 `OVERDUE` is derived, not stored

Stored status is the lifecycle: `DRAFT | UNPAID | PARTIALLY_PAID | PAID | VOID | CREDITED`.
"Overdue" is `balance_centavos > 0 AND due_date < today`.

**Why.** It is a time-dependent property. A stored flag would require a nightly job and would
be _wrong between job runs_ — an account suspended a day late is a support call, and an
account reported as overdue the morning after it was paid is worse.

The API returns a computed `displayStatus` so the UI still shows all seven states named in
the specification.

### 2.6 Reports generate on the API, not in the renderer

ExcelJS and pdfmake run server-side against an indexed query and the API streams the buffer
back; the Electron main process writes it with a native save dialog.

**Why.** §21 targets 500,000 invoices and 1,000,000 ledger entries. Generating those in the
renderer would pull bulk financial data into the window process and freeze the workstation.
It also keeps the renderer from ever holding bulk financial data at all.

### 2.7 Attachments live on disk outside the database

`payment_proofs` stores a relative path, a SHA-256 hash, a MIME type validated by **magic
bytes** (not the file extension), a byte size, and the uploader. Files land under
`data/proofs/<yyyy>/<mm>/<uuid>.<ext>`.

**Why.** The renderer requests bytes through an authorized streaming endpoint and **never
receives a filesystem path** it could use to read arbitrary files. The database is not a
blob store, and backups stay small.

### 2.8 Development database: two equivalent paths

`docker-compose.yml` provides `postgres:17-alpine` with a named volume and a healthcheck.
`scripts/pg.ps1` runs the same PostgreSQL major version from portable binaries under
`.runtime/`, for workstations without Docker.

**Why both are kept.** The repository should be reproducible on a machine with Docker, and
the office workstations do not have it. Both must stay schema-compatible — the schema lives
only in `database/migrations/`, so the server is not the source of truth for anything.

The portable cluster binds to `127.0.0.1` on port **5433** and never to the LAN. Port 5433
rather than 5432 avoids colliding with a PostgreSQL service someone may already have
installed.

### 2.9 Time is Asia/Manila, explicitly

Instants are `TIMESTAMPTZ` (UTC). Calendar dates — due dates, billing periods, report day
boundaries — are `DATE` columns computed in `Asia/Manila`.

**Why.** A payment taken at 07:00 on 2 September in Bukidnon is 23:00 on 1 September in UTC.
Using the server's local date puts it in the wrong day's collection report and the cash count
stops reconciling.

**Why a fixed offset rather than the ICU timezone database.** The Philippines has been UTC+8
with no daylight saving since 1978 and has no scheduled change. A fixed offset keeps calendar
arithmetic exact and dependency-free instead of relying on the runtime's timezone data being
present and correct on all three office PCs. The same reasoning applies to hand-rolled
currency and date formatting: a receipt must be byte-identical on every workstation
regardless of installed locale data.

---

## 3. Module map

| #   | Module                | Responsibility                                                               | Status                                |
| --- | --------------------- | ---------------------------------------------------------------------------- | ------------------------------------- |
| M1  | **Platform**          | Config, env validation, DB pool, migrations, error handling, logging, health | **Phase 1 — built**                   |
| M2  | **Identity & Access** | Users, roles, permissions, login, sessions, lock, RBAC guard                 | Phase 2                               |
| M3  | **Subscribers**       | Subscriber records, addresses, contacts, status lifecycle                    | Phase 3                               |
| M4  | **Services**          | Service types, plans, service accounts, service-event history                | Phase 3                               |
| M5  | **Billing**           | Cycles, invoice generation, numbering, states, adjustments, void             | Phase 4                               |
| M6  | **Ledger**            | Append-only entries, running balance, statement of account                   | Phase 4 (debit) / 5 (credit)          |
| M7  | **Payments**          | Capture, allocation, receipts, GCash verification, reversal                  | Phase 5                               |
| M8  | **Collections**       | Areas, routes, assignments, batches, route sheets, remittance                | Phase 6                               |
| M9  | **Receivables**       | Outstanding, overdue, aging, suspension, reconnection                        | Phase 7                               |
| M10 | **Reporting**         | Dashboard KPIs, 17 reports, PDF/XLSX                                         | Phase 8                               |
| M11 | **Audit & Admin**     | Audit log, settings, backup/restore history, integrity checks                | Phase 2, then written by every module |

### Dependency order

```
M1 Platform
 ├── M2 Identity & Access
 │    ├── M3 Subscribers
 │    │    └── M4 Services
 │    │         └── M5 Billing ──> M6 Ledger
 │    │              └── M7 Payments ──> M6 Ledger
 │    │                   └── M8 Collections
 │    │                        └── M9 Receivables
 │    └── M11 Audit & Admin   (infrastructure — needed from M2 onward)
 └── M10 Reporting  (depends on M5–M9 being complete)
```

Dependencies worth stating explicitly:

- **M5 cannot start without M4** — invoices bill service accounts, and the plan price must be
  snapshotted at generation time.
- **M7 cannot start without M5 + M6** — allocation targets invoices and writes ledger credits.
- **M8 cannot start without M3 + M7** — routes group service accounts; batches contain
  payments.
- **M9 cannot start without M5 + M7** — aging is computed from invoice balances and payment
  dates.
- **M11 is infrastructure, not a phase.** The audit log and `application_settings` tables are
  built in Phase 2, and every later module writes to them.
- **M6 is split across two phases:** the table, append/verify primitives, and statement view
  land in Phase 4 with the billing debit; payment credits land in Phase 5.

---

## 4. Package boundaries

| Package               | May depend on                 | Must never depend on                          |
| --------------------- | ----------------------------- | --------------------------------------------- |
| `packages/shared`     | nothing                       | everything                                    |
| `packages/validation` | `shared`, `zod`               | `database`, Fastify, React                    |
| `packages/domain`     | `shared`                      | `database`, Fastify, React, Electron, any I/O |
| `database`            | `shared`, `drizzle-orm`, `pg` | Fastify, React, Electron                      |
| `apps/api`            | all of the above              | React, Electron                               |
| `apps/desktop`        | `shared`, `validation`        | `database`                                    |

`packages/domain` being pure is what makes the rules quotable: a reviewer can open
`packages/domain/src/allocation.ts` and read the AT-04 oldest-first rule in about twenty lines
with no imports from Fastify or Drizzle. Rules that need the database live in
`apps/api/src/modules/<module>/*.service.ts`, which calls into this package for the
calculation.

The renderer importing `database` is not a style violation — it is prevented structurally by
pnpm's isolated `node_modules`, because the desktop app does not declare it as a dependency.

---

## 5. Error contract

Every failure leaving the API has one shape:

```json
{
  "error": {
    "code": "DUPLICATE_GCASH_REFERENCE",
    "message": "This GCash reference has already been recorded.",
    "details": { "field": "referenceNumber" },
    "requestId": "req-7"
  }
}
```

`code` is stable and machine-readable (`@bcis/shared`), and the desktop client switches on it.
`message` is presentational and never contains a SQLSTATE, a constraint name, a stack trace, a
file path, or the connection string — all of which go to Pino, correlated by the same
`requestId`.

The handler classifies in this order:

1. **`AppError`** — raised deliberately, already safe to show.
2. **Fastify schema validation** — mapped to `422` with the offending field names.
3. **PostgreSQL SQLSTATE**, detected by shape (an error carrying `severity`, `routine`, or
   `constraint`) rather than by `code` alone, because Fastify's own errors also have a `code`
   with values like `FST_ERR_VALIDATION`. Unmapped constraint violations become `409`
   (`23xxx`) or `503`.
4. **Anything else is a bug.** Logged in full; the user gets a generic message and the
   `requestId` to quote.

That last branch is the important one: `internal_error` must never leak a file path. There is
an integration test that asserts exactly this.

---

## 6. Testing strategy

| Layer       | Runs against        | Covers                                                                                                           |
| ----------- | ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Unit        | in-process          | money arithmetic, date maths, allocation, variance, allocation guards                                            |
| Integration | **real PostgreSQL** | health, migration state, the error envelope, uniqueness and immutability enforced by the database                |
| E2E         | **real Electron**   | the app launches, the shell renders, the preload surface is exactly as declared, the renderer has no Node access |

Integration tests are never mocked. The guarantees that matter most — the duplicate-invoice
index, the receipt row lock, the audit-log trigger — live in PostgreSQL, and a mock would let
all of them pass while being absent from the real schema. The whole value of AT-11 is that it
runs against the same engine the office uses.

Integration files run **serially** (`fileParallelism: false`): they share one database and
create financial documents with unique numbers, so parallel files would make failures depend
on scheduling.

`tests/integration/setup.ts` repoints `DATABASE_URL` at `TEST_DATABASE_URL` before any test
imports the app, because `apps/api/src/config/env.ts` reads `process.env` once at module load.
It refuses to run if `TEST_DATABASE_URL` is unset or equals `DATABASE_URL`.

---

## 7. What is deliberately deferred

- **Routing in the renderer.** Phase 1 has one screen and no router. Routes and permission
  guards are the same piece of work, so adding a router now would mean either writing guards
  with nothing to guard or writing them twice.
- **A `db:seed` script.** Deterministic demo data is a Phase 3 deliverable (decision A16).
  Shipping a seed stub now would be documented configuration that nothing consumes.
- **The `test` and `db:*` tasks in `turbo.json`.** See `CLAUDE.md` §8 — database-touching work
  must not fan out per package.
- **The response-envelope helpers in `apps/api/src/shared/`.** They live in
  `packages/validation/src/http.ts` instead, so the API and the desktop client validate
  against the _same_ schema rather than two copies that drift.
