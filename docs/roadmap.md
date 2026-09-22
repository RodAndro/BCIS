# BCIS Subscription Billing & Collection System — Implementation Roadmap

**Organization:** Bukidnon Cable and Internet Services
**Working directory:** `C:\Users\Rodan\BCIS`
**Repository:** `main` — Phase 1 complete and committed
**Status:** Phase 1 delivered and verified. Phase 2 not started.

This roadmap is the response to the master prompt's first task (§41). It is the authoritative
plan of record for this project, and it supersedes the earlier
`~/.commandcode/plans/bcis-roadmap.md`, which is kept only as a historical original.

---

## Amendment log

An audit of the master prompt against the original roadmap found fourteen gaps. None invalidated
Phase 1, and none required rewriting completed work. They are applied below and listed here so
they are visible during review.

| #   | Amendment                                                                                                                                                                                                  | Where         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| A1  | GCash verification fields were absent from the schema. Added `sender_name`, `sender_mobile`, `verified_by`, `verified_at`, `rejection_reason`, and the verification state machine.                         | §5.6, §5.11   |
| A2  | Packaging had no owning phase. Made `electron-builder` an explicit P9 deliverable.                                                                                                                         | §2.3, §10     |
| B1  | The demo seed was scheduled at P3, but §32's dataset needs invoices, payments, reversals and suspensions. Made seeding incremental across P3 → P7, and recorded §32's quantities as the acceptance target. | §10, §15      |
| C1  | The 17 required reports were never enumerated. Transcribed with the export rule.                                                                                                                           | §10 (P8), §16 |
| C2  | The named screens and layouts in §20 were absent. Attached each to its phase.                                                                                                                              | §16           |
| C3  | The mandated stack was presented as available when most of it is not installed. Reframed as a target stack with an owning phase per library.                                                               | §2.3          |
| D1  | No CHECK constraints were promised for money or status. Policy now stated.                                                                                                                                 | §5.0          |
| D2  | `tests/unit/` diverges from §33 without explanation. Colocation rationale now recorded.                                                                                                                    | §9            |
| D3  | The 12-section response format of §34 is now a standing commitment.                                                                                                                                        | `CLAUDE.md`   |
| D4  | §29 mentions `.claude/`; this project uses `.commandcode/`. Recorded.                                                                                                                                      | `CLAUDE.md`   |
| E1  | AT-02 read "₹499" (rupee) where the specification says "₱499". Corrected.                                                                                                                                  | §8            |
| E2  | Performance targets cited three of §21's four figures. Completed.                                                                                                                                          | §9.1          |
| F1  | "routes" (§12) has no entity and §22 lists none. Recorded as a P6 decision rather than left implicit.                                                                                                      | §11 (A17)     |
| F2  | `OVERDUE` was unverifiable because §26 has no test for it. Made it a P4 exit criterion.                                                                                                                    | §10 (P4)      |

---

## 0. Context

The master prompt is the authoritative specification. It was written for a greenfield project, and
the roadmap was built from it before any code existed. Phase 1 has since been implemented,
verified, and committed.

Nothing in the specification conflicts with the four architectural decisions taken in §2. The
audit confirmed this explicitly rather than assuming it: §5 permits integer centavos, §3 and §33
both permit adjusting tooling and structure, §10 supports advance payments, and §26 AT-03
deliberately leaves the advance-payment policy to the implementer.

---

## 1. Requirement Analysis

### 1.1 What this system is

A **receivables engine with a desktop UI**, not a CRUD form collection. The hard part is not
storing subscribers — it is guaranteeing that:

- every peso owed is traceable to a document that created it (invoice, adjustment);
- every peso received is traceable to a document that recorded it (receipt, payment);
- every peso collected in the field is traceable to a collector and a remittance;
- and no posted record can be silently altered.

Everything else — subscriber screens, reports, dashboards — is a view over that spine.

### 1.2 Requirement clusters

| Cluster                       | Contents                                                                                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Master data**            | Users, roles, permissions, subscribers, addresses, contacts, service types, plans, service accounts, collection areas, routes, collector assignments, settings |
| **B. Revenue cycle**          | Billing cycles → invoice generation → finalization → payment capture → allocation → receipt → reversal → ledger                                                |
| **C. Field collection cycle** | Route sheet → batch → field payments → submission → remittance → reconciliation → shortage/overage resolution → close                                          |
| **D. Receivables monitoring** | Outstanding, aging buckets, delinquency, suspension candidates, suspension, reconnection                                                                       |
| **E. Control layer**          | RBAC, server-side authorization, audit log, structured logging, backup/restore, attachment safety                                                              |
| **F. Output layer**           | Dashboard KPIs, 17 reports, PDF/XLSX export, printing                                                                                                          |

### 1.3 Non-negotiable properties

1. **No float money.** Not once, not in a UI preview, not in a "temporary" calculation.
2. **Posted financial records are immutable.** Correction happens by reversal, adjustment, or void.
3. **Balances are derived, never typed in.** No user may enter a ledger balance.
4. **Duplicate prevention is enforced by the database**, not only by application checks.
5. **Authorization is server-side.** A hidden button is not a permission.
6. **Every money-moving action produces an audit record** in the same transaction.
7. **A multi-step financial operation either fully succeeds or fully rolls back.** A payment is
   never partially posted.

---

## 2. Architecture & Locked Decisions

### 2.1 Required data path

```
PC 1 — Owner/Admin Desktop
             \
PC 2 — Cashier Desktop ---- LAN ----> Fastify API ----> PostgreSQL
             /
PC 3 — Operations Desktop
```

```
React Renderer  (no Node, no DB, no network credentials)
      ↓  typed, Zod-validated IPC contract
Preload         (contextBridge, exact channel allowlist)
      ↓
Electron Main   (holds session token in memory, calls HTTP)
      ↓  HTTP + Bearer token over LAN
Fastify API     (authn → authz → Zod validation → service)
      ↓
Domain / Service Layer  (business rules + transaction boundary)
      ↓
Drizzle ORM  →  PostgreSQL
```

