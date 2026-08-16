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

---

## 6. The Margin Instrument (new, Module 11 scope)

A **modeling surface, not a budget screen**, and the distinction is what makes it survive the doctrine.

Each spending category renders with the household's actual trailing average and a slider. An income line has its own. Moving any slider recomputes Margin live. The household plays until they find a shape they like, with the Method's 20% aim or their own stated target rendered as the reference.

### Why this is not the thing amendment 5 ruled out

A budget screen asks a household to set targets and then reports on their compliance. **This asks nothing and reports nothing.** It starts from what they actually spend and shows the arithmetic of their own choices.

The household discovers that dining at $900 instead of $1,240 moves Margin from 14% to 17%, **and the tool never mentioned dining**. It is the "let's look at the math" exchange made touchable, and it lets a household find its own lever rather than answering a question it already knew to ask.

That distinction is the whole licence for this surface. If it is ever lost, the surface becomes the ritual the Method argues against, wearing a nicer interface.

### Three constraints

**1. The output is a DECISION, not a budget.** When a household lands on a shape they like, the artifact is Household Goals plus a decision journal entry ("on 16 August you decided a 20% shape looks like this"), **never a set of category limits the system then polices**. The moment it reports compliance against those numbers it becomes the thing the Method refuses. This is the constraint that keeps amendment 5's ruling intact, and it is the one to check first in any review of this surface.

**2. The starting position is their actual trailing average, and it stays visible throughout.** A slider moved down must read as **a change from reality**, never as a number entered on a blank form. A blank form is a budget; a departure from an observed figure is a model.

**3. The income slider needs different treatment from the spending sliders.** Spending is largely a choice; income mostly is not, at least month to month. A household sliding income up to reach 20% is **modeling a raise they may not get**, and the interface must not make that feel equivalent to spending less.

Anchor it differently or label it as what-if. **This is an open design requirement, not a solved one**, and it is recorded as owed to the Module 11 design rather than answered here. The failure mode it guards against is a household leaving the surface believing they have found a plan when they have found a wish.

### Candidate for the Annual Planning Session

A household and MyKeeper moving sliders together during the call is a better ceremony than a form. Recorded as a candidate, not a commitment.

---

## 7. Postmark bounce and complaint webhooks (amends `plaid-pipeline-spec.md` invariant 5's provider set and `data-model-spec.md` `provider_events`)

Postmark joins the other three providers in `provider_events`. Bounce and complaint webhooks are received, check-and-inserted there **first** like every other provider's, and **hard bounces surface in-app**.

**This is a commitment already made externally.** Guy told Postmark's approval review that this is what MarginSheet does, so it has to be true. That makes it a promise with an outside party rather than an internal preference, and it is recorded here so nobody trims it as scope.

Consequences:
- `provider_events.source` admits Postmark alongside Plaid, Stripe and Twilio. Invariant 5's handler half, already owed to M4 and M7, now covers four providers rather than three.
- A hard bounce is a household-visible fact: an address that cannot receive mail breaks magic-link sign-in and every composed artifact, so it cannot be a silent operational log line.
- A complaint (spam report) is a different signal from a bounce and must not be collapsed into it. One is delivery failing; the other is the household telling us to stop.

Nothing here is built. Recorded as owed alongside the rest of invariant 5's handler half.

## 8. Postmark is in test mode until approval (operational constraint)

**Production sends are limited to `@marginsheet.com` addresses until Postmark approves the account.** Sends to any other domain fail with HTTP 422.

This was found the direct way on 16 August 2026: a live sign-in to an outside address returned 422 while the same send to `guy@marginsheet.com` was accepted and delivered. The sender signature was never the problem; `accounts@marginsheet.com` sits under a DKIM-verified domain.

**The gate to watch is the first non-`@marginsheet.com` recipient, not the approval date.** Founder testing is unaffected. Any invitation, magic link, or composed artifact addressed outside the domain fails closed until approval clears, which is the correct direction, but it means the beta cohort cannot onboard through email while this holds.

Tracked alongside the Twilio trial-account constraint, which has the same shape: a sandbox limit that is invisible until a real recipient is outside it.
