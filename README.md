# BCIS Subscription Billing and Collection System

Desktop billing and collection system for **Bukidnon Cable and Internet Services**.

This is a receivables engine with a desktop UI, not a CRUD form collection. The hard part is
not storing subscribers — it is guaranteeing that every peso owed is traceable to the
document that created it, every peso received to the document that recorded it, every peso
collected in the field to a collector and a remittance, and that no posted record can be
silently altered.

> **Status: Phases 1–9 are implemented, with payment capture remaining incomplete.** The
> subscriber, billing, collection, receivables, reporting, backup, security, and deployment
> surfaces are present and tested where documented. Payment capture, allocation, GCash
> verification, receipts, and reversal workflows remain outside the implemented API — see
> [What exists today](#what-exists-today) and the final QA report.

---

## Prerequisites

| Requirement | Version         | Notes                                                       |
| ----------- | --------------- | ----------------------------------------------------------- |
| Windows     | 10 or 11        | The application targets the three office workstations.      |
| Node.js     | **22 or newer** | `package.json` sets `engines.node >= 22`.                   |
| pnpm        | **11.25.0**     | Pinned via `packageManager`. Run `corepack enable` first.   |
| PostgreSQL  | **17**          | Either Docker Compose or the portable binaries — see below. |

`corepack enable` is what makes `pnpm` resolve to the pinned version rather than whatever is
on the machine.

---

## Setup from zero

### 1. Install dependencies

```bash
corepack enable
pnpm install
```

`pnpm install` also runs `scripts/ensure-electron.mjs`, which downloads the Electron runtime
binary if it is missing. Electron 44 does not declare a `postinstall` script, so without that
step the install reports success and `pnpm dev` then fails with a confusing missing-binary
error.

### 2. Start a PostgreSQL 17 server

Pick **one** of the two paths. They are the same PostgreSQL major version and the same
schema, because the schema lives only in `database/migrations/`.

**Option A — Docker (recommended, reproducible)**

```bash
docker compose up -d
```

Starts `postgres:17-alpine` bound to `127.0.0.1:5433` with a named volume and a healthcheck.

**Option B — portable binaries, no Docker**

Use this when Docker is unavailable on the workstation.

1. Download the **PostgreSQL 17 Windows x64 binaries** archive from the EnterpriseDB
   PostgreSQL binaries download page.
2. Extract it so that `bin/`, `lib/`, and `share/` sit under `.runtime/pgsql/`:

   ```
   .runtime/pgsql/bin/initdb.exe
   .runtime/pgsql/bin/pg_ctl.exe
   ```

3. Start the cluster:

   ```bash
   pnpm pg:start
   ```

   `pg:start` initialises the cluster on first run (under `.runtime/pgdata`, on port
   **5433** so it never collides with an installed PostgreSQL service), then creates the
   application role and the `bcis` and `bcis_test` databases. It is idempotent — running it
   again is safe.

`.runtime/` is gitignored. It holds the cluster data and the server log at
`.runtime/postgres.log`.

### 3. Create the environment file

```bash
cp .env.example .env
```

The defaults in `.env.example` already match both database paths above. `apps/api` validates
this file with Zod at startup and **refuses to start** on a missing or insecure value — which
is intentional: a server running against a database it cannot reach is discovered by a
cashier, not by an operator.

Integration tests read `TEST_DATABASE_URL` and refuse to run if it equals `DATABASE_URL`,
because they destroy the database they run against.

### 4. Apply migrations and seed

```bash
pnpm db:migrate
pnpm db:seed
```

`db:seed` creates the seven roles, the permission list, the default settings, the development
accounts listed under [Development accounts](#development-accounts), the plan catalog, three
collection areas, and a synthetic subscriber dataset. It is idempotent, and it refuses to run
against a production database.

### 5. Run it

```bash
pnpm dev
```

Starts the Fastify API (`http://127.0.0.1:4000`) and the Electron desktop client together.
The desktop shell opens on the **System Health** screen and should report both the API and
the database as healthy.

---

## Verifying the setup actually works

The health screen is not decoration — it is the evidence that the required architecture is
wired end to end:

```
renderer → preload → main process → HTTP → Fastify → PostgreSQL
```

Every value on it is fetched live through that chain. Press **Check now**, then stop the API
(Ctrl-C) and watch the panel change to _API unreachable_. Restart it and the panel recovers
without restarting Electron. A hardcoded "healthy" string would not do that.

The gate:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e
```

`pnpm test` needs PostgreSQL running. `pnpm test:e2e` builds the desktop app first, then
launches a real Electron process — expect a window to appear and close.

---

## Commands

| Command                                   | What it does                                           |
| ----------------------------------------- | ------------------------------------------------------ |
| `pnpm dev`                                | API + desktop together                                 |
| `pnpm build`                              | Build every package                                    |
| `pnpm typecheck`                          | TypeScript across the workspace                        |
| `pnpm lint`                               | ESLint across the workspace                            |
| `pnpm format`                             | Prettier, write                                        |
| `pnpm test`                               | Vitest: unit **and** integration projects              |
| `pnpm test:unit`                          | Unit project only — no database needed                 |
| `pnpm test:integration`                   | Integration project — real PostgreSQL                  |
| `pnpm test:e2e`                           | Playwright against a real Electron process             |
| `pnpm db:generate`                        | Generate a migration from the TypeScript schema        |
| `pnpm db:migrate`                         | Apply pending migrations                               |
| `pnpm db:seed`                            | Seed roles, permissions, settings and the dev accounts |
| `pnpm db:reset`                           | Drop and rebuild from migrations alone                 |
| `pnpm db:check`                           | Detect schema drift                                    |
| `pnpm pg:start` / `pg:stop` / `pg:status` | Manage the portable local cluster                      |

**On `turbo.json`:** it defines only `build`, `typecheck`, `lint`, and `dev`. Tests and
database tasks are deliberately **not** turbo tasks. Integration tests share one real
database and create financial documents with unique numbers, so running them per package in
parallel would make failures non-deterministic. They run once from the root.

`pnpm db:seed` is idempotent and deterministic (decision A16): access control, development
accounts, the plan catalog, synthetic subscribers and service accounts, and — since Phase 4 —
three billing cycles with their invoices and ledger entries. Re-running it adds nothing.

---

## Repository layout

```
apps/
  api/                Fastify 5
    src/app.ts        buildApp() — no side effects, so tests use app.inject()
    src/server.ts     the only file that binds a port
    src/config/       Zod-validated env, repo-root discovery
    src/plugins/      database pool, central error handler
    src/modules/      one folder per domain module
  desktop/            electron-vite
    src/main/         window, API client, IPC handlers, token vault (Phase 2)
    src/preload/      contextBridge — a fixed list of named functions
    src/renderer/     React 19 + Tailwind 4
    src/shared/ipc.ts the IPC contract, shared by main and renderer
packages/
  shared/             branded Centavos, money math, Asia/Manila dates,
                      permission codes, error codes
  validation/         Zod schemas shared by the API and the desktop client
  domain/             PURE business rules — no DB, no HTTP, no framework
database/
  migrations/         the source of schema truth
  src/schema/         Drizzle schema
  src/                pool, migration runner, reset
tests/
  unit/               (via packages/**/src/*.test.ts)
  integration/        API + real PostgreSQL
  e2e/                Playwright + real Electron
docs/                 architecture, business rules
```

---

## What exists today

**Working**

- `GET /health` (liveness, never touches the database) and `GET /health/db` (readiness —
  connectivity **and** migration state, because an API one migration behind passes a naive
  ping and then fails on first use).
- Money primitives: branded `Centavos` / `SignedCentavos`, integer-only arithmetic,
  basis-point rates, integer formatting and parsing. No float ever reaches a money column.
- Asia/Manila date helpers, including the fixed UTC+8 offset and business-month arithmetic.
- Shared Zod primitives and the success/error envelope.
- Pure domain rules: oldest-first payment allocation (AT-04), manual allocation, the
  over-settlement guard, and collector remittance variance (AT-07, AT-08) — each with unit
  tests.
- A migration pipeline with a baseline migration that enables `citext` and `pg_trgm`.
- The sandboxed Electron shell and the System Health screen.
- **Authentication and RBAC (P2).** Argon2id password hashing, opaque server-side sessions
  (only a SHA-256 is stored), failed-login lockout, session lock, and
  `requirePermission(...)` on every protected route. A route that declares no policy stops
  the server from starting, so "someone forgot to protect it" is a build failure rather than
  a discovery.
- **Administration (P2).** Users & Roles, the Audit Log, Settings, and My Account — with the
  audit log append-only, enforced by a database trigger rather than by convention.
- **Subscribers and services (P3).** Subscriber registration with multiple addresses and
  contacts, service accounts on versioned plans, and append-only service history. Plan prices
  are versioned rather than edited, so a later price change cannot alter what an account was
  billed at; moving an account onto a new rate is a separate, audited action.
- **Global subscriber search (P3).** A provider registry matches one query term across account
  number, name, contact, and address, and is designed for invoice, receipt, and GCash reference
  providers to be registered by Phases 4 and 5 without touching the search endpoint.

**Not fully built yet** — payment capture, allocation, GCash verification, receipts, and payment
reversal workflows (P5). Phase 10 documentation records this limitation rather than presenting
payment schema and pure allocation rules as a finished payment module.

The sidebar lists every planned screen with the phase that will build it. Nothing links to a
screen that does nothing.

---

## Development accounts

`pnpm db:seed` creates the roles, permissions, default settings, the development accounts, the
plan catalog, three collection areas, and a synthetic subscriber dataset — 50 subscribers and 63
service accounts across Internet, Cable, and Combo. It **refuses to run when
`NODE_ENV=production`**, which is why the passwords below are safe to document: they exist only
in development data, and a production database cannot acquire them by being migrated.

| Username              | Role                  | Status   | Password              |
| --------------------- | --------------------- | -------- | --------------------- |
| `admin`               | Owner / Super Admin   | Active   | `Admin@BCIS2026`      |
| `administrator`       | Administrator         | Active   | `Admin2@BCIS2026`     |
| `cashier`             | Cashier               | Active   | `Cashier@BCIS2026`    |
| `supervisor`          | Collection Supervisor | Active   | `Supervisor@BCIS2026` |
| `auditor`             | Accounting / Auditor  | Active   | `Auditor@BCIS2026`    |
| `technician.disabled` | Technician            | Disabled | `Technician@BCIS2026` |

Override any of them with the `SEED_*` variables in `.env` (see `.env.example`). Nothing else
does. The passwords are hashed with argon2id before they are stored — the plaintext exists only
in this table and in your `.env`.

The accounts are chosen to make the workflow demonstrable: the Owner can administer everything,
the Administrator owns the operational data, the Cashier is the subject of the authorization
test, the Collection Supervisor stands in as field staff for the demo routes, the Auditor has
read-heavy access including the audit log, and the disabled account proves that an inactive user
cannot sign in.

> **If you are running under a shell that has `NODE_ENV` set to `production`**, `pnpm db:seed`
> and `pnpm db:reset` will refuse to run. `process.loadEnvFile` never overwrites a variable that
> is already in the environment, so the real value wins over `.env`. Set it for the command:
> `$env:NODE_ENV='development'; pnpm db:seed`.

---

## Troubleshooting

**`pnpm dev` fails with a missing Electron binary.**
Re-run `node scripts/ensure-electron.mjs`. The download needs access to GitHub releases; a
proxy that blocks it is the usual cause.

**`DATABASE_URL is not set`.**
`.env` is missing. `cp .env.example .env`.

**The desktop shows _Database: unreachable_ but the API is up.**
`pnpm pg:status`. If the cluster is down, `pnpm pg:start`.

**The health panel says _This database is behind the code_.**
Run `pnpm db:migrate`. Reachable-but-unmigrated is reported as `degraded` on purpose.

**Integration tests refuse to start.**
`TEST_DATABASE_URL` must be set and must differ from `DATABASE_URL`. They drop and rebuild
the schema between runs, so pointing them at development data would destroy it.

**Port 5433 is already in use.**
Another PostgreSQL is running. Stop it, or change the port in `scripts/pg.ps1`,
`docker-compose.yml`, and `.env` together.

**A blocked navigation in the desktop log.**
Expected. The main process refuses to navigate away from the application shell and logs
`[security] blocked ...` to stderr.

---

## Design decisions worth knowing before reading the code

Four decisions were locked before implementation, and most of the code's shape follows from
them:

| Decision         | Choice                                                           | Why                                                                                                                                                                                      |
| ---------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Money            | `BIGINT` integer **centavos**                                    | IEEE-754 cannot represent most decimal fractions exactly, and the error compounds across allocation, aging, and remittance until a balance is off by a centavo and cannot be reconciled. |
| Monorepo         | pnpm workspaces + Turborepo                                      | Strict dependency isolation; the renderer structurally cannot import the database package.                                                                                               |
| Numbering        | Row-locked `document_sequences` table, not a Postgres `SEQUENCE` | Gapless per scope per year, and voided receipt numbers are reserved and never reused. A native sequence leaves gaps on rollback.                                                         |
| Advance payments | Unapplied credit on the service account                          | The excess is held as a real balance. No phantom future invoices.                                                                                                                        |

`docs/architecture.md` explains each of these in full, and `docs/business-rules.md` lists the
financial invariants the system must never violate.

---

## Documentation

- [`CLAUDE.md`](./CLAUDE.md) — working agreement: the non-negotiables, the ledger sign
  convention, layering rules, commit conventions
- [`docs/architecture.md`](./docs/architecture.md) — the data path and why each decision was
  made
- [`docs/business-rules.md`](./docs/business-rules.md) — financial invariants and the
  acceptance-test map
