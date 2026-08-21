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
  uuid,
  check,
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

/** M5's FILING of a transaction. Not a fact: see moneyFlow for that.
 *
 *  `undetermined` was added by 0034 and is NOT `unclassified`, which invariant 9
 *  bans. It is M5's honest output for a card credit it cannot resolve into a
 *  payment or a refund. */
export const transactionDirection = pgEnum("transaction_direction", [
  "income",
  "expense",
  "transfer",
  "undetermined",
]);

/** M4's FACT: which way the money moved. Always knowable from the sign of
 *  Plaid's amount, which is positive for money leaving the account on both
 *  depository and credit accounts.
 *
 *  DELIBERATELY NOT commitmentDirection, which shares this vocabulary and is a
 *  property of a recurring obligation rather than of one movement of money.
 *  Folding them was considered on 21 Aug 2026 and rejected; see 0035. */
export const moneyFlow = pgEnum("money_flow", ["inflow", "outflow"]);

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

    /** M5's filing. NULL until filed; see 0035. */
    direction: transactionDirection("direction"),
    /** M4's fact: which way the money moved. */
    flow: moneyFlow("flow").notNull(),
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

// ---------------------------------------------------------------------------
// §5 Conversation state (a): threads, messages, questions
// ---------------------------------------------------------------------------

export const brain = pgEnum("brain", ["mykeeper", "mycfo"]);

export const messageDirection = pgEnum("message_direction", ["inbound", "outbound"]);

export const channel = pgEnum("channel", ["sms", "email"]);

export const messageStatus = pgEnum("message_status", [
  "composed",
  "held_shadow",
  "sent",
  "failed",
  "suppressed_no_gate",
]);

export const dispatchState = pgEnum("dispatch_state", [
  "pending",
  "answered",
  "clarifying",
  "returned_to_app",
  "conflicted",
]);