Enforced by `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, no remote
module, a preload exposing only named functions, and a CSP in the renderer.

### 2.2 Key architectural choices

**The ledger is an append-only projection — not computed on read, and not a typed-in table.**

`ledger_entries` rows are written _inside the same transaction_ as the event that causes them
(invoice finalize → debit; payment post → credit; adjustment; reversal). Each entry carries
`(source_type, source_id)` behind a **unique index**, which makes posting idempotent: replaying
the same source document cannot double-post. The running balance is computed with a SQL window
function — `SUM(amount) OVER (PARTITION BY service_account_id ORDER BY entry_date, id)` — and is
never stored. This satisfies the requirement that the balance be _derivable from authoritative
transactions_ while remaining fast: one million entries with the right index is a few milliseconds
per account.

**Invoice `balance_centavos` / `paid_centavos` are maintained caches, not the truth.**

The truth is `payment_allocations`. The cached columns exist so that "list 60 overdue accounts"
and AR aging do not aggregate allocations across 500,000 payments on every page load. They are
updated inside the payment transaction, and an `verifyIntegrity()` routine rebuilds them from
allocations and proves they match — exposed as an admin screen, and one of the strongest things to
demonstrate during a defense.

**Document numbering uses a row-locked sequence table, not a Postgres `SEQUENCE`.**

`document_sequences(scope, period_year, prefix, current_value)` is read with `SELECT ... FOR
UPDATE` inside the business transaction. This gives gapless numbering per scope per year
(`INV-2026-000123`, `RCPT-2026-000456`), which matters because **voided receipt numbers must be
reserved and never reused**. A native `SEQUENCE` is faster but leaves gaps on rollback. Trade-off
accepted: numbering is a serialization point, but it is one short row lock per document, and it is
the correct behaviour for financial documents.

**`OVERDUE` is derived, not a stored lifecycle state.**

Stored status is the lifecycle: `DRAFT | UNPAID | PARTIALLY_PAID | PAID | VOID | CREDITED`.
"Overdue" is `balance_centavos > 0 AND due_date < today` — a time-dependent property that would
otherwise need a nightly job and would be wrong between job runs. The API returns a computed
`displayStatus` yielding all seven specification states to the UI. See §10 P4 for how this is
demonstrated rather than merely asserted.

**Reports generate on the API, not in the renderer.**

ExcelJS and pdfmake run server-side against an indexed query and the API streams the buffer back.
The Electron main process writes it with a native save dialog. This keeps large datasets out of
the renderer, which §21 requires and which also prevents the renderer from ever holding bulk
financial data.

**Attachments live on disk outside the database; the renderer never sees a filesystem path.**

`payment_proofs` stores a relative path, a SHA-256 hash, a MIME type validated by **magic bytes**
(not file extension), byte size, and uploader. Files land under `data/proofs/<yyyy>/<mm>/<uuid>.<ext>`.
The renderer requests bytes through an authorized streaming endpoint and never receives a path it
could use to read arbitrary files.

**The renderer never holds a session token.** It lives in main-process memory. This is why
authorization cannot be bypassed from DevTools.

### 2.3 Target stack, by owning phase

**Amended (C3).** §3 mandates a stack; that does not mean every library is installed. Verified
current state: `exceljs`, `pdfmake`, `argon2`, `react-hook-form`, `@tanstack/react-table`, and
`electron-builder` are **not** installed, and no shadcn/ui components are installed yet
(`components.json` exists, but it is only configuration).

Each library is installed by the phase that first uses it. Installing ahead of use would add
unused dependencies to every install on all three workstations and to CI.

| Library                                                                                   | Purpose                        | Installed by  |
| ----------------------------------------------------------------------------------------- | ------------------------------ | ------------- |
| Electron 44, electron-vite, React 19, TypeScript strict, Tailwind 4, TanStack Query, Pino | Shell, UI, logging             | **P1 — done** |
| Fastify 5, Zod 4, Drizzle ORM, PostgreSQL 17, Vitest, Playwright                          | API, validation, schema, tests | **P1 — done** |
| `@node-rs/argon2`                                                                         | Password hashing (see note)    | P2            |
| shadcn/ui components                                                                      | UI primitives                  | P3            |
| `@tanstack/react-table`                                                                   | Data tables, virtualisation    | P3            |
| `react-hook-form`                                                                         | Form state                     | P3            |
| `exceljs`                                                                                 | XLSX export                    | P8            |
| `pdfmake`                                                                                 | PDF export                     | P8            |
| `electron-builder`                                                                        | Windows installer              | P9            |

**One deliberate addition:** `argon2`. The specification says "secure password hashing" without
naming a library; argon2id is the current OWASP first choice and is defensible in a technical
review. Swapping to `bcrypt` is a one-line change if preferred.

**Packaging (A2).** `electron-builder` is required by §3 and `release/` appears in §33, but no
phase previously owned producing an installer. It is now a P9 deliverable. The build will be
**unsigned**: signing requires a purchased certificate. Windows SmartScreen will warn on first run
on each of the three PCs, and that is a deployment note, not a defect — it must be stated plainly
in the deployment guide rather than discovered on installation day.

---

## 3. Module Map

| #   | Module                | Responsibility                                                                         | Key entities                                                                                                            |
| --- | --------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| M1  | **Platform**          | Config, env validation, DB pool, migrations, error handling, logging, health           | —                                                                                                                       |
| M2  | **Identity & Access** | Users, roles, permissions, login, sessions, lock, RBAC guard                           | `users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `sessions`, `login_attempts`                         |
| M3  | **Subscribers**       | Subscriber records, addresses, contacts, status lifecycle                              | `subscribers`, `subscriber_addresses`, `subscriber_contacts`                                                            |
| M4  | **Services**          | Service types, plans, service accounts, service event history                          | `service_types`, `service_plans`, `service_accounts`, `service_events`                                                  |
| M5  | **Billing**           | Cycles, invoice generation, numbering, states, adjustments, void                       | `billing_cycles`, `invoices`, `invoice_items`, `adjustments`                                                            |
| M6  | **Ledger**            | Append-only entries, running balance, statement of account                             | `ledger_entries`                                                                                                        |
| M7  | **Payments**          | Capture, allocation, receipts, GCash verification, reversal                            | `payments`, `payment_allocations`, `payment_proofs`, `payment_reversals`, `receipts`                                    |
| M8  | **Collections**       | Areas, routes, collector assignment, batches, route sheets, remittance, reconciliation | `collection_areas`, `collector_assignments`, `collection_batches`, `collection_batch_accounts`, `collector_remittances` |
| M9  | **Receivables**       | Outstanding, overdue, aging, suspension, reconnection                                  | `suspension_records`, `reconnection_records` (+ views)                                                                  |
| M10 | **Reporting**         | Dashboard KPIs, 17 reports, PDF/XLSX                                                   | reads M5–M9                                                                                                             |
| M11 | **Audit & Admin**     | Audit log, settings, backup/restore history, integrity checks                          | `audit_logs`, `application_settings`, `backup_history`                                                                  |

Every database concept named in §22 of the specification is modelled above. The map _adds_
`sessions`, `login_attempts`, `ledger_entries`, and `document_sequences`; §22 permits refinement
and forbids removal, so nothing required has been dropped.

---

## 4. Module Dependency Order

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

Hard dependencies:

- **M5 cannot start without M4** — invoices bill service accounts, and the plan price must be
  snapshotted at generation time.
- **M7 cannot start without M5 + M6** — allocation targets invoices and writes ledger credits.
- **M8 cannot start without M3 + M7** — routes group service accounts; batches contain payments.
- **M9 cannot start without M5 + M7** — aging is computed from invoice balances and payment dates.
- **M11 is infrastructure, not a phase.** The audit log and `application_settings` tables are built
  in P2, and every later module writes to them.
- **M6 is split across two phases:** the table, append/verify primitives, and statement view land
  in P4 with the billing debit; payment credits land in P5.

---

## 5. Database Design — Core Entities

### 5.0 Conventions

- Primary keys: `id BIGINT GENERATED ALWAYS AS IDENTITY`.
- Money: `*_centavos BIGINT`. Never `numeric`, never `real`, never `double precision`.
- Instants: `TIMESTAMPTZ`. Calendar dates: `DATE`, interpreted in `Asia/Manila`.
- `created_at` / `created_by` / `updated_at` / `updated_by` on mutable tables.
- No hard deletes on financial or subscriber history — soft `archived_at` or a `VOID` status.

**Constraint policy — amended (D1).** §23 requires constraints for "valid monetary values" and
"valid statuses". Both are enforced in the database, not only in services:

```sql
-- Every money column carrying a non-negative amount.
ALTER TABLE invoices ADD CONSTRAINT ck_invoices_amounts_non_negative
  CHECK (subtotal_centavos >= 0 AND total_centavos >= 0 AND paid_centavos >= 0
         AND balance_centavos >= 0);

-- Every status column.
ALTER TABLE invoices ADD CONSTRAINT ck_invoices_status
  CHECK (status IN ('DRAFT','UNPAID','PARTIALLY_PAID','PAID','VOID','CREDITED'));
```

