# CLAUDE.md

Working agreement for this repository. Read this before changing anything.

**Project:** BCIS Subscription Billing and Collection System
**Organization:** Bukidnon Cable and Internet Services
**What it is:** a receivables engine with a desktop UI — not a CRUD form collection.
**Stack:** Electron 44 + React 19 + Fastify 5 + Drizzle ORM + PostgreSQL 17 + pnpm/Turborepo

---

## 1. The rules that are not open to interpretation

These are the properties the system is judged on. A change that weakens one of them is
wrong regardless of how much cleaner it looks.

1. **No floating-point money. Ever.** Every monetary value is an integer number of
   centavos. No `parseFloat`, no `toFixed`, no "temporary" float in a UI preview, no
   `numeric` column. Every money column is named `*_centavos` and is a `BIGINT`.
   Use `@bcis/shared` for all arithmetic.
2. **Posted financial records are immutable.** Correction happens by reversal, adjustment,
   or void. Never by `UPDATE` or `DELETE`. `ledger_entries`, `audit_logs`, and posted
   `payment_allocations` are protected by database triggers, not by convention.
3. **Balances are derived, never entered.** No user may type a ledger balance. The running
   balance is computed with a window function over `ledger_entries`.
4. **Duplicate prevention is enforced by the database.** A partial unique index, not only a
   service-layer check. Application checks race; indexes do not.
5. **Authorization is server-side.** Hiding a button is a usability measure, not a
   permission. Every protected route declares `requirePermission(...)`; a route that
   declares none fails loudly at startup.
6. **Every money-moving action writes an audit record in the same transaction.** If the
   audit write fails, the whole transaction fails.

---

## 2. The ledger sign convention

Written down because a single sign error makes every screen and report read wrong.

- **Debits increase what the customer owes** — invoices, debit adjustments.
- **Credits reduce it** — payments, credit adjustments, reversals.

Consequences that follow directly:

- A **positive** running balance means **the customer owes money**.
- A **negative** running balance means **the customer has credit**.

The balance is `SUM(debit_centavos) - SUM(credit_centavos)`, never a stored column.

Separately, for collector remittances, `variance = cashCollected - cashRemitted`, so a
**positive** variance is a **SHORTAGE** (the collector is holding money the company has not
received). This is asserted by tests in `packages/domain/src/variance.test.ts`; do not
"fix" it by flipping the operands.

---

## 3. Layering — where code is allowed to live

```
React renderer      no Node, no DB, no network credentials, no filesystem
    ↓  typed IPC contract (apps/desktop/src/shared/ipc.ts)
Preload             contextBridge exposing a fixed list of named functions
    ↓
Electron main       holds the session token in memory; the only thing that calls HTTP
    ↓  HTTP + Bearer token over the LAN
Fastify API         authn → authz → Zod validation → service
    ↓
Domain / service    business rules + transaction boundary
    ↓
Drizzle ORM  →  PostgreSQL
```

Hard rules:

- **`packages/domain` is pure.** No Fastify, no Drizzle, no React, no Electron, no I/O, no
  `Date.now()`. Pure functions only, so they are unit-testable and readable in isolation.
  `packages/domain/src/allocation.ts` states the AT-04 oldest-first rule in a page of code
  with no infrastructure in the way — that file is the one to quote.
- **Business logic does not live in a React component.** It lives in `packages/domain` if
  pure, or in a module's `*.service.ts` if it needs the database.
- **Only `apps/api` may import `@bcis/database`.** The renderer must never see it.
- **The renderer never receives a secret, a token, or a filesystem path.**
- **Never expose `ipcRenderer` or a generic `invoke(channel, payload)`** through the
  preload. That turns the whole IPC surface into an attack surface. Add named functions.

Module internal convention — keep the rules in the service, the SQL in the repository:

```
apps/api/src/modules/payments/
├── payments.routes.ts        HTTP surface + requirePermission() + Zod
├── payments.service.ts       business rules + transaction boundary
├── payments.repository.ts    Drizzle queries only
├── payments.mapper.ts        row → DTO
└── payments.audit.ts         audit descriptors for this module
```

---

## 4. Time and dates

- Instants are stored as `TIMESTAMPTZ` (UTC).
- Calendar dates used for billing — due dates, billing periods, report day boundaries — are
  `DATE` columns computed in **Asia/Manila**.
- **Every "which day is this?" question goes through `@bcis/shared/time`.** A payment taken
  at 07:00 in Bukidnon is 23:00 the previous day in UTC; using the server's local date puts
  it in the wrong day's collection report and the cash count stops reconciling.
