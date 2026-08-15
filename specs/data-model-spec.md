# data-model-spec.md
## The Postgres schema. Governs M1.
## Drafted 14 August 2026. Merge of: Base44's 20 entities (extracted), the conversation service spec's named objects, and the 14 August rulings.

---

## 0. Ground rules

- **One database.** Neon Postgres holds app data *and* conversation state. D1 is dropped (ruled 14 August): a question resolution that mints a learned record and clears conversation state is one transaction, and the reconciliation invariant deserves that.
- **IDs:** UUIDv7 (time-ordered) everywhere. Base44 string ids map across in migration.
- **Money:** `numeric(14,2)`. Never floats. **Plaid's sign convention is preserved and documented once, here: positive = outflow (expense), negative = inflow.** Every consumer inherits this; no layer flips signs.
- **Dates:** transaction dates are `date` (bank-day semantics); everything else `timestamptz`. Household timezone lives on the household; scheduled sends compute in it.
- **JSON:** `jsonb` for genuinely polymorphic payloads (payment_meta, counterparties, destination, rule conditions/actions, teeth, fact packages). Everything with a fixed shape gets columns.
- **Deletion:** soft everywhere the doctrine cares (tombstones for known_context, `removed` for transactions); hard deletion exists only through the retention/privacy path (M20).
- **RLS:** re-implemented in Postgres per household, mirroring Base44's pattern: member-readable household data, service-role-only for tokens, logs, caches.
- **Every table carries** `household_id` (except global/system tables), `created_at`, `updated_at`.

Naming: snake_case tables, singular Base44 entity names pluralized (`Transaction` → `transactions`).

---

## 1. Identity and membership

