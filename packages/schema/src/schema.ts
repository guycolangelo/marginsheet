// The schema. Sections follow data-model-spec; 1.0 landed the conventions and
// one worked example, 1.1 lands identity and membership, and 1.2 onward land
// the rest in dependency order.

import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  foreignKey,
  pgTable,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  bankDay,
  householdId,
  instant,
  money,
  percentage,
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
// §2 Banking and sync
// ---------------------------------------------------------------------------

export const plaidItemStatus = pgEnum("plaid_item_status", [
  "healthy",
  "needs_reauth",
  "error",
  "disconnected",
]);

export const syncStatus = pgEnum("sync_status", ["idle", "syncing", "queued", "error"]);

export const cardState = pgEnum("card_state", [
  "paid_in_full",
  "revolving",
  "overdue",
  "unavailable",
]);

export const providerSource = pgEnum("provider_source", [
  "stripe",
  "plaid",
  "twilio",
  "postmark",
]);

/**
 * institutions (data-model-spec §2). GLOBAL: no household_id.
 *
 * The second convention exception. households omits household_id because its
 * own id is the scope; this table omits it because a Plaid institution is
 * shared across every household. 1.7 must not treat either as an oversight.
 */
export const institutions = pgTable(
  "institutions",
  {
    id: uuidv7Pk(),
    plaidInstitutionId: text("plaid_institution_id").notNull(),
    name: text("name").notNull(),
    logoUrl: text("logo_url"),
    ...timestamps(),
  },
  (t) => [uniqueIndex("institutions_plaid_id_unique").on(t.plaidInstitutionId)]
);

