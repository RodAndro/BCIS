CREATE TABLE "application_settings" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "application_settings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"key" text NOT NULL,
	"value" text NOT NULL,
	"value_type" text DEFAULT 'string' NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"description" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" bigint,
	CONSTRAINT "ck_application_settings_value_type" CHECK ("application_settings"."value_type" IN ('string', 'integer', 'boolean', 'decimal', 'json'))
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"actor_user_id" bigint,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"reason" text,
	"old_values" jsonb,
	"new_values" jsonb,
	"ip" text,
	"session_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "login_attempts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"username" "citext" NOT NULL,
	"user_id" bigint,
	"success" boolean NOT NULL,
	"reason" text,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_login_attempts_reason" CHECK ("login_attempts"."reason" IS NULL OR length("login_attempts"."reason") > 0)
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "permissions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"category" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" bigint NOT NULL,
	"permission_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_id_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "roles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sessions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"token_hash" text NOT NULL,
	"user_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"ip" text,
	"device" text
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" bigint NOT NULL,
	"role_id" bigint NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by" bigint,
	CONSTRAINT "user_roles_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"username" "citext" NOT NULL,
	"password_hash" text NOT NULL,
	"full_name" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" bigint,
	CONSTRAINT "ck_users_status" CHECK ("users"."status" IN ('ACTIVE', 'LOCKED', 'DISABLED')),
	CONSTRAINT "ck_users_failed_login_count" CHECK ("users"."failed_login_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_attempts" ADD CONSTRAINT "login_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_application_settings_key" ON "application_settings" USING btree ("key");--> statement-breakpoint
CREATE INDEX "ix_application_settings_category" ON "application_settings" USING btree ("category");--> statement-breakpoint
CREATE INDEX "ix_audit_actor" ON "audit_logs" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "ix_audit_entity" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "ix_audit_action" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "ix_audit_created" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ix_login_attempts_username" ON "login_attempts" USING btree ("username");--> statement-breakpoint
CREATE INDEX "ix_login_attempts_created" ON "login_attempts" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_permissions_code" ON "permissions" USING btree ("code");--> statement-breakpoint
CREATE INDEX "ix_permissions_category" ON "permissions" USING btree ("category");--> statement-breakpoint
CREATE INDEX "ix_role_permissions_role" ON "role_permissions" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_roles_code" ON "roles" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sessions_token_hash" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "ix_sessions_user" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ix_sessions_expires" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "ix_user_roles_user" ON "user_roles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_users_username" ON "users" USING btree ("username");--> statement-breakpoint
CREATE INDEX "ix_users_status" ON "users" USING btree ("status");--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Audit log immutability (INV-9).
--
-- Appended by hand because Drizzle does not model triggers: the generator would
-- treat a hand-written trigger as drift and try to remove it on the next run.
--
-- This is what turns "posted financial records are immutable" from a promise
-- into a demonstrable fact. A defense can open psql and watch the trigger
-- reject an UPDATE against a real row.
--
-- ledger_entries and posted payment_allocations get the same treatment in the
-- phases that create them (P4 and P5).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION deny_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END; $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER trg_audit_no_update
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION deny_audit_mutation();