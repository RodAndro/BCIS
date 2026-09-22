CREATE TABLE "backup_history" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "backup_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"backup_id" text NOT NULL,
	"backup_path" text NOT NULL,
	"attachment_manifest_path" text NOT NULL,
	"status" text DEFAULT 'STARTED' NOT NULL,
	"byte_size" bigint DEFAULT 0 NOT NULL,
	"sha256" text,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone,
	"verification_notes" text
);
--> statement-breakpoint
ALTER TABLE "backup_history" ADD CONSTRAINT "backup_history_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_backup_history_backup_id" ON "backup_history" USING btree ("backup_id");--> statement-breakpoint
CREATE INDEX "ix_backup_history_created" ON "backup_history" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ix_backup_history_status" ON "backup_history" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ix_backup_history_sha256" ON "backup_history" USING btree ("sha256");