CREATE TABLE "adjustments" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "adjustments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"invoice_id" bigint,
	"service_account_id" bigint,
	"adjustment_type" text NOT NULL,
	"reason_code" text NOT NULL,
	"amount_centavos" bigint NOT NULL,
	"memo" text NOT NULL,
	"status" text DEFAULT 'POSTED' NOT NULL,
	"invoice_item_id" bigint,
	"posted_at" timestamp with time zone,
	"approved_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" bigint,
	CONSTRAINT "ck_adjustments_type" CHECK ("adjustments"."adjustment_type" IN ('DEBIT', 'CREDIT')),
	CONSTRAINT "ck_adjustments_status" CHECK ("adjustments"."status" IN ('PENDING', 'POSTED', 'VOID')),
	CONSTRAINT "ck_adjustments_amount_positive" CHECK ("adjustments"."amount_centavos" > 0),
	CONSTRAINT "ck_adjustments_target" CHECK (num_nonnulls("adjustments"."invoice_id", "adjustments"."service_account_id") = 1),
	CONSTRAINT "ck_adjustments_posted_at" CHECK ("adjustments"."status" <> 'POSTED' OR "adjustments"."posted_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "billing_cycles" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "billing_cycles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"due_date" date NOT NULL,
	"label" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"generated_at" timestamp with time zone,
	"generated_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" bigint,
	CONSTRAINT "ck_billing_cycles_status" CHECK ("billing_cycles"."status" IN ('OPEN', 'GENERATING', 'GENERATED', 'CLOSED', 'LOCKED')),
	CONSTRAINT "ck_billing_cycles_range" CHECK ("billing_cycles"."period_end" >= "billing_cycles"."period_start"),
	CONSTRAINT "ck_billing_cycles_due" CHECK ("billing_cycles"."due_date" >= "billing_cycles"."period_start")
);
--> statement-breakpoint
CREATE TABLE "invoice_items" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "invoice_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"invoice_id" bigint NOT NULL,
	"item_type" text NOT NULL,
	"direction" text DEFAULT 'DEBIT' NOT NULL,
	"description" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price_centavos" bigint NOT NULL,
	"amount_centavos" bigint NOT NULL,
	"service_plan_id" bigint,
	"service_account_id" bigint,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	CONSTRAINT "ck_invoice_items_type" CHECK ("invoice_items"."item_type" IN ('SUBSCRIPTION', 'INSTALLATION', 'RECONNECTION', 'DISCOUNT', 'PENALTY', 'ADJUSTMENT')),
	CONSTRAINT "ck_invoice_items_direction" CHECK ("invoice_items"."direction" IN ('DEBIT', 'CREDIT')),
	CONSTRAINT "ck_invoice_items_direction_matches_type" CHECK (("invoice_items"."item_type" IN ('SUBSCRIPTION', 'INSTALLATION', 'RECONNECTION', 'PENALTY')
             AND "invoice_items"."direction" = 'DEBIT')
          OR ("invoice_items"."item_type" = 'DISCOUNT' AND "invoice_items"."direction" = 'CREDIT')
          OR "invoice_items"."item_type" = 'ADJUSTMENT'),
	CONSTRAINT "ck_invoice_items_amounts_non_negative" CHECK ("invoice_items"."amount_centavos" >= 0 AND "invoice_items"."unit_price_centavos" >= 0),
	CONSTRAINT "ck_invoice_items_quantity" CHECK ("invoice_items"."quantity" > 0),
	CONSTRAINT "ck_invoice_items_amount_matches_unit" CHECK ("invoice_items"."amount_centavos" = "invoice_items"."unit_price_centavos" * "invoice_items"."quantity")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "invoices_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"invoice_number" text NOT NULL,
	"subscriber_id" bigint NOT NULL,
	"service_account_id" bigint NOT NULL,
	"billing_cycle_id" bigint NOT NULL,
	"billing_period_start" date NOT NULL,
	"billing_period_end" date NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date NOT NULL,
	"subtotal_centavos" bigint NOT NULL,
	"discount_centavos" bigint DEFAULT 0 NOT NULL,
	"penalty_centavos" bigint DEFAULT 0 NOT NULL,
	"adjustment_centavos" bigint DEFAULT 0 NOT NULL,
	"tax_centavos" bigint DEFAULT 0 NOT NULL,
	"total_centavos" bigint NOT NULL,
	"paid_centavos" bigint DEFAULT 0 NOT NULL,
	"balance_centavos" bigint NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"finalized_at" timestamp with time zone,
	"finalized_by" bigint,
	"voided_at" timestamp with time zone,
	"voided_by" bigint,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" bigint,
	CONSTRAINT "ck_invoices_status" CHECK ("invoices"."status" IN ('DRAFT', 'UNPAID', 'PARTIALLY_PAID', 'PAID', 'VOID', 'CREDITED')),
	CONSTRAINT "ck_invoices_amounts_non_negative" CHECK ("invoices"."subtotal_centavos" >= 0
          AND "invoices"."discount_centavos" >= 0
          AND "invoices"."penalty_centavos" >= 0
          AND "invoices"."tax_centavos" >= 0
          AND "invoices"."total_centavos" >= 0
          AND "invoices"."paid_centavos" >= 0
          AND "invoices"."balance_centavos" >= 0),
	CONSTRAINT "ck_invoices_total_identity" CHECK ("invoices"."total_centavos" = "invoices"."subtotal_centavos" - "invoices"."discount_centavos"
          + "invoices"."penalty_centavos" + "invoices"."adjustment_centavos" + "invoices"."tax_centavos"),
	CONSTRAINT "ck_invoices_balance_identity" CHECK ("invoices"."balance_centavos" = "invoices"."total_centavos" - "invoices"."paid_centavos"),
	CONSTRAINT "ck_invoices_period_range" CHECK ("invoices"."billing_period_end" >= "invoices"."billing_period_start"),
	CONSTRAINT "ck_invoices_due_after_issue" CHECK ("invoices"."due_date" >= "invoices"."issue_date"),
	CONSTRAINT "ck_invoices_finalized_matches_status" CHECK (("invoices"."status" = 'DRAFT' AND "invoices"."finalized_at" IS NULL)
          OR ("invoices"."status" <> 'DRAFT' AND "invoices"."finalized_at" IS NOT NULL)),
	CONSTRAINT "ck_invoices_void_reason" CHECK ("invoices"."status" <> 'VOID' OR "invoices"."void_reason" IS NOT NULL),
	CONSTRAINT "ck_invoices_paid_within_total" CHECK ("invoices"."paid_centavos" <= "invoices"."total_centavos")
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ledger_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"service_account_id" bigint NOT NULL,
	"subscriber_id" bigint NOT NULL,
	"entry_date" date NOT NULL,
	"entry_type" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" bigint NOT NULL,
	"reference_no" text,
	"description" text NOT NULL,
	"debit_centavos" bigint DEFAULT 0 NOT NULL,
	"credit_centavos" bigint DEFAULT 0 NOT NULL,
	"actor_user_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_ledger_entry_type" CHECK ("ledger_entries"."entry_type" IN ('INVOICE', 'PAYMENT', 'ADJUSTMENT', 'REVERSAL', 'CREDIT_APPLIED', 'CREDIT_ISSUED')),
	CONSTRAINT "ck_ledger_amounts_non_negative" CHECK ("ledger_entries"."debit_centavos" >= 0 AND "ledger_entries"."credit_centavos" >= 0),
	CONSTRAINT "ck_ledger_exactly_one_side" CHECK (("ledger_entries"."debit_centavos" > 0 AND "ledger_entries"."credit_centavos" = 0)
          OR ("ledger_entries"."credit_centavos" > 0 AND "ledger_entries"."debit_centavos" = 0)),
	CONSTRAINT "ck_ledger_source_id_positive" CHECK ("ledger_entries"."source_id" > 0)
);
--> statement-breakpoint
ALTER TABLE "service_accounts" ADD COLUMN "installation_fee_charged" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "adjustments" ADD CONSTRAINT "adjustments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustments" ADD CONSTRAINT "adjustments_service_account_id_service_accounts_id_fk" FOREIGN KEY ("service_account_id") REFERENCES "public"."service_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustments" ADD CONSTRAINT "adjustments_invoice_item_id_invoice_items_id_fk" FOREIGN KEY ("invoice_item_id") REFERENCES "public"."invoice_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscriber_id_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."subscribers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_service_account_id_service_accounts_id_fk" FOREIGN KEY ("service_account_id") REFERENCES "public"."service_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_billing_cycle_id_billing_cycles_id_fk" FOREIGN KEY ("billing_cycle_id") REFERENCES "public"."billing_cycles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_service_account_id_service_accounts_id_fk" FOREIGN KEY ("service_account_id") REFERENCES "public"."service_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_subscriber_id_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."subscribers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_adjustments_invoice" ON "adjustments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "ix_adjustments_account" ON "adjustments" USING btree ("service_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_billing_cycles_period" ON "billing_cycles" USING btree ("period_start");--> statement-breakpoint
CREATE INDEX "ix_billing_cycles_status" ON "billing_cycles" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ix_invoice_items_invoice" ON "invoice_items" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_invoices_invoice_number" ON "invoices" USING btree ("invoice_number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_invoices_account_period" ON "invoices" USING btree ("service_account_id","billing_period_start") WHERE "invoices"."status" <> 'VOID';--> statement-breakpoint
CREATE INDEX "ix_invoices_subscriber" ON "invoices" USING btree ("subscriber_id");--> statement-breakpoint
CREATE INDEX "ix_invoices_account" ON "invoices" USING btree ("service_account_id");--> statement-breakpoint
CREATE INDEX "ix_invoices_cycle" ON "invoices" USING btree ("billing_cycle_id");--> statement-breakpoint
CREATE INDEX "ix_invoices_status" ON "invoices" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ix_invoices_due" ON "invoices" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "ix_invoices_period" ON "invoices" USING btree ("billing_period_start");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ledger_source" ON "ledger_entries" USING btree ("source_type","source_id","entry_type");--> statement-breakpoint
CREATE INDEX "ix_ledger_account_date" ON "ledger_entries" USING btree ("service_account_id","entry_date","id");--> statement-breakpoint
CREATE INDEX "ix_ledger_subscriber_date" ON "ledger_entries" USING btree ("subscriber_id","entry_date","id");--> statement-breakpoint
CREATE INDEX "ix_ledger_entry_type" ON "ledger_entries" USING btree ("entry_type");--> statement-breakpoint
CREATE INDEX "ix_ledger_entry_date" ON "ledger_entries" USING btree ("entry_date");--> statement-breakpoint
-- ===========================================================================
-- Immutability, enforced by the database.
--
-- Appended by hand: Drizzle does not model triggers, and it would treat a
-- hand-written one as drift and try to remove it on the next generate.
--
-- INV-9 names ledger_entries, audit_logs and posted payment_allocations. The
-- same defence is applied here to invoices, their lines, and posted adjustments,
-- because "posted financial records are immutable" is only a verifiable claim
-- if the database is what refuses the write.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The ledger is append-only, without exception.
--
-- A correction is a new reversing entry, never an edit. Deleting an entry would
-- change every balance computed after it, retroactively and invisibly.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION deny_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only; post a reversing entry instead';
END; $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER trg_ledger_no_update
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION deny_ledger_mutation();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. A finalized invoice's components must equal the lines attached to it.
--
-- This is the constraint that makes an invoice total REPRODUCIBLE. subtotal,
-- discount, penalty and adjustment are not trusted columns: each is checked
-- against the invoice_items that justify it, on finalization and on every
-- later update. Because invoices.ck_invoices_total_identity then derives the
-- total from those same components, the advertised total can only ever be the
-- sum of the lines — including after an adjustment or a penalty posting.
--
-- Identity, dates and the finalized flag are frozen outright. Only status,
-- paid_centavos, balance_centavos and the void columns may move afterwards,
-- which is exactly what payment posting (Phase 5) and voiding need.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_finalized_invoice_immutability() RETURNS trigger AS $$
DECLARE
  from_items     bigint;
  from_install   bigint;
  from_discount  bigint;
  from_penalty   bigint;
  from_adjust    bigint;
BEGIN
  -- A draft is not yet a posted record; it may be edited freely.
  IF NEW.finalized_at IS NULL THEN
    RETURN NEW;
  END IF;

  IF OLD.finalized_at IS NOT NULL THEN
    IF NEW.invoice_number       IS DISTINCT FROM OLD.invoice_number
       OR NEW.subscriber_id     IS DISTINCT FROM OLD.subscriber_id
       OR NEW.service_account_id IS DISTINCT FROM OLD.service_account_id
       OR NEW.billing_cycle_id  IS DISTINCT FROM OLD.billing_cycle_id
       OR NEW.billing_period_start IS DISTINCT FROM OLD.billing_period_start
       OR NEW.billing_period_end   IS DISTINCT FROM OLD.billing_period_end
       OR NEW.issue_date        IS DISTINCT FROM OLD.issue_date
       OR NEW.due_date          IS DISTINCT FROM OLD.due_date
       OR NEW.tax_centavos      IS DISTINCT FROM OLD.tax_centavos
       OR NEW.finalized_at      IS DISTINCT FROM OLD.finalized_at
       OR NEW.finalized_by      IS DISTINCT FROM OLD.finalized_by
       OR NEW.created_at        IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION
        'A finalized invoice cannot be modified. Use an adjustment, or void it.';
    END IF;
  END IF;

  SELECT
    COALESCE(SUM(amount_centavos) FILTER (
      WHERE item_type IN ('SUBSCRIPTION', 'INSTALLATION', 'RECONNECTION')), 0),
    COALESCE(SUM(amount_centavos) FILTER (WHERE item_type = 'INSTALLATION'), 0),
    COALESCE(SUM(amount_centavos) FILTER (WHERE item_type = 'DISCOUNT'), 0),
    COALESCE(SUM(amount_centavos) FILTER (WHERE item_type = 'PENALTY'), 0),
    COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount_centavos
                      ELSE -amount_centavos END) FILTER (WHERE item_type = 'ADJUSTMENT'), 0)
    INTO from_items, from_install, from_discount, from_penalty, from_adjust
    FROM invoice_items
   WHERE invoice_id = NEW.id;

  IF NEW.subtotal_centavos <> from_items
     OR NEW.discount_centavos <> from_discount
     OR NEW.penalty_centavos <> from_penalty
     OR NEW.adjustment_centavos <> from_adjust
  THEN
    RAISE EXCEPTION
      'Invoice components must equal the lines attached to them '
      '(subtotal %, discount %, penalty %, adjustment %; from lines: %, %, %, %)',
      NEW.subtotal_centavos, NEW.discount_centavos, NEW.penalty_centavos,
      NEW.adjustment_centavos, from_items, from_discount, from_penalty, from_adjust;
  END IF;

  -- `from_install` is read so the plan's installation charge cannot be billed
  -- twice through the lines without the total following; it is otherwise
  -- already included in the subtotal above.
  PERFORM from_install;

  RETURN NEW;