/** plaid_items (data-model-spec §2). Holds the encrypted access token. */
export const plaidItems = pgTable(
  "plaid_items",
  {
    id: uuidv7Pk(),
    householdId: householdId(),
    institutionId: uuidRef("institution_id").references(() => institutions.id),
    itemId: text("item_id").notNull(),
    accessTokenCiphertext: text("access_token_ciphertext"),
    status: plaidItemStatus("status").notNull().default("healthy"),
    lastSuccessfulSync: instant("last_successful_sync"),
    syncCursor: text("sync_cursor"),
    syncStatus: syncStatus("sync_status").notNull().default("idle"),
    lastSyncedAt: instant("last_synced_at"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("plaid_items_item_id_unique").on(t.itemId),
    index("plaid_items_household_idx").on(t.householdId),
    // Target for the composite FK that makes invariant 1 structural.
    unique("plaid_items_household_id_key").on(t.householdId, t.id),
  ]
);

/** financial_accounts (data-model-spec §2). Ported in full. */
export const financialAccounts = pgTable(
  "financial_accounts",
  {
    id: uuidv7Pk(),
    householdId: householdId(),
    plaidItemId: uuidRef("plaid_item_id")
      .notNull()
      .references(() => plaidItems.id, { onDelete: "restrict" }),
    plaidAccountId: text("plaid_account_id").notNull(),
    name: text("name"),
    officialName: text("official_name"),
    mask: text("mask"),
    type: text("type"),
    subtype: text("subtype"),
    currentBalance: money("current_balance"),
    availableBalance: money("available_balance"),
    creditLimit: money("credit_limit"),
    isoCurrency: text("iso_currency"),
    inPayoffPool: boolean("in_payoff_pool").notNull().default(false),
    classificationConfirmedAt: instant("classification_confirmed_at"),
    cardState: cardState("card_state"),
    carriedBalance: money("carried_balance"),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("financial_accounts_plaid_account_id_unique").on(t.plaidAccountId),
    index("financial_accounts_household_idx").on(t.householdId),
    index("financial_accounts_item_idx").on(t.plaidItemId),
    unique("financial_accounts_household_id_key").on(t.householdId, t.id),
    // Invariant 1, first link: an account cannot sit under another
    // household's item. The simple plaid_item_id FK above carries the
    // RESTRICT-on-delete semantics; this one carries household agreement.
    foreignKey({
      name: "financial_accounts_item_same_household_fk",
      columns: [t.householdId, t.plaidItemId],
      foreignColumns: [plaidItems.householdId, plaidItems.id],
    }),
  ]
);

/** account_balance_snapshots (data-model-spec §2). One per account per day. */
export const accountBalanceSnapshots = pgTable(
  "account_balance_snapshots",
  {
    id: uuidv7Pk(),
    householdId: householdId(),
    accountId: uuidRef("account_id")
      .notNull()
      .references(() => financialAccounts.id, { onDelete: "cascade" }),
    date: bankDay("date").notNull(),
    currentBalance: money("current_balance"),
    availableBalance: money("available_balance"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("account_balance_snapshots_account_date_unique").on(t.accountId, t.date),
    index("account_balance_snapshots_household_date_idx").on(t.householdId, t.date),
  ]
);

/** liability_details (data-model-spec §2). Feeds commitments and cost-of-capital. */
export const liabilityDetails = pgTable(
  "liability_details",
  {
    id: uuidv7Pk(),
    householdId: householdId(),
    accountId: uuidRef("account_id")
      .notNull()
      .references(() => financialAccounts.id, { onDelete: "cascade" }),
    lastStatementBalance: money("last_statement_balance"),
    lastStatementDate: bankDay("last_statement_date"),
    minimumPayment: money("minimum_payment"),
    nextPaymentDueDate: bankDay("next_payment_due_date"),
    lastPaymentDate: bankDay("last_payment_date"),
    lastPaymentAmount: money("last_payment_amount"),
    purchaseApr: percentage("purchase_apr"),
    cashApr: percentage("cash_apr"),
    balanceTransferApr: percentage("balance_transfer_apr"),
    specialApr: percentage("special_apr"),
    specialAprExpiry: bankDay("special_apr_expiry"),
    isOverdue: boolean("is_overdue").notNull().default(false),
    fetchedAt: instant("fetched_at"),
    ...timestamps(),
  },
  (t) => [
    index("liability_details_account_idx").on(t.accountId),
    index("liability_details_household_idx").on(t.householdId),
  ]
);

/**
 * provider_events (data-model-spec §2). The idempotency ledger.
 *
 * Global-ish: household_id is nullable because some callbacks (a Stripe
 * event for an unknown customer, a Plaid webhook before item attribution)
 * arrive before the household is known. The ledger must still record them,
 * because recording is what makes the retry safe.
 */
export const providerEvents = pgTable(
  "provider_events",
  {
    id: uuidv7Pk(),
    householdId: uuidRef("household_id"),
    source: providerSource("source").notNull(),
    eventId: text("event_id").notNull(),
    eventType: text("event_type"),
    payload: jsonb("payload"),
    processedAt: instant("processed_at"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("provider_events_source_event_id_unique").on(t.source, t.eventId),
    index("provider_events_source_type_idx").on(t.source, t.eventType),
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

export const transactionDirection = pgEnum("transaction_direction", [
  "income",
  "expense",
  "transfer",
]);

export const reviewState = pgEnum("review_state", [
  "auto_filed",
  "needs_review",
  "user_reviewed",
]);

export const queueReason = pgEnum("queue_reason", [
  "possible_transfer",
  "possible_deployment",
  "low_confidence",
  "first_seen_merchant",
  "anomaly",
  "unclassified_inflow",
  "ambiguous",
]);

export const confidenceLevel = pgEnum("confidence_level", ["high", "medium", "low"]);

export const reimbursementStatus = pgEnum("reimbursement_status", [
  "pending",
  "matched",
  "written_off",
]);

export const correctionSource = pgEnum("correction_source", ["user", "llm", "global"]);

export const ruleSource = pgEnum("rule_source", ["manual", "learned"]);

/** transactions (data-model-spec §3). The ledger. */
export const transactions = pgTable(
  "transactions",
  {
    id: uuidv7Pk(),
    householdId: householdId(),
    accountId: uuidRef("account_id").notNull(),
    plaidTransactionId: text("plaid_transaction_id"),

    date: bankDay("date").notNull(),
    authorizedDate: bankDay("authorized_date"),
    amount: money("amount").notNull(),
    isoCurrency: text("iso_currency"),

    merchantName: text("merchant_name"),
    displayMerchantName: text("display_merchant_name"),
    normalizedMerchantKey: text("normalized_merchant_key"),
    originalDescription: text("original_description"),

    direction: transactionDirection("direction").notNull(),
    categoryId: uuidRef("category_id"),
    plLine: plLine("pl_line"),
    accountType: text("account_type"),

    plaidPfcPrimary: text("plaid_pfc_primary"),
    plaidPfcDetailed: text("plaid_pfc_detailed"),
    paymentMeta: jsonb("payment_meta"),
    counterparties: jsonb("counterparties"),
    destination: jsonb("destination"),

    pending: boolean("pending").notNull().default(false),
    removed: boolean("removed").notNull().default(false),
    reviewState: reviewState("review_state").notNull().default("auto_filed"),
    queueReason: queueReason("queue_reason"),
    confidence: confidenceLevel("confidence"),

    isTransfer: boolean("is_transfer").notNull().default(false),
    transferPairId: uuidRef("transfer_pair_id"),
    isReimbursable: boolean("is_reimbursable").notNull().default(false),
    reimbursementStatus: reimbursementStatus("reimbursement_status"),
    reimbursementPairId: uuidRef("reimbursement_pair_id"),
    refundPairId: uuidRef("refund_pair_id"),
    possibleDeployment: boolean("possible_deployment").notNull().default(false),

    splitParentId: uuidRef("split_parent_id"),
    isProvisional: boolean("is_provisional").notNull().default(false),
    notes: text("notes"),
    chatTranscript: jsonb("chat_transcript"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("transactions_plaid_transaction_id_unique").on(t.plaidTransactionId),
    index("transactions_household_date_idx").on(t.householdId, t.date),
    index("transactions_account_date_idx").on(t.accountId, t.date),
    index("transactions_needs_review_idx")
      .on(t.householdId, t.reviewState)
      .where(sql`${t.reviewState} = 'needs_review'`),
    // The three keyed operations: correction matching, recurrence
    // inheritance, refund matching.
    index("transactions_merchant_key_idx").on(
      t.householdId,
      t.normalizedMerchantKey,
      t.direction
    ),
    // Invariant 1, second link: a transaction cannot point at another
    // household's account. With the first link this holds transitively
    // across transaction, account, and item.
    foreignKey({
      name: "transactions_account_same_household_fk",
      columns: [t.householdId, t.accountId],
      foreignColumns: [financialAccounts.householdId, financialAccounts.id],
    }),
  ]
);

/** merchant_corrections (data-model-spec §3). The learned layer. */
export const merchantCorrections = pgTable(
  "merchant_corrections",
  {
    id: uuidv7Pk(),
    householdId: householdId(),
    normalizedMerchantKey: text("normalized_merchant_key").notNull(),
    direction: transactionDirection("direction"),
    accountType: text("account_type"),
    categoryId: uuidRef("category_id"),
    subcategoryId: uuidRef("subcategory_id"),
    plLine: plLine("pl_line"),
    isTransfer: boolean("is_transfer").notNull().default(false),
    bandMin: money("band_min"),
    bandMax: money("band_max"),
    correctionCount: integer("correction_count").notNull().default(1),
    lastCorrectedAt: instant("last_corrected_at"),
    source: correctionSource("source").notNull().default("user"),
    ...timestamps(),
  },
  (t) => [
    index("merchant_corrections_key_idx").on(
      t.householdId,
      t.normalizedMerchantKey,
      t.direction,
      t.accountType
    ),
  ]
);

/** category_rules (data-model-spec §3). */
export const categoryRules = pgTable(
  "category_rules",
  {
    id: uuidv7Pk(),
    householdId: householdId(),
    name: text("name"),
    conditions: jsonb("conditions"),
    actions: jsonb("actions"),
    accountScope: jsonb("account_scope"),
    isActive: boolean("is_active").notNull().default(true),
    source: ruleSource("source").notNull().default("manual"),
    ...timestamps(),
  },
  (t) => [index("category_rules_household_idx").on(t.householdId)]
);

/** source_renames (data-model-spec §3). */
export const sourceRenames = pgTable(
  "source_renames",
  {
    id: uuidv7Pk(),
    householdId: householdId(),
    merchantKey: text("merchant_key").notNull(),
    displayName: text("display_name").notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("source_renames_household_key_unique").on(t.householdId, t.merchantKey),
  ]
);

// ---------------------------------------------------------------------------
// §4 Projections
// ---------------------------------------------------------------------------

/**
 * Commitment direction. NOT the same value set as transaction_direction.
 * A stream is an inflow or an outflow; a transaction is income, expense, or
 * transfer. Two adjacent columns both named "direction" with different
 * values is a real trap, so both carry comments naming the other.
 */
export const commitmentDirection = pgEnum("commitment_direction", ["inflow", "outflow"]);

export const cadence = pgEnum("cadence", [
  "weekly",
  "biweekly",
  "semimonthly",
  "monthly",
  "every_other_month",
  "quarterly",
  "semiannual",
  "annual",
  "irregular",
]);

export const commitmentSource = pgEnum("commitment_source", [
  "plaid_recurring",
  "census",
  "liability_detail",
  "household_stated",
]);

export const commitmentStatus = pgEnum("commitment_status", ["active", "paused", "ended"]);

export const goalSetWith = pgEnum("goal_set_with", [
  "onboarding",
  "conversation",
  "annual_session",
]);

/** commitments (projection-spec §6, data-model-spec §4). */
export const commitments = pgTable(
  "commitments",
  {
    id: uuidv7Pk(),
    householdId: householdId(),
    merchantKey: text("merchant_key").notNull(),
    direction: commitmentDirection("direction").notNull(),
    accountId: uuidRef("account_id"),
    cadence: cadence("cadence").notNull(),
    expectedAmount: jsonb("expected_amount"),
    nextExpectedDate: bankDay("next_expected_date"),
    windowDays: integer("window_days"),
    categoryId: uuidRef("category_id"),
    plLine: plLine("pl_line"),
    source: commitmentSource("source").notNull(),
    status: commitmentStatus("status").notNull().default("active"),
    lastMatchedTransactionId: uuidRef("last_matched_transaction_id"),
    consecutiveMisses: integer("consecutive_misses").notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    index("commitments_household_status_idx").on(t.householdId, t.status),
    index("commitments_next_expected_idx").on(t.householdId, t.nextExpectedDate),
    // The upsert key. NULLS NOT DISTINCT is deliberate; see the comment on
    // this constraint in the migration.
    unique("commitments_stream_unique")
      .on(t.householdId, t.merchantKey, t.direction, t.cadence, t.accountId)
      .nullsNotDistinct(),
  ]
);

/** household_goals (projection-spec §2, data-model-spec §4). One row per household. */
export const householdGoals = pgTable(
  "household_goals",
  {
    id: uuidv7Pk(),
    householdId: householdId(),
    marginTargetPct: percentage("margin_target_pct"),
    lifeHappensTarget: jsonb("life_happens_target"),
    annualPlan: jsonb("annual_plan"),
    setWith: goalSetWith("set_with"),
    updatedByMemberId: uuidRef("updated_by_member_id"),
    ...timestamps(),
  },
  (t) => [uniqueIndex("household_goals_household_unique").on(t.householdId)]
);
