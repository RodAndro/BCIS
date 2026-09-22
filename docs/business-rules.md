# Business Rules

The rules the system must never violate, and how each one is enforced. Started in Phase 1
with the financial invariants; each later phase appends the rules it implements.

This document is deliberately written as **assertions**, not as prose. Every rule below can
be checked mechanically, and each one names the mechanism that checks it.

---

## 1. Financial invariants

These become SQL check functions, Vitest integration assertions, and an admin "Integrity
Check" screen. A change that makes one of them unenforceable is a design error, not a
trade-off.

| #      | Invariant                                                                                                                                                 | Enforced by                                                  | Status              |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------- |
| INV-1  | `sum(payment_allocations.amount) <= invoice.total_centavos` for every invoice                                                                             | Service transaction + integrity check                        | Phase 5             |
| INV-2  | `sum(allocations) + payment.unapplied_centavos = payment.amount_centavos`                                                                                 | Service transaction + integrity check                        | Phase 5             |
| INV-3  | Account balance = `sum(debits) - sum(credits)` over ledger entries                                                                                        | The ledger _is_ the derivation; no stored balance exists     | Phase 4             |
| INV-4  | Invoice caches (`paid_centavos`, `balance_centavos`) equal allocation-derived values                                                                      | Integrity check rebuilds the cache from source and compares  | Phase 5             |
| INV-5  | At most one non-`VOID` invoice per `(service_account_id, billing_period_start)`                                                                           | Partial unique index                                         | Phase 4             |
| INV-6  | Receipt numbers are unique; voided receipt numbers are never reissued                                                                                     | Unique index + `receipts.status`, numbering reserved on void | Phase 5             |
| INV-7  | One ledger entry per `(source_type, source_id, entry_type)`                                                                                               | Unique index — this is what makes posting idempotent         | Phase 4             |
| INV-8  | `remittance.variance = remitted_cash - cash_collected`; negative is shortage, positive is overage, and a non-zero value requires an approver and a reason | Service rule + close-blocker check                           | Phase 6             |
| INV-9  | No `UPDATE`/`DELETE` on `ledger_entries`, `audit_logs`, or posted `payment_allocations`                                                                   | Database triggers that raise on mutation                     | Phase 2 / 4         |
| INV-10 | Aging bucket totals equal the total receivable                                                                                                            | Integrity check                                              | Phase 7             |
| INV-11 | All money arithmetic is integer centavos; no float ever reaches a money column                                                                            | Branded types, Zod coercion, `BIGINT` columns, ESLint rule   | **Phase 1 — built** |
| INV-12 | Invoice line prices equal the plan price effective at generation time                                                                                     | Snapshot column; never joined live at read time              | Phase 4             |

### Already implemented (Phase 1)

**INV-11 — integer centavos only.** Enforced at four levels:

1. `packages/shared/src/money.ts` — `centavos()` / `signedCentavos()` reject fractions, `NaN`,
   `Infinity`, and anything beyond `MAX_CENTAVOS`. They throw `MoneyError` rather than
   coercing, so a fractional value cannot be rounded away by accident.
2. `packages/validation/src/primitives.ts` — `centavosSchema` is `.int().nonnegative()`;
   `pesoInputSchema` transforms a user-typed peso string into centavos and never accepts a
   float from the client.
3. `database/src/client.ts` — `BIGINT` columns are read as JavaScript numbers. Left at
   node-postgres' default they arrive as strings, and `"99900" + 100` would produce
   `"99900100"`.
4. `eslint.config.mjs` — a non-integer numeric literal is an error outside test files, so
   float money cannot be reintroduced by habit.

### Rules that follow from the invariants

- **A partial payment creates `PARTIALLY_PAID`, never a second invoice.** There is no
  "carry the remainder forward" operation. The remainder stays on the original invoice.
- **An advance payment is not a prepayment of a future invoice.** The excess is
  `unapplied_centavos` on the payment, surfaced as an account credit balance. There are no
  phantom future invoices (locked decision, §2 of the roadmap).