**Status values use `CHECK ... IN (...)` rather than native Postgres enum types.** Adding a
lifecycle state then costs a one-line migration instead of an enum alteration, and the state list
is expected to evolve — P4 introduces `CREDITED`. Application-level Zod validation remains the
first line, but a bug in a service cannot write an impossible state.

### 5.1 Identity & Access (M2)

- `users` — `username` (unique, `citext`), `password_hash`, `full_name`, `status`
  (`ACTIVE|LOCKED|DISABLED`), `must_change_password`, `last_login_at`, `failed_login_count`,
  `locked_until`.
- `roles` — 7 seeded roles, `code` unique.
- `permissions` — `code` unique (e.g. `payment.reverse`).
- `role_permissions` — PK `(role_id, permission_id)`.
- `user_roles` — PK `(user_id, role_id)`; a user may hold more than one role.
- `sessions` — `token_hash` (unique, SHA-256 of an opaque token), `user_id`, `expires_at`,
  `last_seen_at`, `locked_at`, `revoked_at`, `ip`, `device`. **Opaque server-side session tokens,
  not JWT**, so a workstation can be revoked or locked instantly.
- `login_attempts` — append-only record for the lockout policy and audit.

### 5.2 Subscribers (M3)

- `subscribers` — `account_number` (unique), `display_name`, `subscriber_type`
  (`RESIDENTIAL|COMMERCIAL|GOVERNMENT`), `status` (`ACTIVE|INACTIVE|TERMINATED|ARCHIVED`),
  `collection_area_id`, `assigned_collector_id`, `billing_day SMALLINT` (1–28),
  `due_day SMALLINT` (1–28), `notes`, `archived_at`.
- `subscriber_addresses` — typed (`SERVICE|BILLING|MAILING`), one flagged primary; geo/route hint
  fields for future route optimization.
- `subscriber_contacts` — typed (`MOBILE|LANDLINE|EMAIL`), one flagged primary.

One subscriber → many addresses → many service accounts.

### 5.3 Services (M4)

- `service_types` — `code` (`INTERNET|CABLE|COMBO`).
- `service_plans` — `code`, `service_type_id`, `name`, `speed_mbps`, `channel_count`,
  `monthly_fee_centavos`, `installation_fee_centavos`, `reconnection_fee_centavos`,
  `effective_from`, `effective_to`, `status`. **Price changes are new rows with an
  `effective_from`, never edits** — this is what preserves historical billed rates.
- `service_accounts` — `account_number` (unique), `subscriber_id`, `service_plan_id`, `status`
  (`PENDING|ACTIVE|SUSPENDED|DISCONNECTED|CLOSED`), `activation_date`, `suspension_date`,
  `billing_day`, `due_day`, `installation_fee_charged`, `current_plan_price_centavos`.
- `service_events` — append-only state-change history: `event_type`
  (`ACTIVATED|PLAN_CHANGED|SUSPENDED|RECONNECTED|DISCONNECTED|TRANSFERRED`), `from_value`,
  `to_value`, `effective_date`, `actor`, `reason`. Service history is read from here, never
  reconstructed from the live row.

**Critical rule:** `invoices` snapshot `unit_price_centavos` per line at generation time. A later
plan price change cannot retroactively alter an issued invoice.

### 5.4 Billing (M5)

- `billing_cycles` — `period_start`, `period_end`, `due_date`, `label`,
  `status` (`OPEN|GENERATING|GENERATED|CLOSED|LOCKED`), `generated_at`, `generated_by`.
- `invoices` — `invoice_number` (unique), `subscriber_id`, `service_account_id`,
  `billing_cycle_id`, `billing_period_start`, `billing_period_end`, `issue_date`, `due_date`,
  `subtotal_centavos`, `discount_centavos`, `penalty_centavos`, `adjustment_centavos`,
  `tax_centavos`, `total_centavos`, `paid_centavos` (cache), `balance_centavos` (cache), `status`,
  `finalized_at`, `void_reason`.
- `invoice_items` — `invoice_id`, `item_type`
  (`SUBSCRIPTION|INSTALLATION|RECONNECTION|DISCOUNT|PENALTY|ADJUSTMENT`), `description`,
  `quantity`, `unit_price_centavos`, `amount_centavos`, `service_plan_id`, `service_account_id`.
- `adjustments` — `invoice_id` OR `service_account_id`, `adjustment_type` (`DEBIT|CREDIT`),
  `reason_code`, `amount_centavos`, `memo`, `approved_by`, `status`, `voided_at`.

**Duplicate-billing guard (the important one):**

```sql
CREATE UNIQUE INDEX uq_invoice_active_period
  ON invoices (service_account_id, billing_period_start)
  WHERE status <> 'VOID';
```

This makes AT-11 a database guarantee rather than an application hope. Running billing twice
cannot produce two live invoices for the same account-period even under concurrency — the second
insert fails and is reported as "already billed", which is the correct UX.

### 5.5 Ledger (M6)

- `ledger_entries` — `service_account_id`, `subscriber_id`, `entry_date`, `entry_type`
  (`INVOICE|PAYMENT|ADJUSTMENT|REVERSAL|CREDIT_APPLIED|CREDIT_ISSUED`), `source_type`, `source_id`,
  `reference_no`, `description`, `debit_centavos`, `credit_centavos`,
  `running_balance_centavos` (computed, not stored), `actor_id`.

```sql
CREATE UNIQUE INDEX uq_ledger_source
  ON ledger_entries (source_type, source_id, entry_type);
```

**Sign convention (must be documented and tested):** debits increase what the customer owes
(invoice); credits reduce it (payment). Consequence: **a positive running balance means the
customer owes money; a negative running balance means the customer has credit.** This single
convention determines how every screen and report reads, so it is written into `CLAUDE.md`.

### 5.6 Payments (M7)

- `payments` — `receipt_number` (unique), `subscriber_id`, `service_account_id`, `payment_date`,
  `amount_centavos`, `applied_centavos`, `unapplied_centavos`, `payment_method`
  (`CASH|GCASH|BANK_TRANSFER|CHEQUE|OTHER`), `reference_number`, `status`
  (`PENDING_VERIFICATION|POSTED|REJECTED|REVERSED`), `received_by`, `notes`, `batch_id`,
  `posted_at`.
- `payment_allocations` — `payment_id`, `invoice_id`, `amount_centavos`, `allocated_by`,
  `allocated_at`, `is_manual`. Source of truth for how much of each payment settled which invoice.
- `payment_proofs` — `payment_id`, `file_path`, `file_sha256`, `mime_type`, `byte_size`,
  `original_name`, `uploaded_by`.
- `payment_reversals` — `original_payment_id`, `reversal_payment_id`, `reason_code`, `reason`,
  `approved_by`, `reversed_at`. The original payment is never mutated.
- `receipts` — `receipt_number`, `payment_id`, `status` (`ISSUED|VOID`), `void_reason`,
  `printed_count`. Voided receipt numbers are **reserved** — they appear in the voided-receipt
  report and are never reissued.

**GCash verification fields — amended (A1).** §11 requires storing sender information and the
verification outcome. The following columns are added to `payments`:

