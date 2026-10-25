CREATE SCHEMA "files";
--> statement-breakpoint
CREATE TABLE "files"."file_shares" (
	"file_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"shared_by" text NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_shares_file_id_user_id_pk" PRIMARY KEY("file_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "files"."files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"folder_id" uuid,
	"conversation_id" uuid,
	"uploader_id" text NOT NULL,
	"name" text NOT NULL,
	"mime_type" text NOT NULL,
	"kind" text NOT NULL,
	"size" bigint NOT NULL,
	"storage_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (6) with time zone,
	"deleted_by" text,
	CONSTRAINT "files_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "files"."folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"owner_id" text NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "files"."file_shares" ADD CONSTRAINT "file_shares_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "files"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files"."files" ADD CONSTRAINT "files_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "files"."folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_shares_user_idx" ON "files"."file_shares" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "files_workspace_created_idx" ON "files"."files" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "files_uploader_idx" ON "files"."files" USING btree ("workspace_id","uploader_id");--> statement-breakpoint
CREATE INDEX "files_conversation_idx" ON "files"."files" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "files_folder_idx" ON "files"."files" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "folders_workspace_owner_idx" ON "files"."folders" USING btree ("workspace_id","owner_id","parent_id");