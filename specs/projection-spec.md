# projection-spec.md
## Household Goals, the projection engine, and the Cash Flow engine.
## Governs the forward-looking half of M6. Revised 14 August 2026 per Guy's rulings.

Companion to `ledger-spec.md`, which governs actuals. Nothing here exists in Base44; this is a design, not an extraction.

---

## 1. The core, stated

The product's core is three things:

1. **The brains** (MyKeeper, MyCFO) — governed by the conversation service spec
2. **The MarginSheet** — actuals (ledger-spec) plus projections (this document)
3. **Cash Flow** — money in and money out of the bank, across all depository accounts, with forward-looking scenarios and projections (this document)

The two-ledger rule from the brain spec splits surfaces 2 and 3: the MarginSheet is the verdict (*did we get ahead this month*), cash flow is the choreography (*will this payment clear, from this account, on this date*).

Both engines are **deterministic code. The LLM never projects, never estimates, never fills a gap.** Projections enter composed prose only through the fact package.

---

## 2. Stated versus computed: the three objects

Guy's rename split what an earlier draft had fused. The system holds three distinct objects:

| Object | Nature | Who makes it |
|---|---|---|
| **Household Goals** | Stated | The household, with MyCFO |
| **The projection** | Computed | The engines, from the books |
| **On track or not** | The comparison | Projection measured against Goals |

**Household Goals** is the named product object holding what the household has committed to. It is set with MyCFO: sometimes at onboarding (the day-one goals question already writes to known_context), sometimes in conversation (a scenario the household adopts, a target they name), and definitively at the Annual Planning Session, whose output — the Annual Plan — is the fullest form of Household Goals.

Contents at launch:
- **Margin target** — household-chosen. The Method's 20% floor is the citable default ("The Method states 20% as the floor"), never an imposed one; the household's own number governs.
- **Life Happens fund target** — months chosen by the household, dollar target computed by MyCFO per the brain spec's resilience-number doctrine.
- **Goals** — the known_context entries of type *goal*, now with a defined consumer.
- **The Annual Plan** (2027) — expected income, planned commitments, the Margin the year is shaped to produce.

Storage: Household Goals is a first-class M1 entity, not a scattering of known_context flags. known_context *goal* entries link to it; provenance and revisit doctrine (goals never self-expire; one revisit at the Annual Planning Session) carry over unchanged.

**Month awareness gets its referent.** The brain spec assigns MyCFO "month awareness (on track or not)" and referenced "the Margin Plan engine's outputs." *On track against what* was undefined. Now: on track means the projection measured against Household Goals. A household with no stated goals yet is measured against the Method's published floor, cited as the Method's per the carve-out.

---

## 3. The projection engine (MarginSheet, projected)

Answers: **where is this month heading, and what will it leave?**

### 3.1 Output shape

Current month only. Past months are settled; future months are the Annual Plan's jurisdiction.

```
ProjectedMonth {
  income_expected:    by source — actuals to date + expected remaining arrivals
  spending_projected: by line and category — actuals to date + committed remaining + likely remaining
  kept_projected, margin_pct_projected, verdict_projected
  vs_goals:           { margin_target, on_track: boolean, gap }     // the §2 comparison
  component_kinds:    posted | committed | estimated, per component
  as_of
}
```

### 3.2 The blend

Three layers, summed per category:

1. **Actuals to date.** Everything posted this month, per ledger-spec rules.
2. **Committed remainder.** Commitments (§6) whose expected date falls in the rest of the month and which have not yet posted. Matched commitments are never double-counted.
3. **Likely remainder.** For variable categories with no commitment structure (groceries, dining, fuel): the category's trailing 6-month **median** × fraction of month remaining. Median, not mean, so one anniversary week does not inflate every future month.

**Why layer 3 exists, plainly.** On the 14th, groceries show $900 posted and the month has two more weeks of grocery runs in it. Committed-only projection carries groceries at $900 for the month, understating spending and overstating projected Kept — optimistic error, the direction that produces surprise, which is the one failure the tagline forbids. The likely layer fills the remainder at the household's own run rate, labelled **estimated** so it never masquerades as fact. The site's August demo (Groceries $1,950 projected mid-month) requires this layer. **Ruled in, 14 August.**

Income mirrors: arrived + expected remaining arrivals from income commitments, per receiving account (§4).

### 3.3 Confidence, disclosed not scored

No confidence percentages anywhere. Every projected component is labelled **posted**, **committed**, or **estimated**. The fact package carries the labels; that is how MyCFO says "projected to run about $1,200 over" without the composer inventing certainty.