- **When a credit is later consumed, it is a new allocation row**, never an edit to an invoice
  total. `CREDIT_APPLIED` is a ledger entry, not a mutation.
- **A voided receipt keeps its number.** The number is reserved, appears in the voided-receipt
  report, and is never reissued (A11: numbering is per year, global).

---

## 2. Rounding

**Statutory discounts** (for example, 20% senior/PWD) are computed with explicit half-up
rounding **on centavos** — `Math.round(amount * basisPoints / 10_000)` — and the rounding
delta is recorded on the discount line so the invoice always re-adds to its own total.

This is a real correctness trap on odd amounts. `applyRateBasisPoints(centavos(333), 2000)`
must be `67`, not `66`, and there is a dedicated unit test for exactly that case.

Rates are always expressed in **basis points**, never as a float percentage: 20% is `2000`,
12% is `1200`, 0.5% is `50`. A non-integer rate is rejected.

---

## 3. Collector remittance

```
variance = cashRemitted - cashCollected
```

- **Negative variance = SHORTAGE.** The collector remitted less than expected.
- **Positive variance = OVERAGE.**
- **Zero = BALANCED.**

A one-centavo difference is a **real variance**, not a rounding artifact, and is reported as
such.

**A non-zero variance is a first-class recorded state that cannot be reconciled away
silently.** Closing a batch with a variance requires a reason and an approver. This is AT-08,
and `remittanceCloseBlockers()` returns precisely what is missing so the API can answer with a
specific error rather than a generic rejection.

**Non-cash collections are excluded** from the cash remittance variance. A customer paying a
collector by GCash means the money went directly to the company account; the collector never
held it. Including it would make every such collector appear short (decision A8).

`uncollected` is floored at zero: collecting more than expected is an overage on the
remittance, not negative work on the route, and the two must not be conflated in a report.

---

## 4. Payment allocation

**Oldest unpaid invoice first.** Any amount left over becomes unapplied credit on the account
rather than being discarded or forced onto an arbitrary invoice.

Worked example (AT-04):

```
August invoice      ₱999.00
September invoice   ₱999.00
Payment           ₱1,200.00

August settles in full   ₱999.00
September receives       ₱201.00   → balance ₱798.00
Unapplied credit           ₱0.00
```

**The order is deterministic.** Invoices sort by due date, then by id. The id tiebreak
matters: two invoices sharing a due date would otherwise allocate in whatever order the
database returned rows, so the same payment could produce different results on different
runs. That is unacceptable in a ledger.

**Manual (authorized) allocation** honours the caller's order but cannot waive the limits that
exist to protect the ledger: it rejects an amount above an invoice's outstanding balance, the
same invoice appearing twice, and lines that together exceed the payment.

**Over-settlement guard.** Before allocation rows are written, the total to each invoice —
existing allocations plus the new lines — is checked against that invoice's balance. Two lines
that individually look fine but together overshoot are caught, and the guard fails inside the
transaction rather than corrupting a balance.

---

## 5. Duplicate prevention

Duplicates are prevented by the **database**, not only by application checks. Application
checks race; indexes do not. The specific constraints are defined in the phase that introduces
each table:

| Guard                                       | Mechanism                                                                                                                                    | Phase |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| One live invoice per account-period (AT-11) | `CREATE UNIQUE INDEX … ON invoices (service_account_id, billing_period_start) WHERE status <> 'VOID'`                                        | 4     |
| One ledger entry per source document        | `CREATE UNIQUE INDEX … ON ledger_entries (source_type, source_id, entry_type)`                                                               | 4     |
| Duplicate GCash reference (AT-05)           | `CREATE UNIQUE INDEX … ON payments (upper(trim(reference_number))) WHERE payment_method = 'GCASH' AND status NOT IN ('REJECTED','REVERSED')` | 5     |
| Receipt numbers never reused (INV-6)        | Unique index + reserved numbering on void                                                                                                    | 5     |

Running billing twice cannot produce two live invoices for the same account-period even under
concurrency: the second insert fails and is reported as "already billed", which is the correct
UX.

---

## 6. Immutability

Correction happens by **reversal, adjustment, or void**. Never by `UPDATE` or `DELETE`.

