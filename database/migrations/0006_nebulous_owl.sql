CREATE TABLE "reconnection_records" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "reconnection_records_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"service_account_id" bigint NOT NULL,
	"request_date" date NOT NULL,
	"qualifying_payment_id" bigint,
	"reconnection_fee_centavos" bigint DEFAULT 0 NOT NULL,
	"technician_user_id" bigint,
	"completion_date" date,
	"status" text DEFAULT 'REQUESTED' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" bigint,
	CONSTRAINT "ck_reconnection_records_status" CHECK ("reconnection_records"."status" IN ('REQUESTED', 'APPROVED', 'SCHEDULED', 'COMPLETED', 'CANCELLED')),
	CONSTRAINT "ck_reconnection_records_fee_non_negative" CHECK ("reconnection_records"."reconnection_fee_centavos" >= 0),
	CONSTRAINT "ck_reconnection_records_completion" CHECK ("reconnection_records"."status" <> 'COMPLETED' OR "reconnection_records"."completion_date" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "suspension_records" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "suspension_records_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"service_account_id" bigint NOT NULL,
	"reason" text NOT NULL,
	"effective_date" date NOT NULL,
	"approved_by" bigint NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint
);
--> statement-breakpoint
ALTER TABLE "reconnection_records" ADD CONSTRAINT "reconnection_records_service_account_id_service_accounts_id_fk" FOREIGN KEY ("service_account_id") REFERENCES "public"."service_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconnection_records" ADD CONSTRAINT "reconnection_records_technician_user_id_users_id_fk" FOREIGN KEY ("technician_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suspension_records" ADD CONSTRAINT "suspension_records_service_account_id_service_accounts_id_fk" FOREIGN KEY ("service_account_id") REFERENCES "public"."service_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suspension_records" ADD CONSTRAINT "suspension_records_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_reconnection_records_account" ON "reconnection_records" USING btree ("service_account_id");--> statement-breakpoint
CREATE INDEX "ix_reconnection_records_status" ON "reconnection_records" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ix_suspension_records_account" ON "suspension_records" USING btree ("service_account_id");--> statement-breakpoint
CREATE INDEX "ix_suspension_records_effective" ON "suspension_records" USING btree ("effective_date");