- Asia/Manila is a fixed UTC+8 with no daylight saving. That is deliberate and is not a
  missing feature.

---

## 5. Errors and logging

- Every failure leaving the API has one shape:
  `{ "error": { "code": "...", "message": "...", "details"?, "requestId": "..." } }`.
- `code` is stable and machine-readable (`@bcis/shared/errors`); the client switches on it.
- `message` is for a human. It must never contain a SQLSTATE, a constraint name, a stack
  trace, or a connection string. Those go to Pino, correlated by `requestId`.
- A duplicate GCash reference must read
  _"This GCash reference has already been recorded."_ — not "PostgreSQL error 23505".
- Pino redacts `authorization`, `cookie`, `password*`, `token*`, `sessionToken` at the
  logger, not at the call site.

---

## 6. Configuration

- `.env` is gitignored; `.env.example` is committed with placeholders.
- `pnpm db:migrate` and the API read `DATABASE_URL`; integration tests read
  `TEST_DATABASE_URL` and refuse to start if it equals `DATABASE_URL`.
- Configuration is validated with Zod at startup and the process **refuses to start** on a
  missing or insecure value. A server that starts in a broken state is worse than one that
  does not start, because the broken state is discovered by a cashier.
- Never read `process.env` outside `apps/api/src/config/env.ts` and the desktop main
  process's `repo-env.ts`.

---

## 7. Schema changes

- Schema is authored in TypeScript in `database/src/schema/`, migrations are generated with
  `pnpm db:generate`, and **only SQL files in `database/migrations/` are the source of
  truth**. Nobody edits a table by hand in psql.
- `pnpm db:reset` must always reproduce a working schema from migrations alone. If it does
  not, the migrations are wrong.
- Do not write a seed that uses unseeded randomness. Demo data must be reproducible
  (decision A16), and ESLint rejects `Math.random` outside a test.

---

## 8. Commands

```bash
pnpm pg:start          # start the local PostgreSQL 17 cluster (port 5433)
pnpm db:migrate        # apply migrations
pnpm dev               # API + desktop together (turbo)
pnpm typecheck         # turbo run typecheck
pnpm lint              # turbo run lint
pnpm test              # vitest: unit + integration (needs PostgreSQL running)
pnpm test:unit         # unit project only — no database needed
pnpm test:e2e          # builds the desktop app, then launches real Electron
pnpm format            # prettier --write .
```

`turbo.json` deliberately defines only `build`, `typecheck`, `lint`, and `dev`. Tests and
database tasks are **not** turbo tasks: integration tests share one real database and
create financial documents with unique numbers, so fanning them out per package would make
failures non-deterministic. They run once from the root.

---

## 9. Testing expectations

- Integration tests run against a **real PostgreSQL**, never a mock. The guarantees that
  matter most — the duplicate-invoice index, the receipt row lock, the audit-log trigger —
  live in the database, and a mock would let all of them pass while being absent.
- Every financial rule gets a unit test in `packages/domain` **before** it is wired to HTTP.
- When you find a bug, first write the test that fails because of it.
- `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e` is the gate. All four must be
  green before a phase is called done.

---

## 10. Commit conventions

Conventional Commits, imperative mood, lower-case, no trailing period.

```
<type>(<scope>): <summary>
```

**Types:** `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `chore`, `build`, `ci`, `revert`

**Scopes:** `repo`, `api`, `desktop`, `database`, `shared`, `validation`, `domain`, `tests`,
`docs`

Examples:

```
feat(payments): allocate a payment oldest-first across open invoices
fix(database): read int8 columns as numbers so centavos stop concatenating
docs(architecture): record why document numbering uses a row-locked table
```

One logical change per commit. A schema change and the service code that depends on it may
share a commit; two unrelated fixes may not.

---

## 11. Where the project is

**Phase 1 (Foundation) is complete.** The toolchain, the database connection, the migration
pipeline, the error contract, and the desktop shell are in place and verified.

What exists: `/health` and `/health/db`, the money and date primitives, shared Zod schemas,
the pure allocation and remittance-variance rules, and a System Health screen that reads
live status through the real renderer → preload → main → HTTP → Fastify → PostgreSQL chain.

What does **not** exist yet: authentication, subscribers, service plans, invoices, payments,
collections, receivables, reports, backup. The sidebar lists each of those with the phase
that will build it rather than linking to a screen that does nothing.

**No phase beyond Phase 1 has been started, and none should be started without approval.**
Ambiguities A1–A16 in the roadmap are unresolved by design; the phase that needs one asks
for the decision before proceeding.