```sql
CREATE OR REPLACE FUNCTION deny_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION deny_audit_mutation();
```

The same pattern applies to `ledger_entries` and to posted `payment_allocations`. This is what
makes "posted financial records are immutable" a _verifiable_ claim rather than a promise —
a defense can demonstrate the trigger rejecting an `UPDATE`.

---

## 7. Service lifecycle

- Service history is read from `service_events`, never reconstructed from the live
  `service_accounts` row. State changes are appended with `from_value`, `to_value`,
  `effective_date`, actor, and reason.
- **Price changes create a new `service_plans` row with an `effective_from`.** A plan price is
  never edited, because that is what preserves historical billed rates.
- **Invoices snapshot `unit_price_centavos` per line at generation time.** A later plan price
  change cannot retroactively alter an issued invoice (INV-12).
- Suspension is **never automatic**. The threshold produces a _candidate list_ requiring human
  approval.

---

## 8. Acceptance test map

| ID    | Scenario                                                   | Primary file                                         | Phase | Status           |
| ----- | ---------------------------------------------------------- | ---------------------------------------------------- | ----- | ---------------- |
| AT-01 | Exact payment ₱999/₱999 → PAID, balanced, receipt          | `tests/integration/payments/exact.test.ts`           | 5     | unit rule proven |
| AT-02 | Partial ₱500 → PARTIALLY_PAID, ₱499 remaining              | `tests/integration/payments/partial.test.ts`         | 5     | unit rule proven |
| AT-03 | Advance ₱3,000 vs ₱1,000 → ₱2,000 unapplied credit         | `tests/integration/payments/advance.test.ts`         | 5     | unit rule proven |
| AT-04 | Oldest-first ₱1,200 vs 2×₱999 → Aug 0, Sep ₱798            | `tests/integration/payments/allocation.test.ts`      | 5     | unit rule proven |
| AT-05 | Duplicate GCash reference blocked                          | `tests/integration/payments/gcash-duplicate.test.ts` | 5     | —                |
| AT-06 | Reversal restores balances, links original, audits         | `tests/integration/payments/reversal.test.ts`        | 5     | —                |
| AT-07 | Balanced remittance → variance 0                           | `tests/integration/collections/remittance.test.ts`   | 6     | unit rule proven |
| AT-08 | Shortage ₱20,000/₱19,500 → ₱500 SHORTAGE                   | `tests/integration/collections/shortage.test.ts`     | 6     | unit rule proven |
| AT-09 | 3 concurrent clients → no corruption, no duplicate numbers | `tests/integration/concurrency/*.test.ts`            | 5, 9  | —                |
| AT-10 | Cashier hits admin endpoint → 403                          | `tests/integration/authz/rbac.test.ts`               | 2     | —                |
| AT-11 | Billing twice → no duplicate finalized invoice             | `tests/integration/billing/duplicate.test.ts`        | 4     | —                |
| AT-12 | Backup → mutate → restore → integrity passes               | `tests/integration/admin/backup-restore.test.ts`     | 9     | —                |

"Unit rule proven" means the _calculation_ is already tested in `packages/domain` — for
example `allocateOldestFirst` settling August in full and September to ₱798. The integration
test that proves the rule survives the trip through HTTP and PostgreSQL arrives with the phase
named above.

**Integration tests run against a real PostgreSQL, never a mock.** Mocking the database would
make AT-11's unique-index guarantee untested, and that guarantee is the whole point of the
test.

---

## 9. Open decisions

These are genuine gaps in the specification. They are **not** resolved by the implementation,
and the phase that depends on each one asks for the decision before proceeding. Nothing here
blocks work already completed.