| Column             | Purpose                                                 |
| ------------------ | ------------------------------------------------------- |
| `sender_name`      | Name on the GCash transfer, as shown on the proof       |
| `sender_mobile`    | GCash sending number                                    |
| `verified_by`      | `users.id` of the staff member who approved or rejected |
| `verified_at`      | Timestamp of that decision                              |
| `rejection_reason` | Recorded when `status = 'REJECTED'`                     |

A rejected payment is a **recorded outcome, not a deleted row** — §11's workflow ends in
Approved or Rejected, and §38 forbids destructive deletion of payment records. The full state
machine is in §5.11.

**GCash duplicate guard:**

```sql
CREATE UNIQUE INDEX uq_gcash_reference
  ON payments (upper(trim(reference_number)))
  WHERE payment_method = 'GCASH'
    AND status NOT IN ('REJECTED', 'REVERSED');
```

**Unapplied-credit accounting (AT-03).** `unapplied_centavos` holds the remainder after
allocation. Invariant: `applied_centavos + unapplied_centavos = amount_centavos`. The credit is
stored on the payment and surfaced as an account-level credit balance; when the next invoice is
generated, a `CREDIT_APPLIED` ledger entry settles it — recorded as a **new allocation row**, never
by editing the invoice total. There are no phantom future invoices.

### 5.7 Collections (M8)

- `collection_areas` — `code`, `name`, `description`.
- `collector_assignments` — `collector_user_id`, `collection_area_id`, `effective_from`,
  `effective_to`. History preserved.
- `collection_batches` — `batch_number` (unique), `collector_user_id`, `collection_area_id`,
  `batch_date`, `status` (`OPEN|IN_PROGRESS|SUBMITTED|REMITTED|RECONCILED|CLOSED`),
  `expected_receivable_centavos`, `cash_collected_centavos`, `non_cash_collected_centavos`,
  `uncollected_centavos`, `submitted_at`, `reconciled_at`.
- `collection_batch_accounts` — the route sheet: `batch_id`, `service_account_id`,
  `expected_amount_centavos`, `collected_amount_centavos`, `outcome`
  (`COLLECTED|PARTIAL|PROMISE_TO_PAY|NOT_HOME|REFUSED|CLOSED`), `notes`.
- `collector_remittances` — `batch_id`, `remitted_cash_centavos`, `remitted_at`, `received_by`,
  `variance_centavos`, `variance_type` (`BALANCED|SHORTAGE|OVERAGE`), `resolution_notes`,
  `approved_by`.

`variance_centavos = remitted_cash - cash_collected`. **A negative variance is a SHORTAGE and a
positive variance is an OVERAGE; a non-zero variance is a first-class recorded state that cannot be reconciled away silently** — closing a batch
with a variance requires a reason and an approver. This is AT-08.

Non-cash collections are tracked separately and **excluded** from the cash variance: a customer
paying a collector by GCash means the money went straight to the company account and the collector
never held it.

### 5.8 Receivables, Suspension, Reconnection (M9)

- `suspension_records` — `service_account_id`, `reason_code`, `effective_date`, `approved_by`,
  `notes`, `triggering_invoice_id`, `arrears_at_suspension_centavos`, `status`.
- `reconnection_records` — `service_account_id`, `request_date`, `qualifying_payment_id`,
  `reconnection_fee_centavos`, `technician_user_id`, `completed_date`, `status`, `waived_by`,
  `waive_reason`.

Aging buckets (`Current`, `1–30`, `31–60`, `61–90`, `90+`) are computed from `today - due_date`
over invoices with `balance_centavos > 0`, exposed as a query helper and as an indexed
materialized view refreshed on demand for the dashboard.

Suspension is **never automatic**. The threshold produces a candidate list requiring human
approval.

### 5.9 Audit & Admin (M11)

- `audit_logs` — `actor_user_id`, `action`, `entity_type`, `entity_id`, `reason`, `old_values JSONB`,
  `new_values JSONB`, `ip`, `session_id`, `created_at`. **Append-only.**
- `application_settings` — typed key/value with `value_type` and a category, so grace period,
  suspension threshold, penalty rate, and reconnection fee are configuration, not hardcoded.
- `backup_history` — `file_path`, `byte_size`, `sha256`, `created_by`, `created_at`,
  `restore_verified_at`, `verification_notes`.

**Audit log immutability, enforced at the database level:**

```sql
CREATE OR REPLACE FUNCTION deny_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION deny_audit_mutation();
```

The same pattern applies to `ledger_entries` and posted `payment_allocations`. This is what makes
"posted financial records are immutable" a _verifiable_ claim rather than a promise.

### 5.10 Document numbering

`document_sequences` — `scope`, `period_year`, `prefix`, `current_value`, unique on
`(scope, period_year)`. Read with `SELECT ... FOR UPDATE` inside the business transaction.
Numbering is **per year, global**, not per workstation — per-workstation numbering would create
duplicates across the three PCs (decision A11).

### 5.11 GCash verification state machine

**Added (A1).** §11 describes the workflow; this is the state transition it implies.

```
PENDING_VERIFICATION ──approve──> POSTED ──> (allocated to invoices, receipt issued)
                     └──reject───> REJECTED   (reason recorded, no allocation, no receipt)

POSTED ──reverse──> REVERSED  (a linked counter-payment; the original is never mutated)
```

Rules:

- Only `POSTED` payments are allocated and produce a receipt.
- A payment enters at `PENDING_VERIFICATION` only for methods that carry proof (GCash, bank
  transfer). Cash is `POSTED` at capture.
- Approval and rejection both set `verified_by` and `verified_at` and both write an audit record.
- Rejection requires a reason (Zod `reasonSchema`, minimum length enforced).
- The duplicate-reference index covers `PENDING_VERIFICATION` and `POSTED`, and excludes
  `REJECTED`/`REVERSED` — so a mistaken rejection can be re-entered, while an approved reference
  can never be reused.

---

## 6. Financial Invariants

These become SQL check functions, Vitest integration assertions, and an admin "Integrity Check"
screen.

| #      | Invariant                                                                                                                        | Enforced by                                       |
| ------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| INV-1  | `sum(payment_allocations.amount) <= invoice.total_centavos` for every invoice                                                    | Service transaction + integrity check             |
| INV-2  | `sum(allocations) + payment.unapplied_centavos = payment.amount_centavos`                                                        | Service transaction + integrity check             |
| INV-3  | Account balance = `sum(debits) - sum(credits)` over ledger entries                                                               | The ledger _is_ the derivation                    |
| INV-4  | `invoices` caches equal allocation-derived values                                                                                | Integrity check rebuilds from source              |
| INV-5  | At most one non-`VOID` invoice per `(service_account_id, billing_period_start)`                                                  | Unique partial index                              |
| INV-6  | Receipt numbers unique; voided numbers never reissued                                                                            | Unique index + reserved numbering                 |
| INV-7  | One ledger entry per `(source_type, source_id, entry_type)`                                                                      | Unique index                                      |
| INV-8  | `remittance.variance = remitted_cash - cash_collected`; negative shortage, positive overage; non-zero requires approver + reason | Service rule + constraint                         |
| INV-9  | No `UPDATE`/`DELETE` on `ledger_entries`, `audit_logs`, posted `payment_allocations`                                             | Triggers                                          |
| INV-10 | Aging bucket totals equal total receivable                                                                                       | Integrity check                                   |
| INV-11 | All money arithmetic is integer centavos; no float reaches a money column                                                        | Branded types, Zod, `BIGINT` columns, ESLint rule |
| INV-12 | Invoice line prices equal the plan price effective at generation time                                                            | Snapshot column, never joined live                |

