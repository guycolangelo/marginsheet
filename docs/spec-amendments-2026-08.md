# Spec amendments, August 2026
## Ruled by Guy 15 August 2026. Recorded, not built. Each names the spec it amends.
## Authority: these sit at the same level as the spec text they amend (CLAUDE.md authority hierarchy, tier 4). Where they conflict with the original spec, these win.

---

## 1. Year-end projection (amends `projection-spec.md` §3)

The Dashboard renders Margin and cash position across four horizons: year to date, last month settled, this month projected, and **year end projected**. That fourth horizon is a new engine output. Everything currently specified is current-month or 13-week.

### Basis

Commitments are knowable to year end: cadence, amount and dates are already in the `commitments` table, so the fixed skeleton extends forward with real confidence. Variable categories (groceries, dining, fuel and the like) are **recurring expenses with variable amounts, not unknowns**, and they project from trailing behaviour.

Two bases by horizon:

- **Current month and near horizon:** trailing 3-month **median** per category.
- **Months further out:** seasonally adjusted from history where the census has found a seasonal shape; falls back to the trailing median where it has not.

**Why trailing-3 alone is wrong at year end.** It cannot see seasonality. Projecting from a summer window extends summer spending across November and December; the same window run in January extends holiday spending across the year. **The error is directional, not random**, which is what makes it unacceptable rather than merely imprecise. The census already finds seasonal shape from up to 24 months (M15), and year end is the horizon that needs it.

**Median, not mean**, for the same reason as the month projection: one anniversary week should not inflate five months.

### Honesty consequence, to be stated in the spec

A household with 3 months of history gets a straight extension **and the projection must be honest that it is one**. A household with 18 months gets a seasonally shaped figure. Same field, different basis, and **the basis is part of what the kind label carries**.

### What it is not

Not a plan, not a target, not a promise. Arithmetic on current trajectory. **It is the softest number in the product and the one households will quote back at us.**

---

## 2. Goal prioritisation (amends `projection-spec.md` §2 and the conversation service spec's day-one flow)

Household Goals has no notion of priority. A household may name a dozen goals; the Dashboard shows two or three. MyKeeper's day-one goals question gains a beat: after the household names goals, **ask which two or three matter most**.

Needs:
- a priority field on the goals structure or on `known_context` goal entries
- the conversational beat specified in the day-one flow
- a rule for what happens when a household names none, names one, or names all of them

### Constraint

The assistant **asks** which matter most and **never tells them which should**. Priority is stated by the household, exactly like `margin_target_pct`. A system that decides which goals matter is a system with opinions about what a household should want.

---

## 3. Dashboard (new ninth surface, amends `app-ui-spec.md` §1 and §1a)

**RULED: Dashboard ships as a ninth surface and is the landing screen.** Guy's earlier lean was to drop it; the design settled it the other way, because it is not a summary of other surfaces. It is a time-series view across four horizons that no other surface provides.

**Framing:** a household should never *need* to sign in, because they can just ask. When they do sign in, they see the whole picture without navigating. Executive summary, not dashboard-of-tiles.

### Four blocks

1. **Margin** across four horizons: YTD, last month settled, this month projected, year end projected. Kind labels on projected figures.
2. **Cash position** across the same four: YTD net change in dollars, last month net change, this month projected net change plus projected balance at month end, year end projected net change plus projected balance. **Change first, level second.**
3. **Questions:** one card with a count. Tapping walks the household through them in place. This card is the **only** place in the app a count appears. No badge in nav, ever.
4. **Goals:** the two or three the household named most important, with where they stand. Not all twelve.

### Doctrine note, recorded so nobody cites it as precedent

Cash position is permitted on the landing screen **where net worth is not**, because cash is a figure the household controls month to month and is rendered as change plus level rather than as a score. The Net Worth Doctrine is unchanged: never a hero metric, never celebrated, never scored. **Net worth does not appear here.**

---

## 4. Cash Flow, as designed (amends `app-ui-spec.md` §5, §5a)

### The consumer question leads

Before any chart: today's balance across depository accounts, and a plain-language coverage verdict for the visible window. Three verdicts:

- **"Covered."** with the window's lowest point stated ("The lowest the bank gets is $41,616 on Aug 18.")
- **"Covered, from savings."** the `short_but_covered` state. **Neutral ink throughout, never red.** Names the dip, names where the money is, and says **money in the wrong account, not missing money**.
- **"Comes up $X short."** the true short. The only red verdict.

### Window, not horizon

Range toggle: 7 days (default), 14, 21, 28, 3 months, custom. Daily rendering through 35 days, weekly beyond, with **weekly buckets taking the minimum so troughs never smooth away**. The data stays daily regardless.

### Account switcher

All accounts, then each depository account by name and mask.

### Chart

Two statements sharing one x-axis. Above, the balance path with **$0 always anchored**. Below, paired per-day bars for coming in and going out. Any day is touchable for In, Out, Net and ending balance, **worded not signed** ("up $4,652" / "down $696"). Trough marked; tight-week band at 28 days and beyond.

### Commitments panel ("Committed and expected")

Grouped by month with the current month open. **Source honesty renders visually** and is explained in one footnote line: full-ink amounts are statement facts, lighter amounts are estimates from history. Each row opens to cadence, window, source, account and match history, with one action: **"This isn't right"** → pause / wrong amount / pulls from a different account, writing household-stated authority over inference.

### The app shows state

No alarm styling. If something ahead needs the household, MyKeeper says so in the channel. **The app never chases.**

### Red on this surface: a deliberate override, not a derivation

Outflow bars render red. **Recorded as a deliberate household override scoped to cash flow bars only**, not as a derivation from the red doctrine. §0's rule is otherwise unchanged: red never marks UI states, chrome, gridlines, or the covered dip.

**Recorded at Guy's instruction: the assistant argued against this twice.** The concern is that red on every outflow spends the scarcity that makes red meaningful, so a bar that should alarm looks identical to the mortgage. **Guy ruled to keep it.** It is recorded as an override precisely so nobody cites it as precedent for red elsewhere.

### Framing

A projection is **the best arithmetic available on what is known, updated as things change**. Not a forecast, not a promise, and not hedged into uselessness either. State the basis, kind-label the components, and let the number stand. **No confidence percentages, no apologetic framing.** The house style everywhere else applies here.

What is knowable: commitments, and variable categories that recur with varying amounts. What is not: a one-time event nobody has mentioned. The projection covers the first two honestly and does not pretend to the third.

The difference between 3 months of history and 18 is real and **belongs in the basis rather than in a disclaimer**: 3 months gets a straight extension, 18 gets a seasonally shaped figure, and the kind label carries which.

---

## 5. Budgeting is Annual Plan scope (ruling)

**Household-set spending targets by category are NOT in launch scope.** Household Goals holds the Margin target, the Life Happens target, and the prioritised goals. Nothing else.

**Reasoning:** per-category budgeting is the ritual the Method argues against, and shipping it as a settings screen would make MarginSheet the thing it refuses to be. If it arrives, it arrives through the Annual Planning Session, a household deciding what a year looks like with MyKeeper, and it lands with **Module 11**.

### Consequence for `projection-spec.md`, owed to Module 11

A household-stated per-category number becomes a projection input at that point, and when it diverges from history **the projection must carry both**. The stated number wins as the household's decision; the trajectory is stated as fact beside it. **Neither is a verdict.**

Recorded as owed to Module 11 rather than designed now.