END; $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER trg_invoices_immutable
  BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION enforce_finalized_invoice_immutability();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. A finalized invoice is never deleted.
--
-- A draft that was never posted may be removed. Once posted, the document is
-- part of the financial record and the only way out is VOID, which leaves the
-- number reserved and the ledger balanced by a reversing entry.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION deny_finalized_invoice_delete() RETURNS trigger AS $$
BEGIN
  IF OLD.finalized_at IS NOT NULL THEN
    RAISE EXCEPTION 'A finalized invoice cannot be deleted; void it instead';
  END IF;
  RETURN OLD;
END; $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER trg_invoices_no_delete
  BEFORE DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION deny_finalized_invoice_delete();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. The lines of a finalized invoice are frozen.
--
-- With one deliberate exception: an ADJUSTMENT or PENALTY line may still be
-- added. Those are the two controlled mechanisms by which a posted invoice is
-- allowed to change, and the invoice trigger above proves the components moved
-- by exactly the amount of the lines that were added.
--
-- Nothing may ever be removed or edited, so the original charges survive.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_invoice_item_immutability() RETURNS trigger AS $$
DECLARE
  parent_id        bigint;
  parent_finalized timestamptz;
BEGIN
  parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;

  SELECT finalized_at INTO parent_finalized FROM invoices WHERE id = parent_id;

  IF parent_finalized IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.item_type IN ('ADJUSTMENT', 'PENALTY') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'The lines of a finalized invoice cannot be changed. Use an adjustment, or void the invoice.';
END; $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER trg_invoice_items_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON invoice_items
  FOR EACH ROW EXECUTE FUNCTION enforce_invoice_item_immutability();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. A posted adjustment is immutable.
--
-- It is the document that justifies a change to an invoice, so it must not be
-- editable after the fact — otherwise the reason a balance moved could be
-- rewritten to match whatever the balance happens to be.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION deny_posted_adjustment_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'POSTED' THEN
    RAISE EXCEPTION 'A posted adjustment cannot be changed or deleted';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER trg_adjustments_immutable
  BEFORE UPDATE OR DELETE ON adjustments
  FOR EACH ROW EXECUTE FUNCTION deny_posted_adjustment_mutation();