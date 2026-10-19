CREATE TABLE "records" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant" TEXT NOT NULL,
  "space" TEXT NOT NULL,
  "module" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "data" TEXT NOT NULL,
  "legacy_id" TEXT,
  "legacy_module" TEXT,
  "raw" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "deleted_at" TEXT
);
CREATE UNIQUE INDEX "record_code" ON "records" ("tenant", "space", "module", "code");
CREATE UNIQUE INDEX "legacy_identity" ON "records" ("tenant", "space", "module", "legacy_module", "legacy_id");
CREATE INDEX "record_lookup" ON "records" ("tenant", "space", "module");

CREATE TABLE "audit" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant" TEXT NOT NULL,
  "space" TEXT NOT NULL,
  "record_id" TEXT,
  "actor" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "before" TEXT,
  "after" TEXT,
  "created_at" TEXT NOT NULL
);
CREATE INDEX "audit_tenant_space_record_id_idx" ON "audit" ("tenant", "space", "record_id");

CREATE TABLE "counters" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "value" BIGINT NOT NULL
);

CREATE TABLE "preferences" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "value" TEXT NOT NULL
);

CREATE TABLE "attachments" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant" TEXT NOT NULL,
  "space" TEXT NOT NULL,
  "record_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "mime" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "hash" TEXT NOT NULL,
  "object_key" TEXT NOT NULL,
  "created_at" TEXT NOT NULL
);
CREATE INDEX "attachments_tenant_space_record_id_idx" ON "attachments" ("tenant", "space", "record_id");

CREATE TABLE "comments" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant" TEXT NOT NULL,
  "space" TEXT NOT NULL,
  "record_id" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "actor" TEXT NOT NULL,
  "created_at" TEXT NOT NULL
);
CREATE INDEX "comments_tenant_space_record_id_idx" ON "comments" ("tenant", "space", "record_id");

CREATE TABLE "migration_batches" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant" TEXT NOT NULL,
  "space" TEXT NOT NULL,
  "module" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "hash" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "created_at" TEXT NOT NULL
);

CREATE TABLE "app_users" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "username" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "salt" TEXT NOT NULL,
  "hash" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "app_users_role_check" CHECK ("role" IN ('admin', 'ventas'))
);

CREATE TABLE "app_sessions" (
  "token" TEXT NOT NULL PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "expires" BIGINT NOT NULL
);
CREATE INDEX "app_sessions_user_id_idx" ON "app_sessions" ("user_id");
CREATE INDEX "app_sessions_expires_idx" ON "app_sessions" ("expires");

CREATE TABLE "login_attempts" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "count" INTEGER NOT NULL DEFAULT 0,
  "until" BIGINT NOT NULL DEFAULT 0
);