| #   | Open question                                                         | Blocks | Working assumption                                                                                               |
| --- | --------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------- |
| A1  | Are plan prices VAT-inclusive or VAT-exclusive?                       | P4     | VAT-inclusive, with a `tax_centavos` breakdown line                                                              |
| A2  | Is a billing period a calendar month or the subscriber's own cycle?   | P4     | Calendar month; `billing_day` sets the issue date, `due_day` the due date                                        |
| A3  | Prorate the first month on mid-cycle activation?                      | P4     | Prorate by days active, half-up on centavos, factor recorded on the line                                         |
| A4  | Penalties: percentage or flat, applied once or monthly?               | P4     | Configurable, applied **once** at a grace threshold, never compounding                                           |
| A5  | Which discount types are enabled (statutory, promo, employee)?        | P4     | Statutory only until confirmed; `discount_type` carries a `recurring` flag                                       |
| A6  | Suspension threshold: days overdue, unpaid months, or arrears amount? | P7     | Configurable, whichever trips first; always a candidate list                                                     |
| A7  | Reconnection payment requirement?                                     | P7     | Reconnection fee plus at least the oldest unpaid invoice; supervisor waiver allowed                              |
| A8  | Is a field GCash payment part of the collector's cash remittance?     | P6     | **No** — tracked separately as non-cash                                                                          |
| A9  | Batch scope: per collector per day, or per area per day?              | P6     | One batch per collector per day, may span areas                                                                  |
| A10 | Duplicate GCash policy: hard block or supervisor override?            | P5     | Hard block by default; supervisor override with a written reason                                                 |
| A11 | Receipt numbering scope?                                              | P5     | **Per year, global** — per-workstation would duplicate across the three PCs                                      |
| A12 | What does the invoice `CREDITED` state mean?                          | P4     | Balance fully cancelled by credit rather than payment — a revenue reversal, distinguished from `PAID` in reports |
| A13 | Is `OVERDUE` stored or derived?                                       | P4     | **Derived**, surfaced as `displayStatus`                                                                         |
| A14 | Timezone and the report day boundary?                                 | P6     | Asia/Manila (UTC+8) everywhere                                                                                   |
| A15 | Who may restore a backup?                                             | P9     | Owner/Super Admin only, with a mandatory pre-restore snapshot and an audit record                                |
| A16 | Deterministic demo seed?                                              | P3     | Fixed random seed so acceptance runs are reproducible                                                            |

A13 and A11 are already reflected in the design and in `docs/architecture.md`; the rest are
assumptions that must be confirmed before the phase that needs them.

---

## 10. Identity and access (Phase 2)

Added with the phase that implements them.

### 10.1 Sessions are opaque and revocable

A session is a row, and the bearer token is a random 256-bit string whose SHA-256 is the only
thing stored. A JWT would be self-validating and therefore unrevokable, which is disqualifying
for a till that a supervisor must be able to sign out on request.

- **Logout revokes immediately.** The very next request with the token is refused; there is no
  window in which a signed-out session still works.
- **Expiry is enforced in the query**, not by a background job: a session past `expires_at`
  simply does not resolve.
- **Changing your own password revokes every other session** for that account. If the password
  is being changed because it was exposed, leaving the older sessions alive defeats the point.

### 10.2 Account state is revealed only after the password is verified

The sign-in algorithm is ordered deliberately:

1. An unknown username and a wrong password produce **the same status, the same code, and the
   same message**. An unknown username burns the same argon2id time as a real verification, so
   the two are not distinguishable by timing either.
2. Only once the password has been verified is a disabled, locked, or locked-out account
   reported as such. Only someone who already knows the password learns anything.

This is asserted by `tests/integration/auth/login.test.ts`.

### 10.3 Failed sign-ins lock the account

Consecutive failures are counted on `users.failed_login_count`. At
`MAX_FAILED_LOGIN_ATTEMPTS` the account gets a `locked_until` and the counter resets, so the
lock is the state rather than an ever-climbing number. Every attempt is written to
`login_attempts` and every refusal to `audit_logs`.

### 10.4 Session lock is enforced server-side

`POST /auth/lock` sets `sessions.locked_at`. The auth plugin then refuses **every** route for
that session except `/auth/me`, `/auth/logout`, and `/auth/unlock`. Unlocking requires the
password again — a bare "continue" button would mean anyone walking up to an unattended till
is inside the session.

### 10.5 Authorization is a property of the route, not of the UI