**Rounded discounts.** Statutory discounts (e.g. 20% senior/PWD) are computed with explicit
half-up rounding **on centavos** (`Math.round(amount * basisPoints / 10_000)`), and the rounding
delta is recorded on the discount line so the invoice always re-adds to its own total. This is a
real correctness trap on odd amounts and has a dedicated unit test.

**Transaction boundary.** Every multi-step financial operation runs inside one PostgreSQL
transaction: allocate → write allocations → update invoice caches → write ledger entry → issue
receipt → write audit row. Any failure rolls back all of it. A payment is never partially posted.

---

## 7. Security Requirements

| Area             | Requirement                                                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Password storage | Argon2id, per-user salt, tuned params; never logged, never returned by any endpoint                                                                   |
| Authentication   | Opaque session token; only its SHA-256 is stored; expiry + `last_seen_at`                                                                             |
| Session lock     | `sessions.locked_at`; a locked session may call only the unlock endpoint (re-auth) — enforced in the auth plugin, not the UI                          |
| Failed logins    | `failed_login_count` + `locked_until`; backoff after N attempts; every failure audited                                                                |
| Authorization    | `requirePermission('payment.reverse')` preHandler on **every** protected route; a route declaring no permission fails loudly at startup               |
| Validation       | Zod on **every** external input: body, query, params, and IPC payloads                                                                                |
| Error responses  | Stable machine codes + human messages; stack traces and SQLSTATEs go to Pino only                                                                     |
| Attachments      | MIME by magic bytes, size cap, extension allowlist, UUID filenames, stored outside the web root, served only through an authorized streaming endpoint |
| Secrets          | `.env` only, `.env.example` committed with placeholders, `.env` gitignored; startup Zod validation fails fast                                         |
| Electron         | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, no remote module, strict CSP, preload exposes only typed channels                |
| Logging          | Pino with redaction for `password`, `token`, `authorization`, `reference_number`; request IDs correlated across API and main process                  |
| Transport        | API bound to the LAN interface only; TLS behind a reverse proxy in P9                                                                                 |
| Database         | Application connects as a least-privilege role — no DDL at runtime; migrations run under a separate role                                              |

**Authorization is verified, not assumed.** AT-10 is the proof: a Cashier calling an
administrator endpoint directly must receive 403 regardless of what the UI showed them.

---

## 8. Acceptance Test Map

| ID    | Scenario                                                     | Primary file                                         | Phase |
| ----- | ------------------------------------------------------------ | ---------------------------------------------------- | ----- |
| AT-01 | Exact payment ₱999/₱999 → PAID, balanced, receipt            | `tests/integration/payments/exact.test.ts`           | 5     |
| AT-02 | Partial ₱500 → PARTIALLY_PAID, ₱499 remaining                | `tests/integration/payments/partial.test.ts`         | 5     |
| AT-03 | Advance ₱3,000 vs ₱1,000 → ₱2,000 unapplied credit           | `tests/integration/payments/advance.test.ts`         | 5     |
| AT-04 | Oldest-first ₱1,200 vs 2×₱999 → Aug ₱0, Sep ₱798             | `tests/integration/payments/allocation.test.ts`      | 5     |
| AT-05 | Duplicate GCash reference blocked                            | `tests/integration/payments/gcash-duplicate.test.ts` | 5     |
| AT-06 | Reversal restores balances, links original, audits           | `tests/integration/payments/reversal.test.ts`        | 5     |
| AT-07 | Balanced remittance → variance ₱0                            | `tests/integration/collections/remittance.test.ts`   | 6     |
| AT-08 | Shortage ₱20,000/₱19,500 → ₱500 SHORTAGE                     | `tests/integration/collections/shortage.test.ts`     | 6     |
| AT-09 | 2–3 concurrent clients → no corruption, no duplicate numbers | `tests/integration/concurrency/*.test.ts`            | 5, 9  |
| AT-10 | Cashier hits admin endpoint → 403                            | `tests/integration/authz/rbac.test.ts`               | 2     |
| AT-11 | Billing twice → no duplicate finalized invoice               | `tests/integration/billing/duplicate.test.ts`        | 4     |
| AT-12 | Backup → mutate → restore → integrity passes                 | `tests/integration/admin/backup-restore.test.ts`     | 9     |

Integration tests run against a **real PostgreSQL**, never a mock. Mocking the database would make
AT-11's unique-index guarantee untested — and that guarantee is the whole point of the test.

**Unit-level rules already proven (P1).** The allocation and remittance-variance calculations are
implemented in `packages/domain` and unit-tested, so the AT-04 arithmetic (August ₱0, September
₱798), AT-03 advance credit, AT-07 balanced variance, and AT-08 shortage are already verified as
pure functions. The integration tests above prove the same rules survive the trip through HTTP,
Zod, and PostgreSQL.

---

## 9. Folder Structure

```
BCIS-Subscription-Billing-System/
├── apps/
│   ├── api/                          # Fastify 5
│   │   └── src/
│   │       ├── app.ts                # buildApp() — testable, no side effects
│   │       ├── server.ts             # listen() + graceful shutdown
│   │       ├── config/               # env.ts (Zod-validated), constants
│   │       ├── plugins/              # db.ts, auth.ts, rbac.ts, errors.ts, logging.ts
│   │       ├── modules/              # auth, users, subscribers, services, billing,
│   │       │                         #   payments, collections, receivables, reports, admin
│   │       └── shared/               # response envelope, pagination, error codes
│   └── desktop/                      # electron-vite
│       └── src/
│           ├── main/                 # window, api-client, token vault, ipc handlers
│           ├── preload/              # contextBridge — narrow typed surface
│           └── renderer/             # React 19 + Tailwind 4 + shadcn/ui
│               └── src/
│                   ├── app/          # router, providers, guards
│                   ├── components/   # ui/, layout/, data-table/, money/
│                   ├── features/     # one folder per domain module
│                   └── lib/          # queries, mutations, formatters
├── packages/
│   ├── shared/                       # branded Centavos, money math, dates,
│   │                                 #   permission codes, error codes
│   ├── validation/                   # Zod schemas shared by API and desktop
│   └── domain/                       # PURE business logic: allocation, aging, discounts,
│                                     #   ledger math, remittance variance, proration
├── database/
│   ├── migrations/                   # drizzle-kit generated SQL
│   ├── seeds/                        # synthetic demo data (§15)
│   └── drizzle.config.ts
├── tests/
│   ├── unit/                         # see the note below
│   ├── integration/                  # API + real PostgreSQL
│   └── e2e/                          # Playwright + Electron
├── docs/                             # architecture, business rules, roadmap, user manual
├── reports-samples/                  # generated PDF/XLSX samples for the defense
├── release/                          # electron-builder output
├── docker-compose.yml
├── CLAUDE.md
├── README.md
├── .env.example
└── package.json
```

**Note on `tests/unit/` — recorded (D2).** §33 lists this directory, but unit tests are
**colocated** with the code they test (`packages/*/src/*.test.ts`), and the directory is empty.
This is deliberate, and it is recorded here so it does not read as an oversight:

- A pure function and its test sit in the same folder, so the test cannot be forgotten when the
  function moves.
- `packages/domain/src/allocation.test.ts` alongside `allocation.ts` is exactly the pairing a
  reviewer should be shown during a defense.
- `vitest.config.ts` already includes `tests/unit/**`, so the integration-style layout remains
  available for anything that does not belong beside a source file.