### 3.4 The overspend condition

`kept_projected < 0` is the overspend heads-up condition. This engine owns detection (recomputed on every sync and nightly); the watcher owns delivery.

---

## 4. The Cash Flow engine (choreography)

Answers: **will this payment clear, from this account, and when is the tight week?**

### 4.1 Scope: all depository accounts, per-account attribution

**All checking and savings accounts, ruled 14 August.** Households route money in ways the engine must not assume: paychecks split by the employer between checking and savings, mortgages pulling from a different account than the cards, multiple banks.

Attribution is learned from matched history, not configured: a commitment's `account` field records where its transactions actually land or pull from (§6). The paycheck that deposits to savings is a savings inflow; the mortgage that pulls from the second checking account is that account's outflow. When a household moves an autopay between accounts, the next matched transaction re-attributes the commitment, and one changed account within the amount band is re-attribution, not a new commitment.

### 4.2 The balance path

Per depository account, plus the household sum:

```
BalancePath {
  account | "all_depository", as_of, current_balance
  days: [ { date, expected_in[], expected_out[], projected_balance } ]   // 91-day horizon
  minimum: { date, amount }              // the trough
  tight_week: { start, end }             // lowest-minimum rolling 7 days
  events: [ short { commitment, account, shortfall, date }
          | short_but_covered { commitment, account, shortfall, date,
                                household_cash_total, where_it_sits } ]
}
```

**Horizon: 13 weeks, a full rolling quarter. Ruled 14 August.** The corporate 13-week cash flow, brought home. Daily resolution throughout; rendering may bucket weeks 6 through 13 weekly. What the quarter horizon buys that 35 days cannot: the quarterly estimated payment visible from the day the quarter starts, the semiannual insurance visible ninety days out, September already looking lighter from mid-August — which is exactly the sentence the homepage demo has MyCFO say. Precision decays with distance and the committed-only rule makes that safe: the tail carries only dated commitments, never estimates.

**Committed items only, on the path.** Norm-based estimates get no dates, and choreography is about dates. The projected trough is therefore optimistic on outflows in the one direction that makes warnings trustworthy: if the conservative path shows a shortfall, real discretionary spending only deepens it. A fired warning is never a false alarm caused by an estimated grocery run.

Card autopay amounts come from `LiabilityDetail` (statement balance, due date) when available, else the Recurring stream's average.

### 4.3 The two shortfall classes

Per-account paths plus the household sum yield two distinct events, and the distinction is a product moment:

**`short`** — the account comes up short and household cash does not cover it. The existing can't-cover doctrine: the watcher's marquee rule, fire-ahead window 3 to 5 days, follow-up register per the brain spec.

**`short_but_covered`** — the pulling account comes up short while the household's total cash covers it comfortably. The sum is fine; the money is in the wrong account. New watcher rule, same gauntlet, its own register:

- **Advice gate discipline.** "You need to move cash around" names an action with money and fails the gate. The passing shape is the state, fully: shortfall, location, sufficiency. Canonical fixture:

> "The Amex autopay pulls from checking Friday at $3,180, and checking is projected around $2,400 by then. The household's total cash covers it three times over; savings is holding $11,600."

The household completes the thought. Softer register than `short`: this is logistics, not danger, and the composed message must not borrow the can't-cover alarm.

### 4.4 What the engine feeds