`requirePermission(...)` is declared on every protected route, and the auth plugin's `onRoute`
hook **throws at startup** for a route that declares none. Server-side authorization is
therefore not a convention that can be forgotten; forgetting it stops the build.

`tests/integration/authz/rbac.test.ts` proves the behaviour rather than the declaration: a
Cashier with a valid token receives `403` from `/users`, and the row is confirmed not to have
been written.

### 10.6 The audit log is append-only, enforced by the database

A trigger on `audit_logs` raises on any `UPDATE` or `DELETE`. This is what makes "posted
records are immutable" demonstrable instead of aspirational — the test performs a real `UPDATE`
and requires PostgreSQL to refuse it.

Audit snapshots record only the fields that changed, and **never** a password, a password hash,
or a session token. There is an integration test that scans every stored snapshot for exactly
those, so a future caller cannot leak one by passing a whole row.

### 10.7 Integrity guards on access administration

- **A username is unique**, guaranteed by a unique index on a `citext` column rather than by an
  application check.
- **The last active Owner cannot be disabled or stripped of the role.** A system with nobody
  who can administer it has no recovery path through the interface.
- **The Owner role always holds every permission**, including ones added in later phases. A
  narrowed Owner is one mistake away from an unadministrable system, so the API refuses it
  rather than trusting the operator to mean it.
- **A disabled or locked account has every live session revoked** in the same transaction, so
  it stops working at the till rather than at expiry.

---

## 11. Plans, subscribers and service accounts (Phase 3)

The rules that make a historical billed rate recoverable, added with the tables that hold them.

### 11.1 A plan price is superseded, never edited

`service_plans` is versioned by `effective_from` / `effective_to`. Changing a price inserts a
new row and closes the previous one the day before the new version starts. Two indexes make
that structural rather than conventional:

- one version per `(code, effective_from)`
- **at most one open-ended version per code** — a partial unique index

The second is the one that matters under concurrency. Without it, two simultaneous "change the
price" requests would each close the old row and each insert an open one, leaving a plan with
two current prices and no way to say which an account should be charged.

Explicitly **not** done by a price change: repricing the accounts already on the plan. Those keep
`current_plan_price_centavos` — a snapshot taken at activation, not a live join — until someone
calls `applyPlanRate`, which records a `RATE_APPLIED` service event and a reason.

The plan list shows the account's rate next to the plan version's price today, so drift is
visible rather than inferred.

### 11.2 A subscriber is archived, never deleted

Deleting the row would delete the reason a historical invoice, payment, or remittance belongs to
somebody. Leaving is a status (`INACTIVE`, `TERMINATED`, `ARCHIVED`) with `archived_at` recording
when.

`ARCHIVED` and `TERMINATED` are refused while the subscriber still has an ACTIVE service account.
Service running for a closed customer is a state no screen explains, so the operator is told to
disconnect first — which is itself an operation with its own history entry.

### 11.3 Service accounts snapshot their rate and their plan

`current_plan_price_centavos` is copied from the plan version in force at activation and is
never re-read from the plan. The service TYPE is deliberately not a column: it belongs to the
plan, and a second copy could disagree with the first.

Both foreign keys are `ON DELETE RESTRICT`: an account must not be able to lose the customer it
belongs to or the plan it is billed on.

### 11.4 Service history is append-only

`service_events` records every state change with `from_value`, `to_value`, `effective_date`,
actor, and reason, and a trigger rejects `UPDATE` and `DELETE` — the same defence as
`audit_logs`, applied to the one other table whose whole purpose is to be a trustworthy log.

Status transitions are decided by a pure rule in `@bcis/shared` (`canTransitionServiceStatus`),
unit-tested there before it was wired to HTTP. `CLOSED` is terminal: reopening would silently
reuse an account number that a customer's records already refer to.

### 11.5 An installation address in use cannot be removed

Replacing a subscriber's addresses matches rows by id, so an address a service account points at
is updated rather than recreated. Removing one that is still referenced is refused — a
delete-and-reinsert would null out where every customer's service is installed, silently, and be
discovered when a technician is sent to the wrong place.

### 11.6 Duplicate account numbers are prevented by the database

