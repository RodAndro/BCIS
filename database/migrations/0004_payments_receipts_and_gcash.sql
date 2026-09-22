CREATE TABLE "payment_allocations" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_allocations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"payment_id" bigint NOT NULL,
	"invoice_id" bigint NOT NULL,
	"amount_centavos" bigint NOT NULL,
	"is_reversal" boolean DEFAULT false NOT NULL,
	"reverses_allocation_id" bigint,
	"is_manual" boolean DEFAULT false NOT NULL,
	"allocated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"allocated_by" bigint,
	CONSTRAINT "ck_payment_allocations_amount_positive" CHECK ("payment_allocations"."amount_centavos" > 0),
	CONSTRAINT "ck_payment_allocations_reversal_link" CHECK ("payment_allocations"."is_reversal" = ("payment_allocations"."reverses_allocation_id" IS NOT NULL)),
	CONSTRAINT "ck_payment_allocations_manual_not_reversal" CHECK (NOT "payment_allocations"."is_manual" OR NOT "payment_allocations"."is_reversal")
);
--> statement-breakpoint
CREATE TABLE "payment_proofs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_proofs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"payment_id" bigint NOT NULL,
	"file_path" text NOT NULL,
	"file_sha256" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"original_name" text NOT NULL,
	"uploaded_by" bigint,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_payment_proofs_size" CHECK ("payment_proofs"."byte_size" > 0),
	CONSTRAINT "ck_payment_proofs_mime" CHECK ("payment_proofs"."mime_type" IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
	CONSTRAINT "ck_payment_proofs_sha256" CHECK (length("payment_proofs"."file_sha256") = 64)
);
--> statement-breakpoint
CREATE TABLE "payment_reversals" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_reversals_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"original_payment_id" bigint NOT NULL,
	"reason_code" text NOT NULL,
	"reason" text NOT NULL,
	"amount_centavos" bigint NOT NULL,
	"reversed_by" bigint,
	"reversed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	CONSTRAINT "ck_payment_reversals_amount_positive" CHECK ("payment_reversals"."amount_centavos" > 0),
	CONSTRAINT "ck_payment_reversals_reason_code" CHECK ("payment_reversals"."reason_code" IN ('WRONG_AMOUNT', 'WRONG_SUBSCRIBER', 'DUPLICATE_ENTRY', 'DISHONOURED_CHEQUE', 'GCASH_REVERSED', 'UNAPPLIED_IN_ERROR', 'OTHER')),
	CONSTRAINT "ck_payment_reversals_reason_length" CHECK (length(btrim("payment_reversals"."reason")) >= 10)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"subscriber_id" bigint NOT NULL,
	"service_account_id" bigint NOT NULL,
	"payment_date" timestamp with time zone DEFAULT now() NOT NULL,
	"payment_method" text NOT NULL,
	"amount_centavos" bigint NOT NULL,
	"applied_centavos" bigint DEFAULT 0 NOT NULL,
	"unapplied_centavos" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'POSTED' NOT NULL,
	"reference_number" text,
	"sender_name" text,
	"sender_mobile" text,
	"notes" text,
	"duplicate_override_reason" text,
	"duplicate_override_by" bigint,
	"received_by" bigint,
	"verified_by" bigint,
	"verified_at" timestamp with time zone,
	"rejection_reason" text,
	"posted_at" timestamp with time zone,
	"reversed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" bigint,
	CONSTRAINT "ck_payments_amount_positive" CHECK ("payments"."amount_centavos" > 0),
	CONSTRAINT "ck_payments_amounts_non_negative" CHECK ("payments"."applied_centavos" >= 0 AND "payments"."unapplied_centavos" >= 0),
	CONSTRAINT "ck_payments_amount_split" CHECK (("payments"."status" IN ('PENDING_VERIFICATION', 'REJECTED')
            AND "payments"."applied_centavos" = 0 AND "payments"."unapplied_centavos" = 0)
          OR ("payments"."status" IN ('POSTED', 'REVERSED')
            AND "payments"."applied_centavos" + "payments"."unapplied_centavos" = "payments"."amount_centavos")),
	CONSTRAINT "ck_payments_status" CHECK ("payments"."status" IN ('PENDING_VERIFICATION', 'POSTED', 'REJECTED', 'REVERSED')),
	CONSTRAINT "ck_payments_method" CHECK ("payments"."payment_method" IN ('CASH', 'GCASH', 'BANK_TRANSFER', 'CHEQUE', 'OTHER')),
	CONSTRAINT "ck_payments_posted_at" CHECK (("payments"."status" IN ('PENDING_VERIFICATION', 'REJECTED') AND "payments"."posted_at" IS NULL)
          OR ("payments"."status" IN ('POSTED', 'REVERSED') AND "payments"."posted_at" IS NOT NULL)),
	CONSTRAINT "ck_payments_rejected_reason" CHECK ("payments"."status" <> 'REJECTED' OR "payments"."rejection_reason" IS NOT NULL),
	CONSTRAINT "ck_payments_reversed_at" CHECK ("payments"."status" <> 'REVERSED' OR "payments"."reversed_at" IS NOT NULL),
	CONSTRAINT "ck_payments_verified_at" CHECK ("payments"."status" NOT IN ('POSTED', 'REVERSED')
          OR "payments"."verified_by" IS NOT NULL
          OR "payments"."payment_method" NOT IN ('GCASH', 'BANK_TRANSFER')),
	CONSTRAINT "ck_payments_reference_required" CHECK ("payments"."payment_method" NOT IN ('GCASH', 'BANK_TRANSFER')
          OR ("payments"."reference_number" IS NOT NULL AND length(btrim("payments"."reference_number")) > 0)),
	CONSTRAINT "ck_payments_duplicate_override" CHECK (num_nonnulls("payments"."duplicate_override_reason", "payments"."duplicate_override_by") IN (0, 2)),
	CONSTRAINT "ck_payments_notes_not_blank" CHECK ("payments"."notes" IS NULL OR length(btrim("payments"."notes")) > 0)
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "receipts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"receipt_number" text NOT NULL,
	"payment_id" bigint NOT NULL,
	"status" text DEFAULT 'ISSUED' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" bigint,
	"void_reason" text,
	"printed_count" integer DEFAULT 0 NOT NULL,
	"last_printed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" bigint,
	CONSTRAINT "ck_receipts_status" CHECK ("receipts"."status" IN ('ISSUED', 'VOID')),
	CONSTRAINT "ck_receipts_void_reason" CHECK ("receipts"."status" <> 'VOID' OR ("receipts"."void_reason" IS NOT NULL AND "receipts"."voided_at" IS NOT NULL)),
	CONSTRAINT "ck_receipts_printed_count" CHECK ("receipts"."printed_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_reverses_allocation_id_payment_allocations_id_fk" FOREIGN KEY ("reverses_allocation_id") REFERENCES "public"."payment_allocations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_proofs" ADD CONSTRAINT "payment_proofs_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_proofs" ADD CONSTRAINT "payment_proofs_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reversals" ADD CONSTRAINT "payment_reversals_original_payment_id_payments_id_fk" FOREIGN KEY ("original_payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reversals" ADD CONSTRAINT "payment_reversals_reversed_by_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscriber_id_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."subscribers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_service_account_id_service_accounts_id_fk" FOREIGN KEY ("service_account_id") REFERENCES "public"."service_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_duplicate_override_by_users_id_fk" FOREIGN KEY ("duplicate_override_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payment_allocations_active" ON "payment_allocations" USING btree ("payment_id","invoice_id") WHERE NOT "payment_allocations"."is_reversal";--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payment_allocations_reversal" ON "payment_allocations" USING btree ("reverses_allocation_id");--> statement-breakpoint
CREATE INDEX "ix_payment_allocations_payment" ON "payment_allocations" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "ix_payment_allocations_invoice" ON "payment_allocations" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "ix_payment_proofs_payment" ON "payment_proofs" USING btree ("payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payment_proofs_hash" ON "payment_proofs" USING btree ("payment_id","file_sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payment_reversals_payment" ON "payment_reversals" USING btree ("original_payment_id");--> statement-breakpoint
CREATE INDEX "ix_payment_reversals_date" ON "payment_reversals" USING btree ("reversed_at");--> statement-breakpoint
CREATE INDEX "ix_payments_subscriber" ON "payments" USING btree ("subscriber_id");--> statement-breakpoint
CREATE INDEX "ix_payments_account" ON "payments" USING btree ("service_account_id");--> statement-breakpoint
CREATE INDEX "ix_payments_status" ON "payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ix_payments_date" ON "payments" USING btree ("payment_date");--> statement-breakpoint
CREATE INDEX "ix_payments_method" ON "payments" USING btree ("payment_method");--> statement-breakpoint
CREATE INDEX "ix_payments_reference" ON "payments" USING btree ("reference_number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payments_gcash_reference" ON "payments" USING btree (upper(btrim("reference_number"))) WHERE "payments"."payment_method" = 'GCASH'
            AND "payments"."status" NOT IN ('REJECTED', 'REVERSED')
            AND "payments"."duplicate_override_reason" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_receipts_number" ON "receipts" USING btree ("receipt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_receipts_payment" ON "receipts" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "ix_receipts_status" ON "receipts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ix_receipts_issued" ON "receipts" USING btree ("issued_at");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 1. A posted allocation is append-only (INV-9).
--
-- Allocations are the evidence of where a customer's money went, so they are
-- the second thing an operator with database access would edit to make a
-- shortage disappear. Reversing a payment does NOT delete them: it inserts
-- mirror rows that point at the allocation they undo, and the effective
-- allocation becomes the sum of the two. That is why this trigger can afford to
-- be absolute — no legitimate operation needs to change one of these rows.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION deny_payment_allocation_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'Payment allocations are append-only. Reverse the payment instead of editing where its money went.';
END; $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER trg_payment_allocations_append_only
  BEFORE UPDATE OR DELETE ON payment_allocations
  FOR EACH ROW EXECUTE FUNCTION deny_payment_allocation_mutation();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. A posted payment is immutable except for the fields its lifecycle moves.
--
-- The rule INV-9 states: a posted financial document is never edited. What is
-- still writable is exactly what verification, reversal and printing need —
-- the status and its timestamps, the verifier, the rejection reason, and the
-- print counter. Everything that says what the payment WAS (amount, method,
-- date, subscriber, account, reference) is frozen.
--
-- The amount is frozen even for an unposted GCash payment, deliberately: the
-- figure a customer's screenshot stated should not be editable after the fact
-- to match what a verifier decided. Reject it and take a new one.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_payment_field_freeze() RETURNS trigger AS $$
BEGIN
  IF NEW.amount_centavos   <> OLD.amount_centavos
     OR NEW.payment_method <> OLD.payment_method
     OR NEW.payment_date   <> OLD.payment_date
     OR NEW.subscriber_id  <> OLD.subscriber_id
     OR NEW.service_account_id <> OLD.service_account_id
     OR NEW.reference_number IS DISTINCT FROM OLD.reference_number THEN
    RAISE EXCEPTION
      'A payment''s amount, method, date, subscriber, account and reference cannot be changed. Reverse it or reject it instead.';
  END IF;

  RETURN NEW;
END; $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER trg_payments_field_freeze
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION enforce_payment_field_freeze();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. A payment can never be deleted.
--
-- A receipt in a customer's hand must always answer to a row. Deleting a
-- payment would leave the receipt, the allocation and the ledger credit
-- pointing at nothing, and would be the quietest way to make money disappear.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION deny_payment_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'A payment cannot be deleted. Reverse it, which preserves it and links the reversal to it.';
END; $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER trg_payments_no_delete
  BEFORE DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION deny_payment_delete();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. A receipt number is never reused and an issued receipt is never edited.
--
-- The number is the thing a customer quotes when they call, so it must resolve
-- to the same document forever. The only change an issued receipt accepts is
-- being voided, together with the print counter — and the void route is the
-- payment reversal, which supplies the reason.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_receipt_immutability() RETURNS trigger AS $$
BEGIN
  IF NEW.receipt_number <> OLD.receipt_number THEN
    RAISE EXCEPTION 'A receipt number cannot be changed once issued';
  END IF;

  IF NEW.payment_id <> OLD.payment_id THEN
    RAISE EXCEPTION 'A receipt cannot be moved to a different payment';
  END IF;

  IF OLD.status = 'VOID' AND NEW.status <> 'VOID' THEN
    RAISE EXCEPTION 'A voided receipt cannot be reinstated';
  END IF;

  RETURN NEW;
END; $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER trg_receipts_immutable
  BEFORE UPDATE ON receipts
  FOR EACH ROW EXECUTE FUNCTION enforce_receipt_immutability();--> statement-breakpoint
CREATE OR REPLACE FUNCTION deny_receipt_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'A receipt cannot be deleted. Its number stays reserved and its history stays readable.';
END; $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER trg_receipts_no_delete
  BEFORE DELETE ON receipts
  FOR EACH ROW EXECUTE FUNCTION deny_receipt_delete();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. A reversal is final.
--
-- It is the counter-entry that undid a payment, so it must not be editable or
-- removable — otherwise the ledger would show a credit reversed by a document
-- that no longer exists.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION deny_reversal_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'A payment reversal is final and cannot be changed or deleted';
END; $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER trg_payment_reversals_immutable
  BEFORE UPDATE OR DELETE ON payment_reversals
  FOR EACH ROW EXECUTE FUNCTION deny_reversal_mutation();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 6. A payment proof is evidence and is not silently replaceable.
--
-- Deleting one is refused so that the screenshot supporting a verification
-- cannot be removed after the fact, leaving a verified payment with no
-- justification on file.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION deny_proof_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'A payment proof cannot be deleted; it is part of the verification record';
END; $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER trg_payment_proofs_no_delete
  BEFORE DELETE ON payment_proofs
  FOR EACH ROW EXECUTE FUNCTION deny_proof_delete();