### `households`
Ported from `Household`, extended.
- `name`
- `entitlement_state`: `trialing | active | past_due | canceled | expired` (null until first checkout)
- `trial_ends_at` — **14-day semantics now**; `grace_period_ends_at` (14 days past failed renewal, ported)
- `stripe_customer_id`
- `connected_first_account_at`, `first_sync_completed_at` (onboarding milestones, ported — the intro trigger reads the second)
- **New:** `address` (jsonb), `timezone` (IANA, derived from address at onboarding; all scheduled sends compute in it), `hardship_flag` (boolean — set by a named life event; flips composed-artifact tone per the brain spec; cleared manually)
- **New:** `avg_monthly_income` (numeric, recomputed by the floor calculation; cached here so the materiality gate doesn't rescan history per call)

### `members`
**Replaces `HouseholdMember` and the Base44 `User` role model.** The brain spec's membership doctrine wins (ruled in the manifest): staff serve the household.
- `household_id`, `auth_user_id` (Better Auth's user id — auth tables live alongside, owned by Better Auth's migrations; this is the join point)
- `first_name`, `display_name`, `email`
- **`phone` + `phone_verified_at`** — the security primitive. SMS routing matches on verified phone only. Phone changes happen in-app only (SIM-swap defense); no write path from a channel.
- `role`: `full_member | contributor` — contributor is PARKED post-launch but **the column ships day one** (the spec's own lesson: a flag, not a migration)
- `is_primary` (billing owner; invitation rights)
- `status`: `active | removed`
- Per-member preference columns stay OUT of this table — preferences are standing instructions (§6)

### `invitations`
Ported as-is: token, invited_email, status `pending|accepted|canceled|expired`, `expires_at` (14 days). Loses denormalized names (join instead).

### `trial_records`
Ported exactly: `normalized_email` (lowercased, plus-aliases stripped, gmail dots stripped), `card_fingerprint`, household, `trial_started_at`. **Add `exempt` boolean** — founder-invited beta households bypass abuse checks (ruled: promo-code beta).

### `consent_records`
**New.** TCPA and marketing consent, per member: `kind` (`sms_transactional | sms_marketing | email_marketing`), `granted_at`, `revoked_at`, `source` (signup checkbox, in-app). The A2P campaign-vetting asset. Signup spine captures `sms_transactional` (ruled: consent moves into the spine).

---

## 2. Banking and sync

### `institutions` (global, ported)
`plaid_institution_id`, `name`, `logo_url`.

### `plaid_items`
Ported: `institution_id`, `item_id`, `status` (`healthy|needs_reauth|error|disconnected`), `last_successful_sync`, `sync_cursor`, `sync_status` (`idle|syncing|queued|error`), `last_synced_at`.
- **`access_token_ciphertext`** — encrypted at rest (app-layer AES-GCM with a key in Wrangler secrets; Neon's disk encryption is not sufficient for this column). Never returned to any client, never logged, never in RLS-readable scope. Decrypt only inside the sync worker.

### `financial_accounts`
Ported in full: plaid_account_id, name, official_name, mask, type, subtype, balances, credit_limit, iso_currency, `in_payoff_pool`, `classification_confirmed_at`, `card_state` (`paid_in_full|revolving|overdue|unavailable`), `carried_balance`, `is_active`.

### `account_balance_snapshots`
Ported: one per account per day, `current_balance`, `available_balance`. Unique `(account_id, date)`. Feeds the Cash Flow engine's `as_of` and reconciliation.

### `liability_details`
Ported in full (statement balance/date, minimum payment, due dates, APRs, promo expiry, is_overdue, fetched_at). Feeds commitments (projection-spec §6 source 3) and cost-of-capital later.

### `provider_events`
**Generalizes `WebhookEvent`.** One idempotency ledger for every inbound provider callback: `source` (`stripe | plaid | twilio | postmark`), `event_id`, `event_type`, `processed_at`, `payload` jsonb. Unique `(source, event_id)`. Every webhook handler checks-and-inserts here first.

---

## 3. The ledger

### `categories`
Ported, with the ruling applied:
- `pl_line` enum: `income | fixed_obligations | variable_operating | discretionary | interest_fees | transfer | deployment` — **`taxes` is not a line.**
- Migration remaps every `taxes` category to `fixed_obligations`; parent "Taxes" renames to **"Taxes After Takehome"**; the four tax subcategories keep their names under it. `MerchantCorrection.pl_line` needs no change (it never had taxes).
- **New seeded system category: "Gifts received"**, `pl_line = income` (ruled 14 August; filled by the question machinery, never by detection).
- "Interest earned" remains created-on-demand under Other income.
- Fields: name, icon, color, parent_id, is_archived, sort_order, plaid_pfc_mappings (text), is_system.

### `transactions`
Ported in full, with fixes:
- All Plaid fields as extracted (payment_meta and counterparties become `jsonb`, not serialized strings)
- `direction` enum **drops `unclassified`** (legacy, never set; migration rewrites any survivors per resolveDirection)
- **New: `normalized_merchant_key`** — stored at write time using the single canonical normalization (fixes categorization-spec §11: correction matching, recurrence inheritance, and refund matching all key on the same stored value). Indexed with `(household_id, normalized_merchant_key, direction)`.
- **New: `refund_pair_id`** — mirrors `reimbursement_pair_id`; stores the matched prior purchase so drill-down can show "refund of the June 3 purchase" (ruled)
- `account_type` denormalized (Base44 computed it at runtime for correction keying; store it)
- Everything else verbatim: pending/removed flags, review_state, queue_reason (enum now includes `ambiguous` — the code's value; the stale schema enum loses), is_transfer/transfer_pair_id, is_reimbursable/reimbursement_status/reimbursement_pair_id, possible_deployment, destination jsonb, split_parent_id, is_provisional, confidence, notes, chat_transcript (jsonb)
- Indexes: `(household_id, date)`, `(household_id, review_state) where review_state = 'needs_review'`, `(account_id, date)`, unique `plaid_transaction_id`

### `merchant_corrections`
Ported: normalized merchant_name, direction, account_type, category, subcategory, pl_line, is_transfer, correction_count, last_corrected_at, `source` (`user | llm`).
- **New: `band_min`, `band_max`** (nullable) — the brain spec's banded rules for opaque deposit merchants. A correction with a band applies only inside it; the deposit-cluster machinery mints the band from the cluster it asked about. Null band = all amounts (today's behavior).
- `source` gains `global` when the Keepers' guild lands (column ready, value unused at launch).

### `category_rules`
Ported: name, conditions jsonb, actions jsonb, account_scope, is_active, source (`manual | learned`).

### `source_renames`
Ported: merchant_key, display_name.

---

## 4. Projections (per projection-spec)

### `commitments`
Per projection-spec §6, verbatim: merchant_key, direction, **account_id** (learned attribution), cadence enum (weekly…annual, irregular), expected_amount jsonb (`{kind: fixed|banded, …}`), next_expected_date, window_days, category_id, pl_line, `source` (`plaid_recurring | census | liability_detail | household_stated`), status (`active|paused|ended`), last_matched_transaction_id, consecutive_misses.
- Unique-ish key: `(household_id, merchant_key, direction, cadence, account_id)` with source-authority upsert (higher source overrides lower per stream).

### `household_goals`
Per projection-spec §2: `margin_target_pct` (nullable — absent means the Method default is cited, never imposed), `life_happens_target` jsonb (`{months_chosen, dollar_target, computed_at}`), `annual_plan` jsonb (2027; shape TBD with Module 11), `set_with` provenance (onboarding | conversation | annual_session), `updated_by_member_id`. One row per household. known_context `goal` entries link via `household_goals_id` on the context entry.

---

## 5. Conversation state (was D1; now co-located)

### `threads`
One per (member, brain): `member_id`, `brain` (`mykeeper | mycfo`), `last_activity_at`. The 4-hour greeting window is computed from `last_activity_at` in code — thread state is a timestamp, not a machine.

### `messages`
Every inbound and outbound, both channels:
- `member_id`, `brain`, `direction` (`inbound | outbound`), `channel` (`sms | email`)
- `provider_message_id` — unique per provider; inbound dedup key (with `provider_events` covering webhook-level retries)
- `message_class` (the fact-package `MessageClass` for outbound; null inbound)
- `body`, `fact_package` jsonb (outbound; the exact package the composer received — the audit trail for traceability), `fact_package_version`
- `gate_result` jsonb (`{lint_pass, judge_pass, attempts, degraded_to_fixture}`) — outbound only; **recorded before send** per the spec's "every outbound message is recorded before send"
- `model_used`, `fallback_flag` (instrumentation for the tiered chains)
- `status`: `composed | held_shadow | sent | failed | suppressed_no_gate`
- Index: `(household_id, created_at)`, `(member_id, brain, created_at)`

### `question_dispatches`
The queue itself stays derived from `transactions.review_state + queue_reason` (Base44's design, kept — one source of truth). This table tracks the *conversation about* queue items:
- `group_key` (the cluster: merchant|direction or deposit-cluster id), `transaction_ids` (uuid[])
- `question_text`, `best_guess` jsonb (category + internal band label — **internal, never composable**)
- `answer_space` jsonb
- `sent_to` member_ids, `sent_at` per member (same question, separate threads)
- `state`: `pending | answered | clarifying | returned_to_app | conflicted`
- `answered_by_member_id`, `answer` jsonb, `resolved_at`
- `clarification_count` (capped 1 by code), `conflict` jsonb (both answers, both names — surfaced, never silently adjudicated)
- First-batch cap of 3 is code, reading this table's history.

### `known_context`
Per the brain spec's LOCKED schema, exactly:
- `type` enum (closed): `goal | plan | fact | worry | preference | decision`
- `text`
- Provenance: `said_by_member_id`, `said_at`, `source_message_id`
- Lifecycle: `state` (`active | dormant | expired`), `expires_at` (plans self-expire on their own calendar), `superseded_by_id` (contradiction supersedes, never accumulates)
- **No confidence field, ever** (doctrinal; enforced by absence)
- `teeth` jsonb (nullable): machine consequences — routing flags, watch windows, expected amounts, `commitment_id` links, `household_goals_id` links
- Deletion: `deleted_at` + `tombstones` row; a deleted entry never enters a fact package (query-level exclusion, tested)

### `standing_instructions`
Tags-to-watch, thresholds, timing, routing — the brain spec's three launch preference types plus tag watches:
- `member_id` (all preferences per-member, no exceptions), `type` (`threshold | timing | routing | watch_tag`)
- `parameters` jsonb, `stated_in_message_id`, `active`
- Broadcast floor is config (message-class list), not a row here — no instruction can silence it.

### `tags` + `tag_members`
The tag exchange's output: `tags` (name, created_by, watch flag → standing instruction link), `tag_members` (tag_id, merchant_key or transaction_id, `certainty`: confirmed | maybe, excluded flag — Dugout Mugs is an exclusion row, remembered forever).

### `decision_journal`
Per brain spec: `question_as_asked`, `arithmetic_shown` jsonb (the ScenarioAnswer package), `decision` (`adopted | passed | undecided`), `decided_at`, `related_commitment_id` (when adopted). Memory, never scorekeeping — surfacing rules are composition-side.

### `handoffs`
`from_brain`, `to_brain`, `question_summary`, `source_message_id`, `state` (`open | fulfilled`), `fulfilled_at` — the 3-minute budget measured from these two timestamps.

### `condition_states`
The watcher's dedup memory: `rule_id`, `subject` jsonb (commitment/account/stream), `state` (`fired | acknowledged | resolved | escalated`), `first_fired_at`, `last_fired_at`, `followup_sent` (the one-follow-up rule), `fire_ahead_window` snapshot. A condition persisting across six syncs is heard about once — enforced by unique `(household_id, rule_id, subject_hash)` upsert.

### `calibration_bands`
The graduation loop's ledger, per (household, band): `band_label`, `guesses`, `matches`, `trailing_window` jsonb, `state` (`asking | silent`), `graduated_at`, `demoted_at`, `demotion_reason` (`accuracy | double_fault`). Digest spot-check sampling reads `state = silent`.

### `insight_ledger`
Census and close-maintenance findings, decoupled from delivery: `finding_type`, `payload` jsonb, `route` (`fact_package | watcher | elicitation | wait`), `surfaced_at` (null until used), `source` (`census | monthly_maintenance`).

### `receivables`
Household AR beyond the transaction flags (brain-spec post-launch feature, **schema ships now** — the role-column lesson): `expected_amount`, `source_transaction_id` (nullable), `description`, `expected_by`, `state` (`open | matched | written_off`), `matched_deposit_id`. Launch behavior: rows created only from reimbursable transactions; elicitation-created rows come later with no migration.

---

## 6. Composed artifacts

### `artifacts`
Every composed deliverable, because a sent artifact is never silently revised: `kind` (`briefing | monthly_close | digest | herald | year_in_review | tax_package | correction`), `member_id` (recipient), `fact_package` jsonb, `body`, `sent_message_id`, `corrected_by_artifact_id` (nullable — the correction chain), `period` (for closes/digests). The mistake doctrine's tier-2 mechanics operate on this table: correct the books, then send the correction artifact referencing the original.

### `exports`
R2 pointers: `kind` (`exit_package | tax_package`), `r2_key`, `requested_by`, `created_at`, `expires_at`.

---

## 7. LLM infrastructure

### `llm_call_logs`
Ported: task, merchant_key, input/output tokens, status (`ok | parse_failed | api_error`), error_snippet. **Add:** `model`, `fallback_used`, `message_id` (nullable) — feeds M21's cost-per-household against the margin model.

### `llm_cache`
Ported exactly, including the concurrency pattern that must survive: cache_type (`adjudication | question | narrative`), pattern_key, result, `status` (`pending | complete | failed`), `claimed_at` — **stale claims (>5 min) treated as failed.** Unique `(household_id, cache_type, pattern_key)`.

### `global_merchant_facts`
The Keepers' guild substrate, **designed now, populated later** (the spec's instruction: built with graduation paths, not retrofits): `merchant_key`, `category_name` (name, not household category id — global facts are category-semantic), `direction`, `evidence_count`, `distinct_households` (the k-anonymity counter; graduation at ≥5), `graduated_at` (null until k met), `blocked` (person-name/P2P heuristic flag). No amounts, no dates, no account details, ever — enforced by the table simply having no columns for them.

---

## 8. Billing

### `stripe_subscriptions`
Ported: subscription/customer ids, `plan` (`monthly | annual`), status mirror, current_period_end, cancel_at_period_end, price id.

### Promo/beta
No new table: Stripe coupons are the source of truth (ruled: repeating coupon, card required, no trial stacking for beta). `trial_records.exempt` covers the abuse-check bypass.

---

## 9. Migration map (Base44 → here), the notable rows

| Base44 | Here | Change |
|---|---|---|
| `User.role` admin/user + `HouseholdMember.role` owner/member | `members.role` + `is_primary` | Brain-spec model wins; admin becomes infra, not data |
| `Household.trial_ends_at` (60-day semantics) | same column | 14-day; beta households null-trial + coupon |
| `Category` pl_line `taxes` | `fixed_obligations` | Parent renamed Taxes After Takehome; children move with it |
| `Transaction.direction` `unclassified` | dropped | Rewrite survivors via resolveDirection |
| `Transaction.payment_meta/counterparties/destination/chat_transcript` (strings) | jsonb | Parse on load |
| merchant history key (plain lowercase) | `normalized_merchant_key` stored | One key everywhere |
| `WebhookEvent` (stripe) | `provider_events` | All four providers |
| `LlmCache` | ported | Pattern intact |
| — | 20+ new tables (§4–§7) | The conversation service's state |

Reconciliation criteria (migration-spec will own): post-migration July/August figures match Base44 exactly; zero merchant_corrections lost; zero user_reviewed states lost.

---

## 10. Invariants (M1 test suite seeds)

1. A transaction's household, account's household, and item's household always agree (FK chain, asserted).
2. `access_token_ciphertext` is unreadable by any RLS role; only the sync worker's service role decrypts.
3. known_context has no confidence column and no code path can add one to a fact package (type-level, per M2).
4. A deleted known_context entry never appears in any fact-package query (tombstone join, tested).
5. `provider_events` unique constraint makes every webhook handler idempotent by construction.
6. `global_merchant_facts` physically cannot store amounts, dates, or account details.
7. `messages.gate_result` is non-null on every `sent` outbound row (no gate, no send — enforced by a check constraint on status transition).
8. One transaction: answer → correction minted → queue cleared → dispatch resolved. No partial states under crash (this is why D1 died).
9. `transactions.direction` never holds `unclassified`.
10. Unique `(source, event_id)`, `(account_id, date)` on snapshots, `plaid_transaction_id`, LLM cache pattern keys — all collisions are upserts, never duplicates.

---

## 11. Open for Guy

1. **Encryption key custody** for Plaid tokens: Wrangler secret (simple, recommended for launch) vs. an external KMS (stronger rotation story, more moving parts). Recommendation: Wrangler secret now, rotation procedure documented in the Infosec Program.
2. **`chat_transcript` on transactions** (the in-app bookkeeper chat) — port as-is, or fold into `messages` with a transaction link? Recommendation: port as-is for migration fidelity; unify post-beta.
3. Anything in the seventeen legacy specs that names an entity this document lacks — this is the merge's blind spot until you send the list of which specs survive.