**Module internal convention** — the rules live in the service, the SQL in the repository:

```
apps/api/src/modules/payments/
├── payments.routes.ts        # HTTP surface + requirePermission() + Zod
├── payments.service.ts       # business rules + transaction boundary
├── payments.repository.ts    # Drizzle queries only
├── payments.mapper.ts        # row → DTO (money formatting happens at the edge)
└── payments.audit.ts         # audit descriptors for this module
```

Business logic lives in `packages/domain` (pure, unit-testable) or `*.service.ts`. **Never in a
React component.**

### 9.1 Performance targets — completed (E2)

§21 names four figures. All four are the design targets, and each has a named mechanism:

| Target                   | Mechanism                                                                                    |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| 20,000 subscribers       | GIN trigram indexes for partial name / account-number search                                 |
| 500,000 invoices         | Partial index on unpaid balances; cached `balance_centavos` for aging                        |
| **500,000 payments**     | Allocations indexed by `invoice_id` and `payment_id`; no per-row aggregation on list screens |
| 1,000,000 ledger entries | Composite index on `(service_account_id, entry_date, id)` for the window-function balance    |

Nothing large is loaded into the renderer: pagination is capped at 200 rows per page, and
filtering, sorting, and aggregation happen in SQL.

---

## 10. Development Order (Phases)

Phases are sequential; each has an exit criterion that must actually pass before moving on.

### P1 Foundation — **COMPLETE**

Monorepo, TypeScript strict, Electron shell, Fastify, Drizzle, PostgreSQL, migrations, lint/tests,
health endpoints, and the System Health screen reading live through the full data path.

**Exit criterion — met:** `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test &&
pnpm test:e2e` all green (62 unit/integration + 5 e2e); `pnpm db:reset` rebuilds the schema from
migrations alone; the desktop shell shows live API and database health and changes state when the
API is stopped, recovering without restarting Electron.

### P2 Auth & RBAC

Users, roles, permissions, login, logout, session lock, guards, audit infrastructure, settings.
Installs `argon2`.

**Exit criterion:** AT-10 passes; audit rows are written on login and role change; a route with no
permission declaration fails at startup.

### P3 Subscribers & Services

Plans, subscribers, addresses, contacts, service accounts, service history, collector assignment,
search. Installs shadcn/ui components, TanStack Table, React Hook Form.

**Includes the Subscriber Profile screen (§20)** with its ten tabs: Overview, Services, Billing,
Payments, Ledger, Collection, Service History, Documents, Audit.

**Begins incremental seeding (B1)** — see §15.

**Exit criterion:** create a subscriber with 2 service accounts; history shows each state change;
search paginates.

### P4 Billing & Ledger — **COMPLETE**

Cycles, generation, numbering, states, duplicate prevention, ledger debit, adjustments, void.

**Exit criterion — includes (F2):** AT-11 passes; a generated invoice produces a matching ledger
debit; void is non-destructive; **and the invoice view displays all seven specification states,
with `OVERDUE` computed from `due_date` and `balance_centavos > 0` rather than stored.** This is
the weakest currently-unverifiable claim in the design, so it becomes an explicit,
demonstrable exit criterion rather than an assertion.

**Delivered.** Five new tables (`billing_cycles`, `invoices`, `invoice_items`, `adjustments`,
`ledger_entries`) and `service_accounts.installation_fee_charged`, in migration
`0003_billing_and_ledger.sql`. Twenty-seven CHECK constraints, the partial unique index that makes
duplicate billing impossible, and seven triggers carrying append-only and immutability rules.

Design decisions taken, each recorded with its reasoning in `docs/business-rules.md` §12:

- **`ledger_entries` has no balance column.** The running balance is a window function over
  `(entry_date, id)`. A stored balance is a second source of truth that drifts silently, and when
  it does there is no second number to check it against — so it was left out of the schema rather
  than maintained carefully.
- **Invoice totals are constrained, not trusted.** `total = subtotal − discount + penalty +
adjustment + tax` and `balance = total − paid` are CHECK constraints, and a trigger verifies the
  components against the invoice's own lines on every update of a finalized invoice.
- **An invoice is inserted as a draft, then posted.** The item trigger refuses to add a charge line
  to a finalized invoice — which is what protects a posted invoice — so the generator attaches the
  lines first and posts second.
- **`OVERDUE` is derived, not stored (A13)**, and returned as `displayStatus` alongside the stored
  lifecycle state.

Working assumptions used, all from §9 and all reversible at the service layer rather than by
migration: **A1** prices VAT-inclusive (`tax_centavos` is a breakdown figure, currently 0);
**A2** a period is a calendar month; **A3** no proration; **A4** penalties opt-in, applied once at
the grace threshold, computed on the outstanding balance; **A11** invoice numbers per business
year, global; **A13** `OVERDUE` derived.

### P5 Payments

Capture, allocation (oldest-first + manual), partial, advance credit, receipts, GCash
verification, reversal, audit.

**Includes the Receive Payment cashier flow (§20)** — search subscriber → view balance → enter
amount → select method → allocation preview → post → receipt — and the **GCash Verification
two-pane queue** (queue on the left, proof details on the right).

**Extends seeding** with the payment mix.

**Exit criterion:** AT-01…AT-06 pass against real PostgreSQL.

### P6 Collections

Areas, routes, assignments, batches, route sheets, remittance, reconciliation.

**Includes the Collection Reconciliation layout (§20):** expected cash, remitted cash, difference,
non-cash, accounts collected, exceptions.

**Exit criterion:** AT-07 and AT-08 pass; a variance cannot be closed without a reason and an
approver.

### P7 Receivables

Outstanding, overdue, aging, suspension candidates, suspension, reconnection.

**Completes seeding (B1)** with overdue accounts, reversals/voids, and suspension/reconnection
cases.

**Exit criterion:** aging buckets reconcile to the total receivable; suspension and reconnection
write service events.

### P8 Reports & Dashboard

Dashboard KPIs, the 17 reports of §24, PDF, XLSX, printing. Installs `exceljs` and `pdfmake`.

**Dashboard (§20)** must show: current receivable, overdue receivable, subscriber count, monthly
billing, monthly collection, payment method summary, AR aging, overdue alerts, recent payments,
collector performance.

**The 17 reports (C1)** — transcribed from §24 so the exit criterion is checkable:

| #   | Report                            | Export       |
| --- | --------------------------------- | ------------ |
| 1   | Daily Collection Report           | PDF + XLSX   |
| 2   | Weekly Collection Report          | PDF + XLSX   |
| 3   | Monthly Collection Report         | PDF + XLSX   |
| 4   | Annual Collection Report          | PDF + XLSX   |
| 5   | Accounts Receivable Aging         | PDF + XLSX   |
| 6   | Overdue Subscriber Report         | PDF + XLSX   |
| 7   | Subscriber Master List            | PDF + XLSX   |
| 8   | Subscriber Statement of Account   | **PDF only** |
| 9   | Collector Collection Report       | PDF + XLSX   |
| 10  | Collector Remittance Report       | PDF + XLSX   |
| 11  | Collector Shortage/Overage Report | PDF + XLSX   |
| 12  | Payment Method Summary            | PDF + XLSX   |
| 13  | Billing vs Collection             | PDF + XLSX   |
| 14  | Revenue by Plan/Service           | PDF + XLSX   |
| 15  | Payment Reversal Report           | PDF + XLSX   |
| 16  | Voided Receipt Report             | PDF + XLSX   |
| 17  | Audit Activity Report             | PDF + XLSX   |

