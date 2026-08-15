CREATE TYPE "public"."consent_kind" AS ENUM('sms_transactional', 'sms_marketing', 'email_marketing');--> statement-breakpoint
CREATE TYPE "public"."consent_source" AS ENUM('signup_checkbox', 'in_app');--> statement-breakpoint
CREATE TYPE "public"."entitlement_state" AS ENUM('trialing', 'active', 'past_due', 'canceled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."invitation_status" AS ENUM('pending', 'accepted', 'canceled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('full_member', 'contributor');--> statement-breakpoint
CREATE TYPE "public"."member_status" AS ENUM('active', 'removed');--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" "consent_kind" NOT NULL,
	"consent_text" text NOT NULL,
	"phone_at_grant" text,
	"email_at_grant" text,
	"granted_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"source" "consent_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "households" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text,
	"entitlement_state" "entitlement_state",
	"trial_ends_at" timestamp with time zone,
	"grace_period_ends_at" timestamp with time zone,
	"stripe_customer_id" text,
	"connected_first_account_at" timestamp with time zone,
	"first_sync_completed_at" timestamp with time zone,
	"address" jsonb,
	"timezone" text,
	"hardship_flag" boolean DEFAULT false NOT NULL,
	"avg_monthly_income" numeric(14, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"token" text NOT NULL,
	"invited_email" text,
	"invited_phone" text,
	"status" "invitation_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_by_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"auth_user_id" text,
	"first_name" text,
	"display_name" text,
	"email" text,
	"phone" text,
	"phone_verified_at" timestamp with time zone,
	"role" "member_role" DEFAULT 'full_member' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"status" "member_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trial_records" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"household_id" uuid NOT NULL,
	"normalized_email" text NOT NULL,
	"card_fingerprint" text,
	"trial_started_at" timestamp with time zone NOT NULL,
	"exempt" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "consent_records_member_kind_idx" ON "consent_records" USING btree ("member_id","kind");--> statement-breakpoint
CREATE INDEX "consent_records_household_idx" ON "consent_records" USING btree ("household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_unique" ON "invitations" USING btree ("token");--> statement-breakpoint
CREATE INDEX "invitations_household_idx" ON "invitations" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "members_household_idx" ON "members" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "members_auth_user_idx" ON "members" USING btree ("auth_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "members_verified_phone_unique" ON "members" USING btree ("phone") WHERE "members"."phone_verified_at" is not null;--> statement-breakpoint
CREATE INDEX "trial_records_normalized_email_idx" ON "trial_records" USING btree ("normalized_email");--> statement-breakpoint
CREATE INDEX "trial_records_card_fingerprint_idx" ON "trial_records" USING btree ("card_fingerprint");--> statement-breakpoint
CREATE TRIGGER households_touch_updated_at BEFORE UPDATE ON "households"
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint
CREATE TRIGGER members_touch_updated_at BEFORE UPDATE ON "members"
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint
CREATE TRIGGER invitations_touch_updated_at BEFORE UPDATE ON "invitations"
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint
CREATE TRIGGER trial_records_touch_updated_at BEFORE UPDATE ON "trial_records"
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint
CREATE TRIGGER consent_records_touch_updated_at BEFORE UPDATE ON "consent_records"
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint

-- === The phone rules (identity-onboarding-spec §1, invariants 3 and 4) =====
COMMENT ON COLUMN "members"."phone" IS
  'A security primitive, never a login method (identity-onboarding-spec §1). The SIM-swap surface is kept deliberately small, and three rules keep it small. They are enforced in application code; this comment exists so no one reconstructs the column without them. 1. NO WRITE PATH FROM ANY CHANNEL. Phone changes happen in-app only, behind a fresh auth challenge (10-minute recent-auth window). No SMS, no email, no brain conversation, no support tool may alter this value. Anyone adding a write path outside the in-app recent-auth flow is removing the defense. 2. ONE VERIFIED PHONE PER MEMBER, globally. A number already verified by another member in ANY household is rejected at signup with support routing, never silently reassigned; enforced by members_verified_phone_unique. 3. Verification is Twilio Verify OTP via the Better Auth phone-number plugin, pre-registered and not waiting on A2P 10DLC approval.';--> statement-breakpoint
COMMENT ON COLUMN "members"."phone_verified_at" IS
  'THE GATE ON ALL CHANNEL ACCESS. Null means no channel message of any kind reaches this member: no SMS, no email, no brain intro, no alert, no broadcast (identity-onboarding-spec invariant 3). Every send path checks this column, not the presence of a phone number. Set only by completing Twilio Verify OTP; cleared only by an in-app phone change, which restarts verification and therefore re-closes the gate.';--> statement-breakpoint
COMMENT ON INDEX "members_verified_phone_unique" IS
  'Enforces one verified phone globally. Unverified duplicates are permitted on purpose: two people may begin signup with the same typo. A VERIFIED number is unique across every household, so a collision is rejected with support routing rather than silently reassigned.';--> statement-breakpoint

-- === Role: contributor is defined but not live ==============================
COMMENT ON TYPE "public"."member_role" IS
  'ONLY full_member IS LIVE AT LAUNCH. contributor is DEFINED BUT UNUSED: the column ships day one so enabling it later is a flag, not a migration (data-model-spec §1, the spec-stated lesson). Do not wire behavior to contributor by accident. No launch code path may write contributor, and no launch code path may branch on role expecting two live values. When contributor does ship post-launch its defined semantics are: may tell things to the brains, receives nothing, and cannot answer open questions (conversation-service-spec). Any behavior beyond that is a new ruling, not an implementation detail.';--> statement-breakpoint

-- === consent_records: a legal artifact that must stand alone ===============
COMMENT ON TABLE "consent_records" IS
  'APPEND-ONLY. A legal artifact, not a convenience join: the TCPA record and the A2P campaign-vetting evidence (ruled 15 Aug 2026). Rows are never deleted and never updated in place. Revocation writes revoked_at on the existing row and changes nothing else. A new grant is a NEW ROW, never an edit of an old one, so the history of what was consented to and when is reconstructible from this table alone. It must prove consent independently of any other table current state, which is why the language and the contact point are stored verbatim here rather than referenced.';--> statement-breakpoint
COMMENT ON COLUMN "consent_records"."consent_text" IS
  'The exact language shown to the member at grant time, stored VERBATIM. Deliberately not a version pointer: a pointer resolves against whatever that version says later, and the evidentiary question is what this person actually read on this date. Copy changes must not be able to rewrite history.';--> statement-breakpoint
COMMENT ON COLUMN "consent_records"."phone_at_grant" IS
  'The phone number as entered at grant time, denormalized on purpose. members.phone may change afterward; this record must still show which number consented. Never backfill or reconcile this against members.phone.';--> statement-breakpoint
COMMENT ON COLUMN "consent_records"."email_at_grant" IS
  'The email as entered at grant time, denormalized for the same reason as phone_at_grant: email_marketing consent must stand on its own evidence.';--> statement-breakpoint
COMMENT ON COLUMN "consent_records"."revoked_at" IS
  'Set on revocation. The row is otherwise untouched: consent_text, phone_at_grant, and granted_at continue to show what was consented to and when. A revoked row remains complete evidence of the original grant.';--> statement-breakpoint

-- === Remaining doctrine ====================================================
COMMENT ON TABLE "households" IS
  'The convention exception: no household_id column, because this table id IS the household scope (data-model-spec §0). RLS predicates on id here and on household_id everywhere else.';--> statement-breakpoint
COMMENT ON COLUMN "households"."entitlement_state" IS
  'NULL until first checkout, a state the enum deliberately cannot express. Null means "has not yet reached the card step", which is distinct from every value here. Code that treats null as canceled is wrong.';--> statement-breakpoint
COMMENT ON COLUMN "households"."trial_ends_at" IS
  'Fourteen-day trial semantics (ruled 14 Aug 2026), replacing Base44 sixty. Beta households carry a null trial and a repeating 100 percent coupon instead, per the promo ruling.';--> statement-breakpoint
COMMENT ON COLUMN "households"."timezone" IS
  'IANA identifier, derived from address at onboarding. ALL scheduled sends compute in this timezone. It is a modeled household field precisely so it never has to be inferred from a request or a vendor telemetry context.';--> statement-breakpoint
COMMENT ON COLUMN "households"."hardship_flag" IS
  'Set by a named life event; flips composed-artifact tone per the brain spec. Cleared manually, never automatically.';--> statement-breakpoint
COMMENT ON COLUMN "members"."auth_user_id" IS
  'Better Auth user id. DELIBERATELY NOT A FOREIGN KEY (ruled 15 Aug 2026). Better Auth owns its own tables and migration timeline; a real FK would weld two migration systems together and make their table rename our outage. Integrity is held by test instead: every auth_user_id must resolve to a Better Auth user row. This is a documented soft reference, not an oversight. Do not "fix" it by adding a constraint.';--> statement-breakpoint
COMMENT ON TABLE "members" IS
  'Replaces Base44 HouseholdMember and the User role model; the brain spec membership doctrine wins. PER-MEMBER PREFERENCE COLUMNS DO NOT BELONG HERE: preferences are standing instructions (data-model-spec §6). Adding a preference column to this table is the mistake this comment exists to prevent.';--> statement-breakpoint
COMMENT ON COLUMN "trial_records"."normalized_email" IS
  'Lowercased, plus-aliases stripped, gmail dots stripped. The normalization IS the column purpose: it is what makes the abuse check work across trivially varied addresses. Store the normalized form, never the raw one.';--> statement-breakpoint
COMMENT ON COLUMN "trial_records"."exempt" IS
  'Founder-invited beta households bypass the abuse check (ruled 14 Aug 2026, promo-code beta).';
