// The schema. Sections follow data-model-spec; 1.0 landed the conventions and
// one worked example, 1.1 lands identity and membership, and 1.2 onward land
// the rest in dependency order.

import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  householdId,
  instant,
  money,
  timestamps,
  uuidRef,
  uuidv7Pk,
} from "./conventions.js";

// ---------------------------------------------------------------------------
// §1 Identity and membership
// ---------------------------------------------------------------------------

/**
 * Entitlement state. Null until first checkout, which the enum cannot
 * express and the column comment records.
 */
export const entitlementState = pgEnum("entitlement_state", [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "expired",
]);

/**
 * Member role. Only full_member is live at launch; contributor is
 * defined-but-unused so enabling it later is a flag, not a migration.
 */
export const memberRole = pgEnum("member_role", ["full_member", "contributor"]);

export const memberStatus = pgEnum("member_status", ["active", "removed"]);

export const invitationStatus = pgEnum("invitation_status", [
  "pending",
  "accepted",
  "canceled",
  "expired",
]);

export const consentKind = pgEnum("consent_kind", [
  "sms_transactional",
  "sms_marketing",
  "email_marketing",
]);

export const consentSource = pgEnum("consent_source", ["signup_checkbox", "in_app"]);

/**
 * households (data-model-spec §1).
 *
 * The convention exception: no household_id column, because this table's own
 * id IS the household scope. RLS in 1.7 predicates on id here and on
 * household_id everywhere else.
 */
export const households = pgTable("households", {
  id: uuidv7Pk(),
  name: text("name"),
  entitlementState: entitlementState("entitlement_state"),
  trialEndsAt: instant("trial_ends_at"),
  gracePeriodEndsAt: instant("grace_period_ends_at"),
  stripeCustomerId: text("stripe_customer_id"),
  connectedFirstAccountAt: instant("connected_first_account_at"),
  firstSyncCompletedAt: instant("first_sync_completed_at"),
  address: jsonb("address"),
  timezone: text("timezone"),
  hardshipFlag: boolean("hardship_flag").notNull().default(false),
  avgMonthlyIncome: money("avg_monthly_income"),
  ...timestamps(),
});

/**
 * members (data-model-spec §1).
 *
 * Replaces Base44's HouseholdMember and User role model; the brain spec's
 * membership doctrine wins. Per-member preference columns stay OUT: those are
 * standing instructions (§6).
 */
export const members = pgTable(
  "members",
  {
    id: uuidv7Pk(),
    householdId: householdId(),
    authUserId: text("auth_user_id"),
    firstName: text("first_name"),
    displayName: text("display_name"),
    email: text("email"),
    phone: text("phone"),
    phoneVerifiedAt: instant("phone_verified_at"),
    role: memberRole("role").notNull().default("full_member"),
    isPrimary: boolean("is_primary").notNull().default(false),
    status: memberStatus("status").notNull().default("active"),
    ...timestamps(),
  },
  (t) => [
    index("members_household_idx").on(t.householdId),
    index("members_auth_user_idx").on(t.authUserId),
    // One verified phone per member, globally. Unverified duplicates are
    // permitted (two people may start signup with a typo); a verified number
    // is unique across every household.
    uniqueIndex("members_verified_phone_unique")
      .on(t.phone)
      .where(sql`${t.phoneVerifiedAt} is not null`),
  ]
);

/** invitations (data-model-spec §1). Ported; loses Base44's denormalized names. */
export const invitations = pgTable(
  "invitations",
  {
    id: uuidv7Pk(),
    householdId: householdId(),
    token: text("token").notNull(),
    invitedEmail: text("invited_email"),
    invitedPhone: text("invited_phone"),
    status: invitationStatus("status").notNull().default("pending"),
    expiresAt: instant("expires_at").notNull(),
    acceptedByMemberId: uuidRef("accepted_by_member_id"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("invitations_token_unique").on(t.token),
    index("invitations_household_idx").on(t.householdId),
  ]
);

/** trial_records (data-model-spec §1). The trial-abuse ledger. */
export const trialRecords = pgTable(
  "trial_records",
  {
    id: uuidv7Pk(),
    householdId: householdId(),
    normalizedEmail: text("normalized_email").notNull(),
    cardFingerprint: text("card_fingerprint"),
    trialStartedAt: instant("trial_started_at").notNull(),
    exempt: boolean("exempt").notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    index("trial_records_normalized_email_idx").on(t.normalizedEmail),
    index("trial_records_card_fingerprint_idx").on(t.cardFingerprint),
  ]
);

/**
 * consent_records (data-model-spec §1, extended by ruling 15 Aug 2026).
 *
 * A legal artifact, not a convenience join. It must prove consent
 * independently of any other table's current state, which is why the exact
 * language and the phone as entered are stored here verbatim.
 */
export const consentRecords = pgTable(
  "consent_records",
  {
    id: uuidv7Pk(),
    householdId: householdId(),
    memberId: uuidRef("member_id").notNull(),
    kind: consentKind("kind").notNull(),
    consentText: text("consent_text").notNull(),
    phoneAtGrant: text("phone_at_grant"),
    emailAtGrant: text("email_at_grant"),
    grantedAt: instant("granted_at").notNull(),
    revokedAt: instant("revoked_at"),
    source: consentSource("source").notNull(),
    ...timestamps(),
  },
  (t) => [
    index("consent_records_member_kind_idx").on(t.memberId, t.kind),
    index("consent_records_household_idx").on(t.householdId),
  ]
);

// ---------------------------------------------------------------------------
// §3 The ledger (partial: the 1.0 worked example)
// ---------------------------------------------------------------------------

/**
 * The P&L line enum (data-model-spec §3, CLAUDE.md vocabulary lock).
 *
 * Closed at seven values. Taxes is deliberately absent: it is a category
 * named "Taxes After Takehome" filed under fixed_obligations, not a line.
 */
export const plLine = pgEnum("pl_line", [
  "income",
  "fixed_obligations",
  "variable_operating",
  "discretionary",
  "interest_fees",
  "transfer",
  "deployment",
]);

export const categories = pgTable(
  "categories",
  {
    id: uuidv7Pk(),
    householdId: householdId(),
    name: text("name").notNull(),
    plLine: plLine("pl_line").notNull(),
    icon: text("icon"),
    color: text("color"),
    parentId: uuidRef("parent_id"),
    isArchived: boolean("is_archived").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    plaidPfcMappings: text("plaid_pfc_mappings"),
    isSystem: boolean("is_system").notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    index("categories_household_idx").on(t.householdId),
    index("categories_household_pl_line_idx").on(t.householdId, t.plLine),
  ]
);