**Export rule:** XLSX for anything a user may want to total or pivot; **PDF only for the
Statement of Account**, which is a customer-facing document where a spreadsheet is the wrong
artefact. "Applicable" in §24 is read as this rule.

**Exit criterion:** each report exports in the listed formats with correct totals; samples are
saved to `reports-samples/`.

### P9 Security & Deployment

Backup, restore, logging hardening, secret audit, LAN deployment, multi-client validation.

**Packaging (A2).** Install `electron-builder` and produce a Windows installer into `release/`.
The build is **unsigned** — no code-signing certificate — so Windows SmartScreen warns on first
run on each PC. The deployment guide must state this plainly and give the "More info → Run anyway"
path, rather than letting it be discovered on installation day.

**Exit criterion:** AT-12 passes; restore is verified; AT-09 passes with 3 real clients; an
installer produced by `electron-builder` installs and runs on a clean machine.

### P10 QA & Documentation

Full acceptance run, regression, bug fixes, technical documentation, user manual, deployment
guide, defense preparation.

**Verifies the completed seed against §32's quantities** (§15).

**Exit criterion:** AT-01…AT-12 all pass on a fresh database built from migrations + seed.

---

## 11. Open Ambiguities — Decisions Needed

Genuine gaps in the specification. Each has a recommendation. **None blocks Phase 2.**

| #   | Ambiguity                                                                                                                         | Blocks | Recommendation                                                                                                                                                                                                                                                                                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | **VAT treatment.** PH internet/cable is subject to 12% VAT. Are plan prices VAT-inclusive or VAT-exclusive?                       | P4     | Treat plan prices as **VAT-inclusive** and record a `tax_centavos` breakdown line. Simplest for cashiers and matches how ISPs advertise.                                                                                                                                                                                |
| A2  | **Billing period anchor.** Calendar month, or the subscriber's own cycle (e.g. 15th–14th)?                                        | P4     | **Calendar month**, with `billing_day` controlling issue date and `due_day` the due date within that month. Keeps AT-11's uniqueness key trivially correct.                                                                                                                                                             |
| A3  | **Proration on mid-cycle activation.**                                                                                            | P4     | **Prorate the first month** by days active, half-up on centavos, with the factor recorded on the line.                                                                                                                                                                                                                  |
| A4  | **Penalties / late fees.** Percentage or flat? Once or monthly?                                                                   | P4     | Configurable, applied **once** at a grace threshold, as a `PENALTY` invoice item. Never compounding.                                                                                                                                                                                                                    |
| A5  | **Discounts.** Statutory only, or also promo/employee/loyalty? Recurring?                                                         | P4     | Model both with a `recurring` flag. Statutory discounts are recurring and VAT-exempt. Needs confirmation of which types to enable.                                                                                                                                                                                      |
| A6  | **Suspension threshold basis.** Days overdue, unpaid months, or arrears amount?                                                   | P7     | Configurable — whichever of months-unpaid or days-overdue trips first. Always a **candidate list** requiring human approval.                                                                                                                                                                                            |
| A7  | **Reconnection payment requirement.** Full arrears, or partial + fee?                                                             | P7     | Require the **reconnection fee plus at least the oldest unpaid invoice**; allow a supervisor waiver with a recorded reason.                                                                                                                                                                                             |
| A8  | **Non-cash field collection.** Is a GCash payment part of the collector's cash remittance?                                        | P6     | **No.** Recorded separately and excluded from the cash variance, or collectors appear short for money they never held.                                                                                                                                                                                                  |
| A9  | **Batch scope.** Per collector per day, or per area per day?                                                                      | P6     | **One batch per collector per day**, which may span areas. Matches a real route run.                                                                                                                                                                                                                                    |
| A10 | **Duplicate GCash policy.** Hard block or supervisor override?                                                                    | P5     | **Hard block by default**, with a supervisor-only override requiring a written reason and producing a distinct audit action.                                                                                                                                                                                            |
| A11 | **Receipt numbering scope.**                                                                                                      | P5     | **Per year, global.** Per-workstation would create duplicates across the three PCs.                                                                                                                                                                                                                                     |
| A12 | **Invoice `CREDITED` state.** What does it mean?                                                                                  | P4     | An invoice whose full balance was cancelled by credit adjustments rather than payment — revenue reversal, not revenue. Distinguished from `PAID` in reporting.                                                                                                                                                          |
| A13 | **`OVERDUE` stored vs derived.**                                                                                                  | P4     | **Derived**, surfaced as `displayStatus` so the UI still shows all seven states. Avoids nightly-job staleness. See §10 P4 for how this is demonstrated.                                                                                                                                                                 |
| A14 | **Timezone and report day boundary.**                                                                                             | P6     | `Asia/Manila` (UTC+8) everywhere; all report boundaries computed in that zone; DB stores `TIMESTAMPTZ`.                                                                                                                                                                                                                 |
| A15 | **Who may restore a backup?**                                                                                                     | P9     | `Owner/Super Admin` only, plus a mandatory pre-restore snapshot and an audit record.                                                                                                                                                                                                                                    |
| A16 | **Demo seed determinism.**                                                                                                        | P3     | Deterministic seed with a **fixed random seed**, so acceptance runs are reproducible and demo screenshots stay stable.                                                                                                                                                                                                  |
| A17 | **Is a "route" a first-class entity?** §12 lists routes as supported; §22's concept list omits a `routes` table. **(Added — F1)** | P6     | **Keep it folded** into `collection_areas` plus `subscriber_addresses` geo hints, because §22's list is authoritative and omits it. The reasoning should be stated in the defense rather than left implicit. If the laboratory expects a distinct route sheet per route, revisit here — it is a contained change at P6. |

---

## 12. Phase 1 Checklist

**Workspace & tooling** — complete

- [x] Git repository initialised; `.gitignore` covers `.env`, `node_modules`, `dist`, `out`,
      `release`, `data/`, `.runtime/`, `.turbo/`, `.commandcode/`
- [x] `.gitattributes` pins LF (the Git for Windows default of `core.autocrlf=true` would
      otherwise break `format:check` on a fresh clone)
- [x] `pnpm-workspace.yaml` with `apps/*`, `packages/*`, `database`
- [x] `turbo.json` pipeline for `build`, `typecheck`, `lint`, `dev`
- [x] Root scripts: `dev`, `build`, `typecheck`, `lint`, `format`, `test`, `test:unit`,
      `test:integration`, `test:e2e`, `db:generate`, `db:migrate`, `db:reset`, `db:check`