`subscribers.account_number` and `service_accounts.account_number` are unique indexes, and both
are allocated from `document_sequences` with a row-locked upsert inside the creating transaction.
The service-layer check produces the readable message; the index is what makes it true under
concurrency, and a rolled-back registration does not consume a number.

### 11.7 Search is provider-based

Subscriber search matches one term across a registry of providers — account number, name,
contact, address — and a provider returns a condition on `subscribers.id`. Phase 4 registers an
invoice-number provider and Phase 5 registers receipt and GCash-reference providers; the
endpoint, the query, and the UI do not change. Wildcards in the user's input are escaped, so
searching for `100%` looks for a literal `100%` rather than returning the table.

## 12. Billing and the subscriber ledger (Phase 4)

### 12.1 A balance is never stored

`ledger_entries` has no balance column. Every row is an immutable fact - this much was debited, or
this much was credited - and the running balance is derived in SQL:

```sql
SUM(debit_centavos) OVER (PARTITION BY service_account_id ORDER BY entry_date, id)
- SUM(credit_centavos) OVER (same window)
```

A stored balance is a second source of truth: it agrees with the entries until the day a posting
fails halfway or a migration backfills it wrongly, at which point nothing can say what it should
have been, because the number that would have told you is the number that is wrong. Deriving it
means the same statement recomputes to the same answer in any year, for every account. This is
INV-3 restated for the debit side.

The `id` tiebreak in the ordering is not optional. Two entries on the same date would otherwise
order by whatever the database returned, so one statement could show two different running
balances on two runs.

### 12.2 Duplicate billing is an index, not a rule in the service

`uq_invoices_account_period` is a partial unique index on `(service_account_id,
billing_period_start)` excluding VOID rows. A service account cannot receive two live invoices for
one billing period.

Two layers enforce it and both are tested separately. The planner skips accounts that already have
a live invoice, which produces the readable "already invoiced" line an operator sees and is the
layer that could be defeated by two runs starting together. The index is the layer that holds when
the first one races. AT-11 covers both, plus a run that fails partway to prove the surrounding
transaction rolls back completely.

### 12.3 Invoice components are checked against the lines that justify them

`invoices.total_centavos` is derived:

```
total = subtotal - discount + penalty + adjustment + tax
```

and `balance_centavos = total_centavos - paid_centavos`. Both identities are CHECK constraints, so
a row whose total disagrees with its own parts cannot be written by any code path.

Going further, a trigger verifies `subtotal`, `discount`, `penalty` and `adjustment` against the
`invoice_items` actually attached, on every update of a finalized invoice. The advertised total is
therefore always the sum of the lines, including after an adjustment or a penalty posting. A total
cannot be moved on its own even though every CHECK would still pass.

### 12.4 Historical invoices preserve the billed rate

`invoice_items.unit_price_centavos` is copied from the account's rate when the invoice is
generated, and nothing joins back to `service_plans` when reading an invoice. A plan price change
therefore cannot reach into a historical invoice, and an account keeps the rate it was activated
at until someone explicitly applies the new rate. This is INV-12, and it is the billing half of
the Phase 3 rule that a price change creates a new version rather than editing one.

### 12.5 Finalized invoices are immutable; posted records move, they are not edited

A before-update trigger rejects any change to a finalized invoice's number, subscriber, service
account, cycle, period, issue date, due date, tax or `finalized_at`. A before-delete trigger
rejects deleting one. A before-insert-or-update-or-delete trigger on `invoice_items` rejects any
change to the lines of a finalized invoice, with one deliberate exception: an `ADJUSTMENT` or
`PENALTY` line may still be ADDED. Those are the two controlled mechanisms by which a posted
invoice is allowed to change, and 12.3 proves the components moved by exactly their amount.

Only `status`, `paid_centavos`, `balance_centavos` and the void columns remain writable after
finalization, which is exactly what payment posting and voiding need.

The consequence inside the generator is that an invoice is inserted as a DRAFT, its lines are
attached, and only then is it posted. Creating it finalized first would have the database reject
the very lines that justify it.

