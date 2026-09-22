CREATE TABLE "collection_areas" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "collection_areas_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" bigint
);
--> statement-breakpoint
CREATE TABLE "document_sequences" (
	"scope" text NOT NULL,
	"period_year" integer NOT NULL,
	"prefix" text NOT NULL,
	"current_value" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_sequences_scope_period_year_pk" PRIMARY KEY("scope","period_year"),
	CONSTRAINT "ck_document_sequences_current_value" CHECK ("document_sequences"."current_value" >= 0)
);
--> statement-breakpoint
CREATE TABLE "service_accounts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "service_accounts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"account_number" text NOT NULL,
	"subscriber_id" bigint NOT NULL,
	"service_plan_id" bigint NOT NULL,
	"installation_address_id" bigint,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"activation_date" date,
	"billing_start_date" date NOT NULL,
	"billing_day" smallint DEFAULT 1 NOT NULL,
	"due_day" smallint DEFAULT 15 NOT NULL,
	"current_plan_price_centavos" bigint NOT NULL,
	"assigned_collector_id" bigint,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" bigint,
	CONSTRAINT "ck_service_accounts_status" CHECK ("service_accounts"."status" IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'DISCONNECTED', 'CLOSED')),
	CONSTRAINT "ck_service_accounts_billing_day" CHECK ("service_accounts"."billing_day" BETWEEN 1 AND 28),
	CONSTRAINT "ck_service_accounts_due_day" CHECK ("service_accounts"."due_day" BETWEEN 1 AND 28),
	CONSTRAINT "ck_service_accounts_price_non_negative" CHECK ("service_accounts"."current_plan_price_centavos" >= 0),
	CONSTRAINT "ck_service_accounts_activation" CHECK (("service_accounts"."status" = 'PENDING' AND "service_accounts"."activation_date" IS NULL)
          OR ("service_accounts"."status" <> 'PENDING' AND "service_accounts"."activation_date" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "service_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "service_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"service_account_id" bigint NOT NULL,
	"event_type" text NOT NULL,
	"from_value" text,
	"to_value" text,
	"effective_date" date NOT NULL,
	"reason" text,
	"actor_user_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_service_events_type" CHECK ("service_events"."event_type" IN (
        'ACTIVATED', 'STATUS_CHANGED', 'PLAN_CHANGED', 'RATE_APPLIED',
        'SUSPENDED', 'RECONNECTED', 'DISCONNECTED', 'CLOSED', 'TRANSFERRED',
        'ADDRESS_CHANGED', 'COLLECTOR_CHANGED', 'NOTE'
      ))
);
--> statement-breakpoint
CREATE TABLE "service_plans" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "service_plans_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"service_type_id" bigint NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"speed_mbps" integer,
	"channel_count" integer,
	"monthly_fee_centavos" bigint NOT NULL,
	"installation_fee_centavos" bigint DEFAULT 0 NOT NULL,
	"reconnection_fee_centavos" bigint DEFAULT 0 NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" bigint,
	CONSTRAINT "ck_service_plans_status" CHECK ("service_plans"."status" IN ('ACTIVE', 'RETIRED')),
	CONSTRAINT "ck_service_plans_amounts_non_negative" CHECK ("service_plans"."monthly_fee_centavos" >= 0 AND "service_plans"."installation_fee_centavos" >= 0 AND "service_plans"."reconnection_fee_centavos" >= 0),
	CONSTRAINT "ck_service_plans_speed" CHECK ("service_plans"."speed_mbps" IS NULL OR "service_plans"."speed_mbps" > 0),
	CONSTRAINT "ck_service_plans_channels" CHECK ("service_plans"."channel_count" IS NULL OR "service_plans"."channel_count" > 0),
	CONSTRAINT "ck_service_plans_effective_range" CHECK ("service_plans"."effective_to" IS NULL OR "service_plans"."effective_to" >= "service_plans"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "service_types" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "service_types_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_service_types_code" CHECK ("service_types"."code" IN ('INTERNET', 'CABLE', 'COMBO'))
);
--> statement-breakpoint
CREATE TABLE "subscriber_addresses" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "subscriber_addresses_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"subscriber_id" bigint NOT NULL,
	"address_type" text DEFAULT 'SERVICE' NOT NULL,
	"label" text,
	"line1" text NOT NULL,
	"line2" text,
	"barangay" text,
	"city_municipality" text,
	"province" text,
	"postal_code" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" bigint,
	CONSTRAINT "ck_subscriber_addresses_type" CHECK ("subscriber_addresses"."address_type" IN ('SERVICE', 'BILLING', 'MAILING'))
);
--> statement-breakpoint
CREATE TABLE "subscriber_contacts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "subscriber_contacts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"subscriber_id" bigint NOT NULL,
	"contact_type" text NOT NULL,
	"value" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" bigint,
	CONSTRAINT "ck_subscriber_contacts_type" CHECK ("subscriber_contacts"."contact_type" IN ('MOBILE', 'LANDLINE', 'EMAIL'))
);
--> statement-breakpoint
CREATE TABLE "subscribers" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "subscribers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"account_number" text NOT NULL,
	"display_name" text NOT NULL,
	"subscriber_type" text DEFAULT 'RESIDENTIAL' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"collection_area_id" bigint,
	"assigned_collector_id" bigint,
	"billing_day" smallint DEFAULT 1 NOT NULL,
	"due_day" smallint DEFAULT 15 NOT NULL,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" bigint,
	CONSTRAINT "ck_subscribers_type" CHECK ("subscribers"."subscriber_type" IN ('RESIDENTIAL', 'COMMERCIAL', 'GOVERNMENT')),
	CONSTRAINT "ck_subscribers_status" CHECK ("subscribers"."status" IN ('ACTIVE', 'INACTIVE', 'TERMINATED', 'ARCHIVED')),
	CONSTRAINT "ck_subscribers_billing_day" CHECK ("subscribers"."billing_day" BETWEEN 1 AND 28),
	CONSTRAINT "ck_subscribers_due_day" CHECK ("subscribers"."due_day" BETWEEN 1 AND 28)
);
--> statement-breakpoint
ALTER TABLE "service_accounts" ADD CONSTRAINT "service_accounts_subscriber_id_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."subscribers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_accounts" ADD CONSTRAINT "service_accounts_service_plan_id_service_plans_id_fk" FOREIGN KEY ("service_plan_id") REFERENCES "public"."service_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_accounts" ADD CONSTRAINT "service_accounts_installation_address_id_subscriber_addresses_id_fk" FOREIGN KEY ("installation_address_id") REFERENCES "public"."subscriber_addresses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_accounts" ADD CONSTRAINT "service_accounts_assigned_collector_id_users_id_fk" FOREIGN KEY ("assigned_collector_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_events" ADD CONSTRAINT "service_events_service_account_id_service_accounts_id_fk" FOREIGN KEY ("service_account_id") REFERENCES "public"."service_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_events" ADD CONSTRAINT "service_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_plans" ADD CONSTRAINT "service_plans_service_type_id_service_types_id_fk" FOREIGN KEY ("service_type_id") REFERENCES "public"."service_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriber_addresses" ADD CONSTRAINT "subscriber_addresses_subscriber_id_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."subscribers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriber_contacts" ADD CONSTRAINT "subscriber_contacts_subscriber_id_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."subscribers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscribers" ADD CONSTRAINT "subscribers_collection_area_id_collection_areas_id_fk" FOREIGN KEY ("collection_area_id") REFERENCES "public"."collection_areas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscribers" ADD CONSTRAINT "subscribers_assigned_collector_id_users_id_fk" FOREIGN KEY ("assigned_collector_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_collection_areas_code" ON "collection_areas" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_service_accounts_account_number" ON "service_accounts" USING btree ("account_number");--> statement-breakpoint
CREATE INDEX "ix_service_accounts_subscriber" ON "service_accounts" USING btree ("subscriber_id");--> statement-breakpoint
CREATE INDEX "ix_service_accounts_plan" ON "service_accounts" USING btree ("service_plan_id");--> statement-breakpoint
CREATE INDEX "ix_service_accounts_status" ON "service_accounts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ix_service_accounts_collector" ON "service_accounts" USING btree ("assigned_collector_id");--> statement-breakpoint
CREATE INDEX "ix_service_events_account" ON "service_events" USING btree ("service_account_id");--> statement-breakpoint
CREATE INDEX "ix_service_events_effective" ON "service_events" USING btree ("effective_date");--> statement-breakpoint
CREATE INDEX "ix_service_events_type" ON "service_events" USING btree ("event_type");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_service_plans_code_effective" ON "service_plans" USING btree ("code","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_service_plans_open_code" ON "service_plans" USING btree ("code") WHERE "service_plans"."effective_to" IS NULL;--> statement-breakpoint
CREATE INDEX "ix_service_plans_type" ON "service_plans" USING btree ("service_type_id");--> statement-breakpoint
CREATE INDEX "ix_service_plans_status" ON "service_plans" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_service_types_code" ON "service_types" USING btree ("code");--> statement-breakpoint
CREATE INDEX "ix_subscriber_addresses_subscriber" ON "subscriber_addresses" USING btree ("subscriber_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_subscriber_addresses_primary" ON "subscriber_addresses" USING btree ("subscriber_id","address_type") WHERE "subscriber_addresses"."is_primary";--> statement-breakpoint
CREATE INDEX "ix_subscriber_contacts_subscriber" ON "subscriber_contacts" USING btree ("subscriber_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_subscriber_contacts_primary" ON "subscriber_contacts" USING btree ("subscriber_id","contact_type") WHERE "subscriber_contacts"."is_primary";--> statement-breakpoint
CREATE UNIQUE INDEX "uq_subscribers_account_number" ON "subscribers" USING btree ("account_number");--> statement-breakpoint
CREATE INDEX "ix_subscribers_status" ON "subscribers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ix_subscribers_collection_area" ON "subscribers" USING btree ("collection_area_id");--> statement-breakpoint
CREATE INDEX "ix_subscribers_collector" ON "subscribers" USING btree ("assigned_collector_id");--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Search indexes (trigram).
--
-- Appended by hand because Drizzle's index DSL does not express an operator
-- class, and because the generator would treat a hand-written index as drift.
--
-- §21 targets 20,000 subscribers, and support staff search by partial name,
-- partial account number, partial phone number, and partial street. A
-- leading-wildcard LIKE (`ILIKE '%dela%'`) cannot use a B-tree index and
-- degrades to a sequential scan; GIN + pg_trgm keeps it indexed.
--
-- pg_trgm is enabled by the baseline migration, so these are safe here.
-- ---------------------------------------------------------------------------
CREATE INDEX "ix_subscribers_account_number_trgm"
  ON "subscribers" USING gin ("account_number" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "ix_subscribers_display_name_trgm"
  ON "subscribers" USING gin ("display_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "ix_subscriber_contacts_value_trgm"
  ON "subscriber_contacts" USING gin ("value" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "ix_subscriber_addresses_line1_trgm"
  ON "subscriber_addresses" USING gin ("line1" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "ix_subscriber_addresses_barangay_trgm"
  ON "subscriber_addresses" USING gin ("barangay" gin_trgm_ops);--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Service history immutability.
--
-- The same pattern as audit_logs (migration 0001). service_events is the record
-- of what happened to an account — when it was activated, suspended, repriced,
-- reconnected — and the question is asked months later. Allowing an UPDATE
-- would make "the history says X" an unverifiable claim.
--
-- This is broader than INV-9's explicit list (ledger_entries, audit_logs,
-- posted payment_allocations); it is the same defence applied to the one other
-- table whose whole purpose is to be a trustworthy log.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION deny_service_event_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'service_events is append-only';
END; $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER trg_service_events_no_update
  BEFORE UPDATE OR DELETE ON service_events
  FOR EACH ROW EXECUTE FUNCTION deny_service_event_mutation();