-- =========================================================================
-- 0011_better_auth: Better Auth's own tables (M3 task 3.0).
--
-- These five tables are Better Auth's, not ours. They deliberately DO NOT
-- follow packages/schema's conventions: text primary keys instead of uuidv7,
-- `timestamp` instead of the `instant()` timestamptz convention, singular
-- table names. That is not sloppiness. The shapes are dictated by Better
-- Auth's adapter, and a schema that disagrees with its adapter is a runtime
-- failure wearing a house style. services/api/src/auth-schema.ts is generated
-- by `better-auth generate` and this migration matches it column for column.
--
-- WHY THERE ARE NO RLS POLICIES HERE.
--
-- Every policied table in this database is household-scoped, and
-- household_isolation filters on the household GUC. These tables are not
-- household-scoped: a `user` exists before it belongs to any household, and
-- the application must be able to read `session` by token to find out who is
-- asking in the first place. A policy that filtered sessions by household
-- would make authentication depend on knowing the answer authentication
-- produces.
--
-- So they sit outside the RLS story on purpose, the same way
-- schema_migrations does. The control that protects them is that
-- marginsheet_app is the only role with any privilege on them, and the link
-- from a Better Auth user to a household runs through members.auth_user_id,
-- which IS policied. Reading `session` tells you a user id and nothing about
-- a household's money.
--
-- THE PASSWORD COLUMN. Better Auth's account table carries `password`, and
-- §1 says passwordless, entirely. The column has to exist because the adapter
-- expects it, so instead of trusting configuration to keep it empty, the
-- application role is not granted the privilege to write it. This is the same
-- column-level control that keeps marginsheet_app out of
-- plaid_items.access_token_ciphertext. If someone later flips
-- emailAndPassword to enabled, the write fails at the database rather than
-- quietly succeeding.
--
-- marginsheet_sync gets NOTHING here, deliberately. The Plaid sync worker
-- has no business reading sessions or identities.
-- =========================================================================

CREATE TABLE "user" (
  "id"             text PRIMARY KEY,
  "name"           text NOT NULL,
  "email"          text NOT NULL UNIQUE,
  "email_verified" boolean DEFAULT false NOT NULL,
  "image"          text,
  "created_at"     timestamp DEFAULT now() NOT NULL,
  "updated_at"     timestamp DEFAULT now() NOT NULL
);

COMMENT ON TABLE "user" IS
  'Better Auth identity. A user is a person who can sign in; a member is that person inside one household. The link is members.auth_user_id, a soft reference with an integrity test rather than a foreign key (ruled 1.1). Passwordless entirely: no password is ever written for a user.';

CREATE TABLE "session" (
  "id"         text PRIMARY KEY,
  "expires_at" timestamp NOT NULL,
  "token"      text NOT NULL UNIQUE,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp NOT NULL,
  "ip_address" text,
  "user_agent" text,
  "user_id"    text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE
);
CREATE INDEX "session_userId_idx" ON "session" ("user_id");

COMMENT ON COLUMN "session"."ip_address" IS
  'Better Auth populates this by default. MarginSheet strips network identity from Sentry deliberately (three layers, including an org-level setting), so storing it here is the same data in a different store and needs a ruling rather than a default. Task 3.0 measures what actually lands here; until that ruling, treat any value in this column as an open question, not a decision.';

CREATE TABLE "account" (
  "id"                       text PRIMARY KEY,
  "account_id"               text NOT NULL,
  "provider_id"              text NOT NULL,
  "user_id"                  text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "access_token"             text,
  "refresh_token"            text,
  "id_token"                 text,
  "access_token_expires_at"  timestamp,
  "refresh_token_expires_at" timestamp,
  "scope"                    text,
  "password"                 text,
  "created_at"               timestamp DEFAULT now() NOT NULL,
  "updated_at"               timestamp NOT NULL
);
CREATE INDEX "account_userId_idx" ON "account" ("user_id");

COMMENT ON COLUMN "account"."password" IS
  'Exists because Better Auth expects the column. MarginSheet is passwordless entirely (identity-onboarding-spec §1), so marginsheet_app holds no INSERT or UPDATE privilege on it and cannot read it. Configuration saying emailAndPassword is disabled is a setting; this is a constraint. Never grant write here.';

CREATE TABLE "verification" (
  "id"         text PRIMARY KEY,
  "identifier" text NOT NULL,
  "value"      text NOT NULL,
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");

CREATE TABLE "passkey" (
  "id"            text PRIMARY KEY,
  "name"          text,
  "public_key"    text NOT NULL,
  "user_id"       text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "credential_id" text NOT NULL,
  "counter"       integer NOT NULL,
  "device_type"   text NOT NULL,
  "backed_up"     boolean NOT NULL,
  "transports"    text,
  "created_at"    timestamp,
  "aaguid"        text
);
CREATE INDEX "passkey_userId_idx" ON "passkey" ("user_id");
CREATE INDEX "passkey_credentialID_idx" ON "passkey" ("credential_id");

COMMENT ON TABLE "passkey" IS
  'The primary identity method. A passkey is bound to hardware and cannot be forwarded, which is why §1 requires one for a phone change when the member has registered any: an email-delivered link to change the SIM-swap surface lets whoever controls the inbox move the security primitive.';

-- Privileges. marginsheet_app is the only role with any access here.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "user"         TO marginsheet_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "session"      TO marginsheet_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "verification" TO marginsheet_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "passkey"      TO marginsheet_app;

-- account is enumerated column by column, omitting `password` from every
-- privilege. Enumerating rather than granting all-minus-one means a column
-- added by a future Better Auth upgrade is not silently writable: the same
-- reasoning as the Plaid token grant in 0002.
GRANT SELECT (
  "id", "account_id", "provider_id", "user_id", "access_token", "refresh_token",
  "id_token", "access_token_expires_at", "refresh_token_expires_at", "scope",
  "created_at", "updated_at"
) ON TABLE "account" TO marginsheet_app;
GRANT INSERT (
  "id", "account_id", "provider_id", "user_id", "access_token", "refresh_token",
  "id_token", "access_token_expires_at", "refresh_token_expires_at", "scope",
  "created_at", "updated_at"
) ON TABLE "account" TO marginsheet_app;
GRANT UPDATE (
  "account_id", "provider_id", "access_token", "refresh_token", "id_token",
  "access_token_expires_at", "refresh_token_expires_at", "scope", "updated_at"
) ON TABLE "account" TO marginsheet_app;
GRANT DELETE ON TABLE "account" TO marginsheet_app;