### 12.6 Voiding reverses the ledger; it never erases

Voiding sets `status = 'VOID'` with a mandatory reason and posts a `REVERSAL` credit for the
invoice total. The number stays reserved, the original lines stay readable, and the account stops
being charged because the ledger nets to zero.

The VOID row no longer occupies the unique index, so the period can be billed again with a
corrected invoice. That is the only reason a void is useful rather than merely tidy.

An invoice with payments applied cannot be voided: reversing money that was received is a
different operation and belongs with payment reversal.

### 12.7 A draft is not a posted document

A DRAFT invoice writes nothing to the ledger. Posting it changes the status, sets `finalized_at`
and writes the debit, all in one transaction, because an invoice that existed without its ledger
entry would be a charge the ledger could not account for.

A DRAFT does occupy the `(service account, period)` slot, so generating twice for the same period
cannot produce two drafts either.

### 12.8 Generation is one transaction

Cycle creation, every invoice, every line, every ledger debit, the installation-fee flags and the
audit entry share a single transaction. A run that failed halfway would otherwise leave some
accounts billed for a period and others not, with no way to tell which without auditing by hand.

Invoice numbers are allocated inside that transaction from `document_sequences` with a row-locked
upsert, so a rollback does not consume a number and two concurrent runs cannot share one. Invoices
are numbered per business year (`INV-2026-000123`, decision A11) and globally rather than per
workstation, because three PCs with their own counters would issue the same number three times.

### 12.9 OVERDUE is derived (decision A13)

Six statuses are stored; `OVERDUE` is not one of them. It is a function of the due date and the
current balance, and storing it would need a job that is wrong between runs - an invoice reported
overdue the morning after it was paid is worse than one reported a day late.

The API returns both `status` (stored) and `displayStatus` (stored plus OVERDUE), so a screen can
show "partially paid, overdue" rather than losing one fact to show the other. `isOpenInvoice` and
`displayStatusFor` in `@bcis/domain` are the single definitions, and the Zod schema and the SQL
CHECK are written against the same list.

### 12.10 Money

Every amount is an integer number of centavos, end to end: `bigint` columns, branded `Centavos`
and `SignedCentavos`, and arithmetic in `@bcis/domain`. There is no `NUMERIC` anywhere in the
billing schema and no floating-point money. `adjustment_centavos` is the only signed column - it
is the net of debit and credit adjustments - and `total_centavos` is constrained non-negative
above it, so a net credit larger than the invoice cannot be written.

### 12.11 Penalties are opt-in and applied once (decision A4)

`billing.penalty_enabled` is false and `billing.penalty_rate_basis_points` is 0 in the seeded
settings, so the penalty run does nothing until an Owner decides otherwise. When it runs it skips
any invoice that already carries a penalty line, applies the rate to the outstanding balance in
basis points with half-up centavo rounding, and records the change as an adjustment row with
reason `LATE_FEE` plus a ledger debit. A penalty that compounds monthly turns a billing system
into a debt collector.

### 12.12 Known limitations at this phase

- **Payment state is structural.** `PARTIALLY_PAID`, `PAID` and `CREDITED` are valid stored states
  and payment posting can move `paid_centavos` and `balance_centavos`, but nothing in Phase 4
  writes them. Every seeded invoice is UNPAID.
- **A reconnection in an already-billed period is not billed automatically.** The fee is charged
  when a `RECONNECTED` event falls inside the period being generated. If the period was already
  billed, the fee is missed and an adjustment is the supported correction.
- **No proration (decision A3).** The first invoice charges the full monthly rate regardless of the
  activation date. Implementing proration is a change to `buildLines` in the generator.
- **VAT is unresolved (decision A1).** Plan prices are treated as VAT-inclusive and `tax_centavos`
  is a breakdown figure that does not change the total; it is 0 until confirmed.
- **Adjustments post directly.** There is no PENDING/APPROVED step; posting one requires
  `billing.adjust` and writes an audit entry. A two-step approval workflow is not built.
- **No AR aging.** The dashboard reports billing figures only. Aging buckets arrive in Phase 7.