- **Watcher:** `short` (can't-cover), `short_but_covered` (new), income-missed and commitment-missed via §6 lifecycle, price-change via band violation
- **Fact package cash choreography block:** payday cadence per account, commitment clusters, the tight week, "you'll want about $2,300 in checking by the 14th" as computed fact
- **The Cash Flow surface** (M8): balance paths drawn per account and summed, commitments on their dates, the tight week and the trough visible, 13 weeks out
- **Scenario cash-side answers** (§7)

---

## 5. The two-ledger answer, mechanical

`ScenarioAnswer.ledgers_diverge` is computed, not judged: the Margin ledger says it fits (`kept_projected` acceptable against Household Goals) while the cash ledger shows a `short` event, a `short_but_covered` event, or a materially deepened trough in the payment's landing window. Divergence forces the two-ledger answer shape per the brain spec. The canonical truck answer is this section's golden test.

---

## 6. The commitment model (shared substrate)

One table feeds both engines: the projection engine reads it aggregated by month, the Cash Flow engine reads it laid out by date and account.

```
Commitment {
  household, merchant_key, direction: inflow | outflow
  account                       // learned from matched history; re-attributes on account change
  cadence: weekly | biweekly | semimonthly | monthly | every_other_month |
           quarterly | semiannual | annual | irregular
  expected_amount: { kind: fixed | banded, amount | band_min..band_max }
  next_expected_date, window_days          // e.g. 15th ± 3
  category, pl_line
  source: plaid_recurring | census | liability_detail | household_stated
  status: active | paused | ended
  last_matched_transaction, consecutive_misses
}
```

**Sources, ascending authority (higher overrides lower per stream):**
1. **Plaid Recurring** — already purchased at $0.15/Item, currently unconsumed. Detected inflow and outflow streams with frequency, average amount, predicted next date. The day-one bootstrap: a commitments list exists at first sync, before the census runs.
2. **The census** (M15) — the long cadences Plaid misses: every-other-month insurance, quarterly estimateds, annual renewals. Reconciles against Recurring rather than duplicating; may correct a stream's cadence.
3. **LiabilityDetail** — exact statement balances and due dates for card autopays; the statement is fact, the average is inference.
4. **Household statements** — a known_context plan with teeth ("the trip is in November") entering as a dated commitment. Always wins, matching the filing hierarchy's local-always-wins.

**Lifecycle:** a posting transaction inside the window matches, rolls `next_expected_date` forward, and confirms `account`. A missed window increments `consecutive_misses` and signals the watcher's income-missed / commitment-missed rules (detection here; register and delivery in the brain spec). Two consecutive misses pause; paused commitments leave projections but stay visible. Price-change detection is a match outside the amount band. An account change within the band is re-attribution, not a miss.

**The materiality gate does not apply.** It gates questions, not math. A $12 subscription belongs in the projection; it never earns a text.

---

## 7. Scenarios

The overlay model for MyCFO's arithmetic (M18):

```
Scenario = deltas [ { one_time | recurring | remove_recurring, amount, category,
                      date | cadence, account? } ]
```

Applied against baseline without mutating it: Margin ledger before and after (`kept`, `margin_pct`, vs. Goals), cash ledger before and after (trough, shortfall events, per account when the pulling account is known or asked), `ledgers_diverge` per §5. Amortization for loan scenarios is arithmetic inside the engine. Estimates the engine cannot compute follow the brain spec's sourced-or-asked rule: compute the household's current analog when the books contain one, labelled with its source; otherwise ask.

Adopted scenarios become `household_stated` commitments and, where they carry a target, update Household Goals. The decision journal records the rest.

---

## 8. Consumers

| Consumer | Takes |
|---|---|
| MarginSheet page, projected column | §3, with component kind labels |
| Household Goals surface (M8) and the 20%-aim rendering | §2, with the Method-attributed default |
| Close email, "the month ahead" | §3 via fact package |
| Overspend heads-up | §3.4 + driver decomposition |
| Watcher: can't-cover, short-but-covered, income-missed, commitment-missed, price-change | §4 events + §6 lifecycle |
| MyCFO month awareness (on track or not) | §3 `vs_goals` via fact package |
| MyCFO scenarios, two-ledger answers | §7 |
| Cash Flow surface (M8), 13 weeks, per account | §4 |
| Annual Planning Session (2027) | §2 Goals + §6 commitments + seasonal shape |

---

## 9. Plan impact

- **M6 splits.** M6a: actuals engine (port per ledger-spec, ~1 week). M6b: this document — the commitment model, both engines, Household Goals (new build, ~2 weeks with the 13-week horizon and per-account paths). M6b lands after M4 and before M8 and M17.
- **M1 additions:** `Commitment`, `HouseholdGoals`, `RefundPair` (or reuse of the reimbursement pairing pattern), category `Gifts received`.
- **M4 addition:** `RECURRING_TRANSACTIONS_UPDATE` webhook.
- **M17 addition:** the `short_but_covered` rule and its register.
- **Golden tests:** the site's August demo (insurance two-payment month, open home-improvement run, quarterly estimated, projected Overspent $1,200 at (6%)) is the M6b fixture. The truck answer is the §5 fixture. The `short_but_covered` fixture is §4.3's canonical message.

---

## 10. Resolved 14 August

1. **Likely layer ships.** Kind labels do the honesty work; committed-only would err optimistic every month.
2. **Cash Flow covers all depository accounts** with learned per-account attribution; the `short_but_covered` event is the product payoff.
3. **Horizon: 13 weeks rolling**, daily resolution, committed-only on the path. Margin Plan projection remains current-month-only.
4. **Household Goals** replaces the "Margin Plan" name; stated versus computed split per §2.
