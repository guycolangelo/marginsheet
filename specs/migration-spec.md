# migration-spec.md
## Base44 → Postgres: export, transform, load, reconcile, cut over, decommission. Governs M9.
## Drafted 14 August 2026, last of the eight, inheriting every ruling of the day.

Scope: **one household** — the founder's. This is not a fleet migration tool; it is a careful move of one household's books with a reconciliation gate. Generality is explicitly non-scope.

---

## 1. Sequence

1. **Freeze** — pause Base44 syncs (`sync_status` held), note the freeze timestamp. The books stop moving.
2. **Export** — every entity via the Base44 API (query_entities, paginated), raw JSON to R2 (`migrations/base44-export-{date}/`), kept permanently. The GitHub escrow repo already holds the code; this holds the data.
3. **Transform** — the §2 map applied, pure functions, deterministic, run twice to prove it.
4. **Load** — into a dedicated Neon branch first; reconcile there; promote only on green.
5. **Reconcile** — the §3 gate. Fail → fix transform → reload branch. Never patch loaded data by hand.
6. **Cut over** — Plaid tokens live on the new pipeline (§4), first new-pipeline sync runs, reconciliation invariant green.
7. **Decommission** — Base44 app unpublished, not deleted, for a 90-day window; export retained forever; Plaid/Stripe secrets rotated out of Base44's environment.

---

## 2. The transform map (rulings applied)

| Base44 | → | Transform |
|---|---|---|
| `User` + `HouseholdMember` | `members` | Merge per data-model §1. **Phones do not exist in Base44** — members land unverified; the founder household completes phone verification in-app post-cutover, before any channel access (the M3 invariant does the enforcing). |
| `Household.trial_ends_at` | same | Founder household is past trial semantics; entitlement state carries as-is. `timezone`/`address` are new-null → completed in-app (blocks scheduled sends until set; acceptable for the founder). |
| `Category` where `pl_line = 'taxes'` | `fixed_obligations` | Parent renamed **Taxes After Takehome**; four children re-parented under it, lines moved. Seed **Gifts received**. |
| `Transaction.direction = 'unclassified'` | rewritten | Run `resolveDirection` logic in transform; zero survivors loaded. |
| `Transaction` string-JSON fields (payment_meta, counterparties, destination, chat_transcript) | jsonb | Parse; unparseable → null + logged, never a crash. |
| `Transaction` (all) | + `normalized_merchant_key` | Computed at transform with the single canonical normalization (categorization §11 fix, backfilled from day one). |
| `Transaction` (all) | + `account_type` | Denormalized from the account (was runtime-computed). |
| Refund pairs | **not backfillable** | Base44 matched but never stored the link; `refund_pair_id` starts null on history and populates only for post-migration refunds. Documented, accepted. |
| `MerchantCorrection` | `merchant_corrections` | Verbatim; `band_min/band_max` null (no bands existed). **Count is a reconciliation gate.** |
| `CategoryRule`, `SourceRename`, `ManualAsset`, `Institution`, `FinancialAccount`, `AccountBalanceSnapshot`, `LiabilityDetail`, `Invitation`, `TrialRecord`, `StripeSubscription` | same names, plural | Near-verbatim; ids remapped to UUIDv7 with an id-map table kept in the export folder. |
| `PlaidItem.access_token` | `access_token_ciphertext` | **Encrypted at transform** (AES-GCM, the Wrangler key); plaintext never lands in Postgres and is purged from the transform environment after cutover verification. |
| `WebhookEvent` | `provider_events` | Historical Stripe events carried for audit; source = stripe. |
| `LlmCache`, `LlmCallLog` | same | Verbatim (cache preserves the never-ask-twice economics across the migration). |
| — | New tables (commitments, goals, known_context, conversation state, etc.) | **Load empty.** Commitments bootstrap from the first Recurring refresh + the census when M15 runs. Conversation state begins at first real message. |

---

## 3. The reconciliation gate (all green or no promote)

1. **The figures:** July and August 2026 MarginSheets computed on the new M6a engine match Base44's `get-marginsheet` output **exactly** — income total, every source subline, every spending section, Kept, Margin, deployment, awaiting-reimbursement, transparency block. Verified against the database directly, never against reports.
2. **Counts:** transactions (per account, per month), merchant_corrections, category_rules, source_renames, categories — export count = loaded count, every table.
3. **Zero `user_reviewed` states lost** (answers are authoritative; losing one silently re-asks a settled question).
4. **Zero learned records lost** (losing one silently re-asks, worse).
5. Reimbursable lifecycle states intact, pair links intact.
6. Split parent/child sums intact.
7. Every transformed jsonb field parses back; the unparseable-log is reviewed and each entry dispositioned.
8. Direction rewrite audit: every former `unclassified` row's new direction listed and eyeballed (founder-scale, so eyeballing is real).

---

## 4. Plaid cutover: tokens move, Items do not re-link

Access tokens bind to the **Plaid client credentials**, which Guy owns — not to Base44. Tokens therefore migrate as data (encrypted per §2), and the founder's Items keep working with **no re-linking, no duplicate Items, no double billing.** Verification: `/item/get` per Item from the new pipeline, then one full incremental sync (cursor carried over) landing green under the reconciliation invariant. Webhook URL re-pointed at the new pipeline **before** unfreezing; the freeze-window gap is closed by the first sync (`/transactions/sync` cursor semantics make the gap self-healing — this is why the freeze is safe).

Stripe needs no migration beyond secrets custody: customer, subscription, and webhook endpoint re-point; `provider_events` starts fresh with history carried for audit.

---

## 5. Rollback

Until decommission: Base44 republish + webhook re-point restores the old world in minutes (the freeze means no divergence except the gap, which re-syncs). After the founder has run live on the new pipeline for 7 clean days, rollback is retired and the 90-day unpublished window begins.

---

## 6. Invariants (M9 test seeds)

1. Transform is deterministic: two runs, identical output (hashed).
2. Reconciliation gate is a script with a binary exit, not a checklist read by a tired human at midnight.
3. Plaintext access tokens exist nowhere after cutover verification (environment scan asserted).
4. The id-map allows any new row to be traced to its Base44 ancestor for the life of the export.
5. First post-cutover sync produces zero duplicate transactions (cursor + `plaid_transaction_id` uniqueness).
6. Base44 write credentials are dead after decommission (attempted write fails).

**This gate is also the M9 checkpoint from the plan: platform complete, founder migrated, Base44 dark — the 1 October stretch marker.**
