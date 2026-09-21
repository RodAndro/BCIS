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

| #      | Invariant                                                                                                  | Enforced by                                                  | Status              |
| ------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------- |
| INV-1  | `sum(payment_allocations.amount) <= invoice.total_centavos` for every invoice                              | Service transaction + integrity check                        | Phase 5             |
| INV-2  | `sum(allocations) + payment.unapplied_centavos = payment.amount_centavos`                                  | Service transaction + integrity check                        | Phase 5             |
| INV-3  | Account balance = `sum(debits) - sum(credits)` over ledger entries                                         | The ledger _is_ the derivation; no stored balance exists     | Phase 4             |
| INV-4  | Invoice caches (`paid_centavos`, `balance_centavos`) equal allocation-derived values                       | Integrity check rebuilds the cache from source and compares  | Phase 5             |
| INV-5  | At most one non-`VOID` invoice per `(service_account_id, billing_period_start)`                            | Partial unique index                                         | Phase 4             |
| INV-6  | Receipt numbers are unique; voided receipt numbers are never reissued                                      | Unique index + `receipts.status`, numbering reserved on void | Phase 5             |
| INV-7  | One ledger entry per `(source_type, source_id, entry_type)`                                                | Unique index — this is what makes posting idempotent         | Phase 4             |
| INV-8  | `remittance.variance = cash_collected - remitted_cash`; a non-zero value requires an approver and a reason | Service rule + close-blocker check                           | Phase 6             |
| INV-9  | No `UPDATE`/`DELETE` on `ledger_entries`, `audit_logs`, or posted `payment_allocations`                    | Database triggers that raise on mutation                     | Phase 2 / 4         |
| INV-10 | Aging bucket totals equal the total receivable                                                             | Integrity check                                              | Phase 7             |
| INV-11 | All money arithmetic is integer centavos; no float ever reaches a money column                             | Branded types, Zod coercion, `BIGINT` columns, ESLint rule   | **Phase 1 — built** |
| INV-12 | Invoice line prices equal the plan price effective at generation time                                      | Snapshot column; never joined live at read time              | Phase 4             |

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
variance = cashCollected - cashRemitted
```

- **Positive variance = SHORTAGE.** The collector is holding money the company has not
  received.
- **Negative variance = OVERAGE.**
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
