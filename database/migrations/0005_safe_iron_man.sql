CREATE TABLE "collection_assignments" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "collection_assignments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"collection_area_id" bigint NOT NULL,
	"collector_user_id" bigint NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" bigint,
	CONSTRAINT "ck_collection_assignments_range" CHECK ("collection_assignments"."effective_to" IS NULL OR "collection_assignments"."effective_to" >= "collection_assignments"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "collection_batch_accounts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "collection_batch_accounts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"batch_id" bigint NOT NULL,
	"service_account_id" bigint NOT NULL,
	"expected_amount_centavos" bigint DEFAULT 0 NOT NULL,
	"collected_amount_centavos" bigint DEFAULT 0 NOT NULL,
	"outcome" text DEFAULT 'COLLECTED' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" bigint,
	CONSTRAINT "ck_collection_batch_accounts_outcome" CHECK ("collection_batch_accounts"."outcome" IN ('COLLECTED', 'PARTIAL', 'PROMISE_TO_PAY', 'NOT_HOME', 'REFUSED', 'CLOSED')),
	CONSTRAINT "ck_collection_batch_accounts_amounts" CHECK ("collection_batch_accounts"."expected_amount_centavos" >= 0 AND "collection_batch_accounts"."collected_amount_centavos" >= 0)
);
--> statement-breakpoint
CREATE TABLE "collection_batches" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "collection_batches_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"batch_number" text NOT NULL,
	"collector_user_id" bigint NOT NULL,
	"collection_area_id" bigint NOT NULL,
	"batch_date" date NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"expected_receivable_centavos" bigint DEFAULT 0 NOT NULL,
	"cash_collected_centavos" bigint DEFAULT 0 NOT NULL,
	"non_cash_collected_centavos" bigint DEFAULT 0 NOT NULL,
	"uncollected_centavos" bigint DEFAULT 0 NOT NULL,
	"remitted_cash_centavos" bigint DEFAULT 0 NOT NULL,
	"shortage_centavos" bigint DEFAULT 0 NOT NULL,
	"overage_centavos" bigint DEFAULT 0 NOT NULL,
	"submitted_at" timestamp with time zone,
	"reconciled_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" bigint,
	CONSTRAINT "ck_collection_batches_status" CHECK ("collection_batches"."status" IN ('OPEN', 'IN_PROGRESS', 'SUBMITTED', 'REMITTED', 'RECONCILED', 'CLOSED')),
	CONSTRAINT "ck_collection_batches_non_negative" CHECK ("collection_batches"."expected_receivable_centavos" >= 0
        AND "collection_batches"."cash_collected_centavos" >= 0
        AND "collection_batches"."non_cash_collected_centavos" >= 0
        AND "collection_batches"."uncollected_centavos" >= 0
        AND "collection_batches"."remitted_cash_centavos" >= 0
        AND "collection_batches"."shortage_centavos" >= 0
        AND "collection_batches"."overage_centavos" >= 0)
);
--> statement-breakpoint
CREATE TABLE "collection_reconciliations" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "collection_reconciliations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"batch_id" bigint NOT NULL,
	"reconciler_user_id" bigint NOT NULL,
	"reconciled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expected_cash_centavos" bigint DEFAULT 0 NOT NULL,
	"actual_cash_centavos" bigint DEFAULT 0 NOT NULL,
	"difference_centavos" bigint DEFAULT 0 NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_collection_reconciliations_amounts" CHECK ("collection_reconciliations"."expected_cash_centavos" >= 0 AND "collection_reconciliations"."actual_cash_centavos" >= 0)
);
--> statement-breakpoint
CREATE TABLE "collector_remittances" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "collector_remittances_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"batch_id" bigint NOT NULL,
	"remitted_cash_centavos" bigint DEFAULT 0 NOT NULL,
	"variance_centavos" bigint DEFAULT 0 NOT NULL,
	"variance_type" text DEFAULT 'BALANCED' NOT NULL,
	"remitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_by" bigint,
	"resolution_notes" text,
	"approved_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" bigint,
	CONSTRAINT "collector_remittances_batch_id_unique" UNIQUE("batch_id"),
	CONSTRAINT "ck_collector_remittances_variance_type" CHECK ("collector_remittances"."variance_type" IN ('BALANCED', 'SHORTAGE', 'OVERAGE')),
	CONSTRAINT "ck_collector_remittances_amounts" CHECK ("collector_remittances"."remitted_cash_centavos" >= 0 AND "collector_remittances"."variance_centavos" >= -9223372036854775807)
);
--> statement-breakpoint
ALTER TABLE "collection_assignments" ADD CONSTRAINT "collection_assignments_collection_area_id_collection_areas_id_fk" FOREIGN KEY ("collection_area_id") REFERENCES "public"."collection_areas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_assignments" ADD CONSTRAINT "collection_assignments_collector_user_id_users_id_fk" FOREIGN KEY ("collector_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_batch_accounts" ADD CONSTRAINT "collection_batch_accounts_batch_id_collection_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."collection_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_batch_accounts" ADD CONSTRAINT "collection_batch_accounts_service_account_id_service_accounts_id_fk" FOREIGN KEY ("service_account_id") REFERENCES "public"."service_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_batches" ADD CONSTRAINT "collection_batches_collector_user_id_users_id_fk" FOREIGN KEY ("collector_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_batches" ADD CONSTRAINT "collection_batches_collection_area_id_collection_areas_id_fk" FOREIGN KEY ("collection_area_id") REFERENCES "public"."collection_areas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_reconciliations" ADD CONSTRAINT "collection_reconciliations_batch_id_collection_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."collection_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_reconciliations" ADD CONSTRAINT "collection_reconciliations_reconciler_user_id_users_id_fk" FOREIGN KEY ("reconciler_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collector_remittances" ADD CONSTRAINT "collector_remittances_batch_id_collection_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."collection_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collector_remittances" ADD CONSTRAINT "collector_remittances_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collector_remittances" ADD CONSTRAINT "collector_remittances_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_collection_assignments_area" ON "collection_assignments" USING btree ("collection_area_id");--> statement-breakpoint
CREATE INDEX "ix_collection_assignments_collector" ON "collection_assignments" USING btree ("collector_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_collection_assignments_active" ON "collection_assignments" USING btree ("collection_area_id","collector_user_id") WHERE "collection_assignments"."effective_to" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_collection_batch_accounts" ON "collection_batch_accounts" USING btree ("batch_id","service_account_id");--> statement-breakpoint
CREATE INDEX "ix_collection_batch_accounts_batch" ON "collection_batch_accounts" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "ix_collection_batch_accounts_account" ON "collection_batch_accounts" USING btree ("service_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_collection_batches_number" ON "collection_batches" USING btree ("batch_number");--> statement-breakpoint
CREATE INDEX "ix_collection_batches_collector" ON "collection_batches" USING btree ("collector_user_id");--> statement-breakpoint
CREATE INDEX "ix_collection_batches_area" ON "collection_batches" USING btree ("collection_area_id");--> statement-breakpoint
CREATE INDEX "ix_collection_batches_status" ON "collection_batches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ix_collection_batches_date" ON "collection_batches" USING btree ("batch_date");--> statement-breakpoint
CREATE INDEX "ix_collection_reconciliations_batch" ON "collection_reconciliations" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "ix_collection_reconciliations_reconciler" ON "collection_reconciliations" USING btree ("reconciler_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_collection_reconciliations_batch" ON "collection_reconciliations" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "ix_collector_remittances_batch" ON "collector_remittances" USING btree ("batch_id");