/** threads (data-model-spec §5). One per (member, brain). */
export const threads = pgTable(
  "threads",
  {
    id: uuidv7Pk(),
    householdId: householdId(),
    memberId: uuidRef("member_id").notNull(),
    brain: brain("brain").notNull(),
    lastActivityAt: instant("last_activity_at"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("threads_member_brain_unique").on(t.memberId, t.brain),
    index("threads_household_idx").on(t.householdId),
  ]
);

/** messages (data-model-spec §5). Every inbound and outbound, both channels. */
export const messages = pgTable(
  "messages",
  {
    id: uuidv7Pk(),
    householdId: householdId(),
    memberId: uuidRef("member_id").notNull(),
    brain: brain("brain").notNull(),
    direction: messageDirection("direction").notNull(),
    channel: channel("channel").notNull(),
    providerMessageId: text("provider_message_id"),
    messageClass: text("message_class"),
    body: text("body"),
    factPackage: jsonb("fact_package"),
    factPackageVersion: text("fact_package_version"),
    gateResult: jsonb("gate_result"),
    modelUsed: text("model_used"),
    fallbackFlag: boolean("fallback_flag").notNull().default(false),
    status: messageStatus("status"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("messages_provider_message_id_unique").on(t.providerMessageId),
    index("messages_household_created_idx").on(t.householdId, t.createdAt),
    index("messages_member_brain_created_idx").on(t.memberId, t.brain, t.createdAt),
    // Invariant 7. See the constraint comment in the migration.
    check(
      "messages_sent_requires_gate",
      sql`${t.status} is distinct from 'sent' or ${t.gateResult} is not null`
    ),
  ]
);

/** question_dispatches (data-model-spec §5). The conversation ABOUT a queue item. */
export const questionDispatches = pgTable(
  "question_dispatches",
  {
    id: uuidv7Pk(),
    householdId: householdId(),
    groupKey: text("group_key"),
    transactionIds: uuid("transaction_ids").array(),
    questionText: text("question_text"),
    bestGuess: jsonb("best_guess"),
    answerSpace: jsonb("answer_space"),
    sentTo: jsonb("sent_to"),
    state: dispatchState("state").notNull().default("pending"),
    answeredByMemberId: uuidRef("answered_by_member_id"),
    answer: jsonb("answer"),
    resolvedAt: instant("resolved_at"),
    clarificationCount: integer("clarification_count").notNull().default(0),
    conflict: jsonb("conflict"),
    ...timestamps(),
  },
  (t) => [
    index("question_dispatches_household_state_idx").on(t.householdId, t.state),
    index("question_dispatches_group_key_idx").on(t.householdId, t.groupKey),
  ]
);

// ---------------------------------------------------------------------------
// §5 Conversation state (b): context, instructions, watcher state
// ---------------------------------------------------------------------------

export const knownContextType = pgEnum("known_context_type", [
  "goal",
  "plan",
  "fact",
  "worry",
  "preference",
  "decision",
]);

export const knownContextState = pgEnum("known_context_state", [
  "active",
  "dormant",
  "expired",
]);

export const instructionType = pgEnum("instruction_type", [
  "threshold",
  "timing",
  "routing",
  "watch_tag",
]);

export const tagCertainty = pgEnum("tag_certainty", ["confirmed", "maybe"]);

export const decisionOutcome = pgEnum("decision_outcome", [
  "adopted",
  "passed",
  "undecided",
]);

export const handoffState = pgEnum("handoff_state", ["open", "fulfilled"]);

export const conditionStateValue = pgEnum("condition_state_value", [
  "fired",
  "acknowledged",
  "resolved",
  "escalated",
]);

export const calibrationState = pgEnum("calibration_state", ["asking", "silent"]);

export const demotionReason = pgEnum("demotion_reason", ["accuracy", "double_fault"]);

export const insightRoute = pgEnum("insight_route", [
  "fact_package",
  "watcher",
  "elicitation",
  "wait",
]);

export const insightSource = pgEnum("insight_source", ["census", "monthly_maintenance"]);

export const receivableState = pgEnum("receivable_state", [
  "open",
  "matched",
  "written_off",
]);

/**
 * known_context (data-model-spec §5). What the household said, nothing else.
 *
 * NO CONFIDENCE COLUMN, EVER (invariant 3). The absence IS the enforcement,
 * and a test asserts no column here matches %confidence%.
 */
export const knownContext = pgTable(
  "known_context",
  {
    id: uuidv7Pk(),
    householdId: householdId(),
    type: knownContextType("type").notNull(),
    text: text("text").notNull(),
    saidByMemberId: uuidRef("said_by_member_id"),
    saidAt: instant("said_at"),
    sourceMessageId: uuidRef("source_message_id"),
    state: knownContextState("state").notNull().default("active"),
    expiresAt: instant("expires_at"),
    supersededById: uuidRef("superseded_by_id"),
    teeth: jsonb("teeth"),
    householdGoalsId: uuidRef("household_goals_id"),
    deletedAt: instant("deleted_at"),
    ...timestamps(),
  },
  (t) => [
    index("known_context_household_state_idx").on(t.householdId, t.state),
    index("known_context_household_type_idx").on(t.householdId, t.type),
  ]
);

/** tombstones (data-model-spec §5). The audit trail for deletions. */
export const tombstones = pgTable(
  "tombstones",
  {
    id: uuidv7Pk(),
    householdId: householdId(),
    entityTable: text("entity_table").notNull(),
    entityId: uuidRef("entity_id").notNull(),
    deletedByMemberId: uuidRef("deleted_by_member_id"),
    reason: text("reason"),
    ...timestamps(),
  },
  (t) => [index("tombstones_entity_idx").on(t.entityTable, t.entityId)]
);

/** standing_instructions (data-model-spec §5). Per-member, always. */
export const standingInstructions = pgTable(
  "standing_instructions",
  {
    id: uuidv7Pk(),
    householdId: householdId(),
    memberId: uuidRef("member_id").notNull(),
    type: instructionType("type").notNull(),
    parameters: jsonb("parameters"),
    statedInMessageId: uuidRef("stated_in_message_id"),
    active: boolean("active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [index("standing_instructions_member_idx").on(t.memberId, t.active)]
);

/** tags (data-model-spec §5). The tag exchange's output. */
export const tags = pgTable(
  "tags",
  {
    id: uuidv7Pk(),
    householdId: householdId(),
    name: text("name").notNull(),
    createdByMemberId: uuidRef("created_by_member_id"),
    watch: boolean("watch").notNull().default(false),
    watchInstructionId: uuidRef("watch_instruction_id"),
    ...timestamps(),
  },
  (t) => [uniqueIndex("tags_household_name_unique").on(t.householdId, t.name)]
);

/** tag_members (data-model-spec §5). */
export const tagMembers = pgTable(
  "tag_members",
  {
    id: uuidv7Pk(),
    householdId: householdId(),
    tagId: uuidRef("tag_id").notNull(),
    merchantKey: text("merchant_key"),
    transactionId: uuidRef("transaction_id"),
    certainty: tagCertainty("certainty").notNull().default("confirmed"),
    excluded: boolean("excluded").notNull().default(false),
    ...timestamps(),
  },
  (t) => [index("tag_members_tag_idx").on(t.tagId)]
);

/** decision_journal (data-model-spec §5). Memory, never scorekeeping. */
export const decisionJournal = pgTable(
  "decision_journal",
  {
    id: uuidv7Pk(),
    householdId: householdId(),
    questionAsAsked: text("question_as_asked"),
    arithmeticShown: jsonb("arithmetic_shown"),
    decision: decisionOutcome("decision").notNull().default("undecided"),
    decidedAt: instant("decided_at"),
    relatedCommitmentId: uuidRef("related_commitment_id"),
    ...timestamps(),
  },
  (t) => [index("decision_journal_household_idx").on(t.householdId, t.decidedAt)]
);

/** handoffs (data-model-spec §5). The 3-minute budget lives between these timestamps. */
export const handoffs = pgTable(
  "handoffs",
  {
    id: uuidv7Pk(),
    householdId: householdId(),
    fromBrain: brain("from_brain").notNull(),
    toBrain: brain("to_brain").notNull(),
    questionSummary: text("question_summary"),
    sourceMessageId: uuidRef("source_message_id"),
    state: handoffState("state").notNull().default("open"),
    fulfilledAt: instant("fulfilled_at"),
    ...timestamps(),
  },
  (t) => [index("handoffs_household_state_idx").on(t.householdId, t.state)]
);

/**
 * condition_states (data-model-spec §5). The watcher's dedup memory.
 *
 * subject_hash is GENERATED so two writers cannot hash the same subject
 * differently and defeat the unique key.
 */
export const conditionStates = pgTable(
  "condition_states",
  {
    id: uuidv7Pk(),
    householdId: householdId(),
    ruleId: text("rule_id").notNull(),
    subject: jsonb("subject").notNull(),
    subjectHash: text("subject_hash").generatedAlwaysAs(
      sql`md5(subject::text)`
    ),
    state: conditionStateValue("state").notNull().default("fired"),
    firstFiredAt: instant("first_fired_at"),
    lastFiredAt: instant("last_fired_at"),
    followupSent: boolean("followup_sent").notNull().default(false),
    fireAheadWindow: jsonb("fire_ahead_window"),
    ...timestamps(),
  },
  (t) => [
    unique("condition_states_subject_unique").on(t.householdId, t.ruleId, t.subjectHash),
    index("condition_states_household_state_idx").on(t.householdId, t.state),
  ]
);

/** calibration_bands (data-model-spec §5). The graduation loop's ledger. */
export const calibrationBands = pgTable(
  "calibration_bands",
  {
    id: uuidv7Pk(),
    householdId: householdId(),
    bandLabel: text("band_label").notNull(),
    guesses: integer("guesses").notNull().default(0),
    matches: integer("matches").notNull().default(0),
    trailingWindow: jsonb("trailing_window"),
    state: calibrationState("state").notNull().default("asking"),
    graduatedAt: instant("graduated_at"),
    demotedAt: instant("demoted_at"),
    demotionReason: demotionReason("demotion_reason"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("calibration_bands_household_label_unique").on(t.householdId, t.bandLabel),
  ]
);

/** insight_ledger (data-model-spec §5). Findings decoupled from delivery. */
export const insightLedger = pgTable(
  "insight_ledger",
  {
    id: uuidv7Pk(),
    householdId: householdId(),
    findingType: text("finding_type").notNull(),
    payload: jsonb("payload"),
    route: insightRoute("route"),
    surfacedAt: instant("surfaced_at"),
    source: insightSource("source").notNull(),
    ...timestamps(),
  },
  (t) => [index("insight_ledger_household_route_idx").on(t.householdId, t.route)]
);

/** receivables (data-model-spec §5). Schema ships now; elicitation rows come later. */
export const receivables = pgTable(
  "receivables",
  {
    id: uuidv7Pk(),
    householdId: householdId(),
    expectedAmount: money("expected_amount"),
    sourceTransactionId: uuidRef("source_transaction_id"),
    description: text("description"),
    expectedBy: bankDay("expected_by"),
    state: receivableState("state").notNull().default("open"),
    matchedDepositId: uuidRef("matched_deposit_id"),
    ...timestamps(),
  },
  (t) => [index("receivables_household_state_idx").on(t.householdId, t.state)]
);

// ---------------------------------------------------------------------------
// §6 Composed artifacts, §7 LLM infrastructure, §8 Billing
// ---------------------------------------------------------------------------

export const artifactKind = pgEnum("artifact_kind", [
  "briefing",
  "monthly_close",
  "digest",
  "herald",
  "year_in_review",
  "tax_package",
  "correction",
]);

export const exportKind = pgEnum("export_kind", ["exit_package", "tax_package"]);

export const llmCallStatus = pgEnum("llm_call_status", [
  "ok",
  "parse_failed",
  "api_error",
]);

export const llmCacheType = pgEnum("llm_cache_type", [
  "adjudication",
  "question",
  "narrative",
]);

export const llmCacheStatus = pgEnum("llm_cache_status", [
  "pending",
  "complete",
  "failed",
]);

export const subscriptionPlan = pgEnum("subscription_plan", ["monthly", "annual"]);

/**
 * artifacts (data-model-spec §6). Every composed deliverable.
 *
 * A sent artifact is never silently revised: corrections are new rows that
 * reference the original, and the original is immutable.
 */
export const artifacts = pgTable(
  "artifacts",
  {
    id: uuidv7Pk(),
    householdId: householdId(),
    kind: artifactKind("kind").notNull(),
    memberId: uuidRef("member_id"),
    factPackage: jsonb("fact_package"),
    body: text("body"),
    sentMessageId: uuidRef("sent_message_id"),
    correctsArtifactId: uuidRef("corrects_artifact_id"),
    correctedByArtifactId: uuidRef("corrected_by_artifact_id"),
    period: text("period"),
    ...timestamps(),
  },
  (t) => [
    index("artifacts_household_kind_idx").on(t.householdId, t.kind),
    index("artifacts_period_idx").on(t.householdId, t.period),
  ]
);

/** exports (data-model-spec §6). R2 pointers. */
export const exports = pgTable(
  "exports",
  {
    id: uuidv7Pk(),
    householdId: householdId(),
    kind: exportKind("kind").notNull(),
    r2Key: text("r2_key").notNull(),
    requestedByMemberId: uuidRef("requested_by_member_id"),
    expiresAt: instant("expires_at"),
    ...timestamps(),
  },
  (t) => [index("exports_household_idx").on(t.householdId)]
);

/** llm_call_logs (data-model-spec §7). Feeds M21's cost-per-household. */
export const llmCallLogs = pgTable(
  "llm_call_logs",
  {
    id: uuidv7Pk(),
    householdId: householdId(),
    task: text("task").notNull(),
    merchantKey: text("merchant_key"),
    model: text("model"),
    fallbackUsed: boolean("fallback_used").notNull().default(false),
    messageId: uuidRef("message_id"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    status: llmCallStatus("status").notNull(),
    errorSnippet: text("error_snippet"),
    ...timestamps(),
  },
  (t) => [
    index("llm_call_logs_household_created_idx").on(t.householdId, t.createdAt),
    index("llm_call_logs_task_idx").on(t.task),
  ]
);

/**
 * llm_cache (data-model-spec §7). Ported exactly, including the claim
 * protocol: the pattern is the point, not the columns.
 */
export const llmCache = pgTable(
  "llm_cache",
  {
    id: uuidv7Pk(),
    householdId: householdId(),
    cacheType: llmCacheType("cache_type").notNull(),
    patternKey: text("pattern_key").notNull(),
    result: jsonb("result"),
    status: llmCacheStatus("status").notNull().default("pending"),
    claimedAt: instant("claimed_at"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("llm_cache_pattern_unique").on(t.householdId, t.cacheType, t.patternKey),
    index("llm_cache_status_claimed_idx").on(t.status, t.claimedAt),
  ]
);

/**
 * global_merchant_facts (data-model-spec §7). INVARIANT 6.
 *
 * GLOBAL: no household_id, no member_id, no amounts, no dates describing
 * household activity, no account details. The safety property is absence.
 */
export const globalMerchantFacts = pgTable(
  "global_merchant_facts",
  {
    id: uuidv7Pk(),
    merchantKey: text("merchant_key").notNull(),
    categoryName: text("category_name"),
    direction: transactionDirection("direction"),
    evidenceCount: integer("evidence_count").notNull().default(0),
    distinctHouseholds: integer("distinct_households").notNull().default(0),
    graduatedAt: instant("graduated_at"),
    blocked: boolean("blocked").notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("global_merchant_facts_key_unique").on(t.merchantKey, t.direction),
  ]
);

/** stripe_subscriptions (data-model-spec §8). */
export const stripeSubscriptions = pgTable(
  "stripe_subscriptions",
  {
    id: uuidv7Pk(),
    householdId: householdId(),
    stripeSubscriptionId: text("stripe_subscription_id").notNull(),
    stripeCustomerId: text("stripe_customer_id"),
    stripePriceId: text("stripe_price_id"),
    plan: subscriptionPlan("plan"),
    status: text("status"),
    currentPeriodEnd: instant("current_period_end"),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("stripe_subscriptions_subscription_unique").on(t.stripeSubscriptionId),
    index("stripe_subscriptions_household_idx").on(t.householdId),
  ]
);