- [x] `tsconfig.base.json` — `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
      `noImplicitOverride`
- [x] ESLint (flat config) + Prettier + `.editorconfig`, wired into turbo

**Database** — complete

- [x] `docker-compose.yml` with `postgres:17-alpine`, named volume, healthcheck
- [x] Portable-binaries path (`scripts/pg.ps1`) for workstations without Docker
- [x] `.env.example` with `DATABASE_URL`, `TEST_DATABASE_URL`, `API_HOST`, `API_PORT`,
      `BCIS_API_URL`, `NODE_ENV`, `LOG_LEVEL`, `DB_LOG_QUERIES`
- [x] `apps/api/src/config/env.ts` — Zod-validated, crashes fast on invalid or insecure values
- [x] `database/drizzle.config.ts` + migrations folder
- [x] Drizzle client + connection pool plugin with graceful shutdown
- [x] Baseline migration enabling `citext` and `pg_trgm` — **no domain tables yet**

**API** — complete

- [x] `buildApp()` factory (side-effect free) + `server.ts` entrypoint
- [x] Pino logging with redaction paths + request ID correlation
- [x] Central error handler mapping domain errors to stable codes, detail to logs only
- [x] `GET /health` (liveness) and `GET /health/db` (connectivity + migration state)
- [x] Response envelope + pagination helpers (in `packages/validation/src/http.ts`, shared with
      the desktop client rather than duplicated under `apps/api/src/shared/`)

**Desktop** — complete

- [x] electron-vite scaffold for main / preload / renderer
- [x] `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, strict CSP
- [x] Preload exposing exactly two typed channels (`health:check`, `app:info`)
- [x] React 19 + Tailwind 4 + shadcn/ui base configuration, all 9 specified colour tokens
- [x] Main-process API client + in-memory token vault (established now, used in P2)
- [x] Shell screen rendering API + database health live from the server

**Shared packages** — complete

- [x] `packages/shared` — branded `Centavos`/`SignedCentavos`, `parseCentavos`, `formatCentavos`,
      `applyRateBasisPoints`, integer-only guards
- [x] `packages/shared` — permission code constants, role codes, error code constants
- [x] `packages/shared` — Asia/Manila date helpers
- [x] `packages/validation` — barrel + Zod primitives, pagination, HTTP envelope
- [x] `packages/domain` — pure allocation and remittance-variance rules with unit tests

**Testing** — complete

- [x] Vitest configured at root; unit project + integration project
- [x] Integration harness spinning against real PostgreSQL, running migrations, resetting between
      tests, refusing to run if `TEST_DATABASE_URL` is unset or equal to `DATABASE_URL`
- [x] Money-math unit tests (26), allocation (18), variance (8), `/health` and error-envelope
      integration tests (10)
- [x] Playwright configured; Electron launch suite (5 tests) covering the shell, the preload
      surface, and the security posture

**Documentation & repo hygiene** — complete

- [x] `CLAUDE.md` — architecture rules, financial rules, security rules, the ledger sign
      convention, the layering rule, commit conventions
- [x] `README.md` — setup from zero on a clean machine
- [x] `docs/architecture.md` — the data path plus the "why" behind each locked decision
- [x] `docs/business-rules.md` — the 12 invariants, the AT map, the open decisions
- [x] `docs/roadmap.md` — this document
- [x] First commits in conventional-commit style (10 commits)

**Phase 1 exit criterion** — met

- [x] `pnpm db:reset` → `pnpm db:migrate` works from a clean checkout
- [x] Desktop shell shows live API and database health through the real chain
      (renderer → preload → main → HTTP → Fastify → PostgreSQL), and flips to unreachable and
      recovers when the API is stopped and restarted
- [x] `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm test:e2e` all pass

---

## 13. Verification

How the work is proven. Only executed results are reported.

1. **Schema reproducibility.** `pnpm db:reset` drops and rebuilds from migrations alone, proving
   migrations — not a hand-edited database — are the source of schema truth.
2. **End-to-end health proof.** With the API deliberately stopped, the desktop changes state
   rather than showing a stale "healthy", and recovers when the API returns without restarting
   Electron. This was executed and passed in three states; it is the evidence that the chain is
   real and not a hardcoded string.
3. **Full gate.** `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm test:e2e`,
   output pasted verbatim.
4. **Security spot-check.** `contextIsolation`, `nodeIntegration`, `sandbox`, and `webSecurity`
   read back from the live window by the e2e suite; the renderer confirmed to have no `require`,
   `process`, `module`, or `Buffer`; the preload surface confirmed to be exactly the declared
   functions; `git check-ignore .env`; no credential in the built bundles.
5. **Clean-machine rehearsal.** A full dependency wipe and reinstall has **not** been performed.
   It remains an open verification item for P9/P10, and is listed here rather than assumed.

---

## 14. What Is Not Being Done

- **Phase 2 is not started.** §41 directs the roadmap first; this document is that work.
- **No application code, migration, or test changes** accompanied this revision.
- **No empty directories** (`database/seeds/`, `reports-samples/`, `release/`) are created ahead
  of the phase that fills them. An empty directory commits as nothing and implies progress that
  has not happened.
- **No mandated library is installed ahead of its phase.** Doing so would add unused dependencies
  to every install on all three workstations.
- **Ambiguities A1–A17 are not resolved.** They are recorded with the phase that needs each, and
  that phase asks before proceeding.

---

## 15. Demo Data Target

**Added (B1).** §32 specifies the synthetic dataset the finished system must be able to produce.
It is recorded here as the acceptance target, because it is what the defense will be demonstrated
against.

**Seeding is incremental, not a single P3 script.** The dataset spans invoices, payments,
reversals, and suspensions, none of which exist before P4, P5, and P7. A seed written at P3 could
only ever cover master data.

| Seed stage  | Adds                                                                                                                                                            | Phase |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Base        | 5 users across the 7 roles, 3 Internet + 2 Cable + 2 Combo plans, 50 subscribers, 60+ service accounts, 2 collectors, 3 collection areas, collector assignments | P3    |
| Billing     | 3 billing months of cycles and invoices, including 10+ accounts deliberately left unpaid and overdue                                                            | P4    |
| Payments    | Cash, GCash, partial, exact, and advance payments; at least 1 reversal and 1 voided receipt                                                                     | P5    |
| Collections | 1+ collection batch per collector with a balanced remittance and one with a shortage                                                                            | P6    |
| Receivables | At least 2 suspension cases and 2 reconnection cases, with the service events they produce                                                                      | P7    |

**Determinism.** A fixed random seed (A16), so acceptance results are reproducible run to run and
demo screenshots stay stable across machines. Unseeded randomness is rejected by ESLint.

**Synthetic only.** §32 forbids real customer names, phone numbers, GCash details, passwords, or
production data. All names and references in the seed are invented.

**Verified at P10** against the quantities in the table above.

---

## 16. Required Screens by Phase

**Added (C2).** §20 names specific screens and layouts that the roadmap previously did not
enumerate, which would have left each screen's required composition to be guessed at
implementation time.

| Screen / layout               | Required content                                                                                                                                                                        | Phase                   |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| **Dashboard**                 | Current receivable, overdue receivable, subscriber count, monthly billing, monthly collection, payment method summary, AR aging, overdue alerts, recent payments, collector performance | P8                      |
| **Subscriber Profile**        | Tabs: Overview, Services, Billing, Payments, Ledger, Collection, Service History, Documents, Audit                                                                                      | P3                      |
| **Receive Payment**           | Cashier-optimised flow: search subscriber → view balance → enter amount → select method → allocation preview → post → receipt                                                           | P5                      |
| **GCash Verification**        | Two-pane workflow: verification queue (left) and proof details with approve/reject (right)                                                                                              | P5                      |
| **Collection Reconciliation** | Expected cash, remitted cash, difference, non-cash, accounts collected, exceptions                                                                                                      | P6                      |
| **Statement of Account**      | Chronological ledger with running balance, printable                                                                                                                                    | P5 (data) / P8 (output) |

**UI/UX constraints (§19) apply to all of them:** no excessive gradients, oversized cards,
decorative dashboards, or animation for its own sake. Financial values right-aligned with tabular
figures. Status conveyed by **text and colour**, never colour alone — colour alone fails for a
colour-blind user, on a washed-out office monitor, and on a black-and-white printout of a saved
report, and in a billing system a misread status is a misread balance.
