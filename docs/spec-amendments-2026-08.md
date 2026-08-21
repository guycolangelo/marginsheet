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

---

## 9. The passkey button labels itself (amends `app-ui-spec.md`, sign-in surfaces; ruled 16 August 2026)

Recorded now so Module 8 inherits it rather than rediscovering it. Nothing is built here. M3 owns the passkey endpoints; M8 owns the screen that calls them.

### The ruling

**The passkey button label is detected from the platform authenticator, never hardcoded.** Four states:

| State | Label |
|---|---|
| Platform authenticator reports Windows | Windows Hello |
| Platform authenticator reports macOS | Touch ID |
| Platform authenticator reports an Apple device with Face ID | Face ID |
| Detection unavailable or inconclusive | **Sign in with your passkey** |

**The fourth state is the default, not the error case.** The label is a heuristic and it fails to neutral, never to a guess. Guy's reasoning, recorded because it governs every future edit to this logic: telling a Windows household to use Face ID is worse than telling them nothing. A wrong label makes the product look like it is describing somebody else's device, on the one screen where a household is deciding whether this thing is competent.

This is the same rule the codebase already applies to credential provenance. `authMethodForPath()` returns `null` for an unrecognised path, with the comment "unknown provenance is the weakest class, never the strongest". Same shape, different surface: an unknown answer resolves downward.

### The mechanism, so the implementer does not guess

`PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()` returns whether a platform authenticator with user verification **exists**. It does not report **which one**. There is no API that names the modality, and there is not going to be one, because that is a fingerprinting surface the standard deliberately withholds.

So the label comes from platform inference, and inference is where this gets decided:

- **Windows**: reliable. Windows Hello is the platform authenticator on Windows.
- **macOS**: reliable enough. Macs carry Touch ID, not Face ID.
- **iOS and iPadOS**: **not reliable, and this is the case that matters.** The user agent does not carry the device model, and the range covers both Face ID and Touch ID devices. Current iPhones are mostly Face ID and the SE line is Touch ID, and nothing in the request distinguishes them. Per the ruling this lands on the neutral label rather than on a coin flip.
- **Android and everything else**: neutral. There is no single platform brand name to use.

Newer browsers expose `PublicKeyCredential.getClientCapabilities()`, which reports capabilities as a map rather than a single boolean. Prefer it where available and treat its absence as one more route to the neutral label.

### Suppressing the button, and the constraint that shapes it

**The ruling:** the passkey button is suppressed or relabelled when no credential is registered for this device, so a first-time household does not tap it into an empty browser prompt.

**The constraint, flagged rather than worked around:** a site cannot detect whether a credential exists on a device. WebAuthn withholds it on purpose, for the same fingerprinting reason as the modality. So "no credential is registered for this device" is not directly observable and the implementer will go looking for an API that does not exist.

Three signals do exist, and only the first is trustworthy:

1. **Conditional mediation** (`navigator.credentials.get({ mediation: "conditional" })`, gated on `isConditionalMediationAvailable()`). Passkeys surface inside the autofill affordance and appear **only if the platform holds one**. An empty prompt is structurally impossible, which satisfies the ruling without needing detection at all. This is the mechanism to build on.
2. **A local hint** written after a successful passkey registration or sign-in on this device. Advisory only: cleared storage, a new browser profile, or a private window all make it wrong. Never let it suppress the magic-link path.
3. **Server knowledge that the account holds a passkey.** Real, but it answers a different question. It is per account, not per device, and at the sign-in screen the household has not identified itself yet.

**The design that follows:** magic link is the surface that always works and is never hidden behind a detection result. The passkey affordance is surfaced through conditional mediation, and it is promoted to a labelled button only when a positive signal exists. That ordering also matches §1's construction, where a member with no passkey is on the weaker path by design and never an excluded one.

### The test this owes

A label chosen by a heuristic needs its failure case exercised, not its happy path. The suite has to prove the neutral label is what appears when detection is unavailable, when it is inconclusive, and when it throws, because a heuristic that silently resolves to a confident wrong answer is the failure this ruling exists to prevent. Asked the standing question: if platform detection broke completely, the button must read "Sign in with your passkey" and nothing must go quiet.

---

## 10. Passkey registration placement, and the skip path (amends `identity-onboarding-spec.md` §1 and the signup spine; ruled 16 August 2026)

Recorded, not built. Pairs with amendment 9: that one governs the label, this one governs where the prompt sits and what happens when a household says no.

### The ruling

**The registration prompt lands in the signup spine right after identity is created, before the card step.** A household may skip it, or dismiss the browser dialog, and **that is a supported end state rather than an error.** They use magic links. Settings offers passkey registration later.

### This resolves a conflict already in the spec

§1 currently says the passkey is created **as** the signup: "Passkey-first registration (pre-auth, Better Auth 1.6+): the passkey is created *as* the signup, before any session exists." That is superseded. Identity is created first, and the passkey prompt follows it.

The spec was already inconsistent with itself on this point, which is worth naming so the resolution is not read as a change of mind:

- The abandonment table's Step 1 row describes "Auth identity, empty household, no subscription" recovered by "magic link back in." That state cannot exist under pre-auth passkey-first, because there would be no identity without a passkey.
- The §1 tightening ("a magic link is accepted only when no passkey exists") describes members holding an account with no passkey at all. Pre-auth passkey-first would make that population empty.

The build had already moved this way. M3's sub-tasks were resequenced on 15 Aug so passkey work (3.1a) runs after magic link (3.2), on the reasoning that passkey registration requires a signed-in caller and a session minted through `internalAdapter` is a session the product never issues. This amendment makes the spec say what the build already does.

### Consequence 1: the skip is recorded, never inferred

**A household who declined and a household who never reached the step are different states, and only the first is left alone.** Absence of a passkey cannot distinguish them, so the decline is a fact that gets written down.

**And it cannot be inferred from the browser dialog either**, which is the part an implementer will get wrong. `navigator.credentials.create()` rejects with `NotAllowedError` for a user cancelling **and** for a timeout, and WebAuthn makes those deliberately indistinguishable so a site cannot learn what happened at the authenticator. So a household who walked away from their desk and a household who chose "not now" arrive as the identical rejection.

Recording the decline from that rejection would file a timeout as a decision, and the household would never be asked again because they made a coffee. **The recorded decline comes from an explicit affordance the household clicks**, and a dismissed dialog with no such click leaves the state untouched and re-promptable.

One rejection is distinguishable and worth handling separately: `InvalidStateError` means this authenticator already holds a credential for this account. That is "already registered", not a decline.

**Owed:** a persisted field, per member, carrying when the prompt was declined. Null means the household has not answered and may be prompted when they reach the step; a timestamp means leave them alone. Registration itself needs no field, since a `passkey` row is the record. Append-only migration rules apply, and this is owed to whichever of M3 or M7 opens the spine step first.

Note the field is a member-level fact about **the prompt**, not a device-level fact about credentials. A member who declined at signup and later registers a passkey on one device has not answered anything about a second device, and nothing should re-derive the decline per device.

### Consequence 2: no passkey is never a degraded account

**Nothing in the product may treat "no passkey" as a degraded account.** No warning banner, no nag, no reduced capability, no security score, no prompt that returns on its own. The one place the distinction is allowed to matter is the §1 tightening, and it is already correct there: a phone change requires a passkey when one exists and accepts a magic-link session when none does.

That third case was added deliberately and named by Guy as the one that matters, precisely so "refuse magic-link phone changes" could not quietly become "lock out every member without a passkey." The doctrine and the control already agree; this records that no other surface may reopen the question.

It also follows from "nothing chases the household." A prompt that comes back after a no is chasing, whatever it is labelled.

### The commercial reason the skip must be one action (M7)

The prompt sits immediately before the card step, so anything that stalls here costs a subscription rather than a passkey. A household stuck at a dialog they did not want has not reached `trialing` and appears in the abandonment table's Step 1 row. The skip being a single, obvious action is what keeps a security nicety from becoming a funnel loss.

### The test this owes

The supported end state proven as supported: a household that skips completes signup, reaches the card step, holds no passkey, signs in by magic link afterwards, and changes their phone successfully on a magic-link session. Plus the negative that gives it meaning: a household that declined is not prompted again, while one that never reached the step still is.

---

## 11. Invitation creation is a sensitive action (amends `identity-onboarding-spec.md` §1's sensitive-action list; ruled 17 August 2026)

§1 lists four actions requiring recent-auth re-challenge: **phone change, cancellation, member removal, export.** Member *addition* is not among them. **It is now.** Invitation creation requires recent-auth.

This is a deliberate widening of an explicit list, recorded as an amendment rather than slipped in as an implementation detail.

### The reasoning, which is about the illegitimate case

"Invited and expected" describes the legitimate case, and controls exist for the illegitimate one.

**A stolen session that invites its own address creates a permanent second door into the household's books.** That door survives the original member noticing the compromise, because it is not a session to be revoked or a password to be changed: it is a member. And to the system it looks like a normal family member, because that is exactly what it is.

**Removal is loud and gets noticed within a day. Addition is quiet and durable.** Somebody losing access finds out immediately; somebody gaining it may never be observed at all.

### Why it is the largest grant the product makes

The membership model is that **every full member sees everything**. There is no partial access, no per-surface permission, no read-only member. So an invitation is not a grant of some access, it is a grant of all of it, and it is the single largest one the product is capable of making.

That makes the asymmetry with removal the wrong way round in the original list. Removal takes access from one person; addition gives the whole household's financial life to somebody who did not have it, permanently, in one request.

### What implements it

`SENSITIVE_ACTIONS` in `services/api/src/sensitive-actions.ts` gains the entry, which means the enumeration test requires the route to exist and be guarded. The list is the enforcement mechanism, so amending §1 and amending the list are the same act.

---

# Amendments 11 to 13, approved 19 August 2026

Supersedes the 18 August draft. Three corrections carried in the final: the tender is echoed into the answer as two values rather than a flag; 7b's absence claim is cut rather than given a field; and amendment 13 recommends a discriminated union so "installment obligates term" is structural rather than checked.

Authority: tier 4, level with the spec text amended. Where these conflict with the original spec, these win.

## 11. The two-ledger rule (amends `mycfo-mykeeper-conversational-spec.md`, compliance boundaries and the canonical exchange library)

### What this fixes

The rule has been operating doctrine since the specs were written and **appears nowhere in the document under any name.** Exchange #2 demonstrates it. Nothing stated it.

**The contract was ahead of the spec, not behind it.** `ScenarioAnswer` already carried `margin_ledger`, `cash_ledger` and `ledgers_diverge`. M2 encoded the rule before the conversational spec named it, which is the safe direction to be wrong in.

**And it is now enforced.** The forcing-field check on `ledgers_diverge` was built on 18 August. Before that the contract comment said FORCES and forced nothing, which is why this amendment records a rule that is real rather than one that is aspirational.

### The rule

**Any scenario answer covers both ledgers wherever they diverge, because the household is asking two questions and only knows they asked one.**

**Cash choreography** answers *does the money physically clear.* Timing, balances, what is committed before the next deposit, whether a dip is covered and from where.

**The MarginSheet verdict** answers *what does this do to the month.* Where it lands in Income minus Spending, and what happens to Margin.

Answer only the cash side and the household hears yes. Answer only the Margin side and they hear no. Both are true, and **the honest answer is the tension between them.**

Where `ledgers_diverge` is false, one answer serves and the second ledger is not narrated for its own sake. Where it is true, both are stated and the divergence is the content of the reply, not a footnote to it.

### Margin always moves. Cash moves on the tender's schedule.

The ledgers never disagree about *whether*, only about *when* and *how much*.

| Tender | Gap |
|---|---|
| Debit or cash | Zero. Both ledgers move the same day. |
| Credit card | Margin moves now, cash moves at statement payment. One cycle, and the gap that lets a household stack three purchases that each felt free. |
| Installment loan | No lump ever reaches the ledger, so the verdict is a **term**, not a month. |

### The tender beat

**A purchase question cannot be answered correctly without knowing the tender, and the tender cannot be inferred before the fact.** Asking is a clarifying question, not advice, and it is permitted.

The beat sits inside the canonical open rather than before it: "Let's look at the math. Debit or card?" It never becomes a form and never blocks a partial answer. **Where the household does not answer, or answers uncertainly, the reply names the tender it assumed and gives both shapes where they differ.**

### Financing: the verdict is a term, never a monthly figure

$104 a month for 24 months is not "3 points this month." It is $2,496 through August 2028.

**Stating the monthly number alone is technically true and is the category's cleanest lie by omission.** $104 looks like nothing. 24 months of a decision the household no longer gets to make is the actual price.

**Interest is folded into the total, never separated.** The purchase cost $2,496. Same rule as measuring Margin on take-home: measure what moves. No separate finance-charge line, no callout, no comment on the rate.

**Banned burden verbs**, added to the banned-word list: tied up, locked in, working to pay, eaten by, stuck with, on the hook, saddled with, weighed down. **Rules match inflections, not literals.**

State the term and the total. **Never judge the tender.** A household financing a water heater in an emergency does not need our opinion, and the scolding ban and the absolution rule both apply at full strength. This is the surface where the true statement and the lecture are one word apart.

### Added to "What failure looks like"

An exchange also fails this spec if it: answers a purchase question on one ledger while `ledgers_diverge` is true; states a financed purchase as a monthly figure without its term and total; separates interest from the total; uses a burden verb; or asserts a tender it never established and never named as an assumption.

---

## 12. Spending recognition, by instrument (amends `ledger-spec.md`)

### The rule

**Spending is recognized once, at the first place it becomes visible on a connected account. The instrument decides where that is. The word "financed" does not.**

| Case | Recognition |
|---|---|
| Card purchase, including store-card promotional financing | At the transaction, at full amount, in its ordinary category. Every later payment is settlement. |
| Installment loan where the lender pays the merchant and nothing reaches a connected account | No transaction exists to recognize, so spending is recognized as each payment lands. |
| Credit card payments | **Never spending.** The charge was recognized at the transaction; counting the payment would count the same dollars twice. Cash Flow only. |
| Interest and fees on a carried balance | **Spending.** Not settlement, not attached to any recorded purchase, and new money leaving for something never counted. Without it the statement understates the cost of overspending, which is the direction it must never err in. |

### Why one rule and not four

A card-financed television and a lender-financed television are the same purchase and produce opposite entries, because one is visible on a connected account and the other never is. Sorting by the word "financed" gets both wrong half the time. Sorting by first visibility gets cards, store cards, car loans, mortgages and installment lenders right with no special case for any of them.

Same family as **transfers are never income**: both rules exist to stop the same dollars being counted twice.

### Affirm and BNPL: a lookup, not a ruling

Affirm ships in more than one shape and the shape decides the answer under the rule above. Arriving as a loan or liability with no corresponding transaction means recognition on payment. Arriving as ordinary card charges means recognition at the charge. **Which shape it arrives in is unknown until real Plaid data is inspected**, and it may differ between Pay in 4 and longer terms. Owed to M4.

### The completeness dependency, recorded not built

This rule assumes the card is connected. An unconnected card means a purchase was recognized nowhere and Margin is overstated **in the flattering direction**, which is the one error mode the product cannot tolerate.

Detection exists in principle: a payment leaving a connected bank account for a card account we do not hold. **Recorded as a dependency of this rule and owed to the Margin integrity ruling**, which is not drafted.

---

## 13. Owed fact-package fields for tender and term (amends the `ScenarioAnswer` contract; owed to M2)

### The finding

Established against the code on 18 August. `ScenarioAnswer` carries `margin_ledger`, `cash_ledger` and `ledgers_diverge`. It carries **no** tender, no term, and no total of payments.

CLAUDE.md requires every number in an outbound message to trace to a fact-package field. **Therefore MyKeeper cannot state a financing term today, at all.** Amendment 11 asks it to. This gap is why 11 is recorded rather than fully shippable.

### Tender: supplied on the request, echoed into the answer

The first draft placed tender only on the request, reasoning that it is an input the household supplies. **That was wrong.** The composer cites answer fields, so a field living only on the request cannot be cited, and "assuming debit" would be an uncited assertion in an outbound message.

**Tender is supplied on the request and echoed into the answer block.**

The echo carries **tender and how we know it, as two values rather than a flag.** A boolean named `assumed` sits beside tender and reads as a modifier of it; two distinct values make the reply's two sentences two distinct facts with no third state to invent. This is the same reasoning that makes `unspecified` a value rather than a null, and it is recorded as a **contract design rule**: where a fact has provenance that changes the sentence, provenance is a value, not a flag.

### Term: let the type carry the obligation

`tender: installment` obligates term fields. That obligation should be **structural rather than checked at runtime.**

The preferred shape is a discriminated union on tender: the installment variant carries its term fields as required, every other variant has no term fields to omit. Then "installment obligates term" cannot be forgotten, cannot drift, and needs no test to remember it.

This follows `FraudReply.boundary_line`, typed as the literal `true`, which is the pattern to copy wherever a type can do the work. **Order of preference: type, then runtime check, then comment.**

**Total of payments includes finance charges and there is no separate interest field.** Deliberate, and it follows amendment 11: a separate field would invite a separate sentence. **The absence of the field is the enforcement mechanism**, which is the cheapest kind.

### Constraints on whoever builds it

- Append-only migration rules apply.
- No confidence field, on any of these, ever.
- Where the household supplies a term the household stated it, and where the product derives one it derives it. A term read off a signed contract and a term estimated from an advertised rate are not the same number, and the kind label carries which.
- The golden suite must be able to fail on a term stated without these fields populated.

---

---

## 14. The reconciliation invariant states its population and its gap (amends `conversation-service-spec.md` §the reconciliation invariant; ruled by Guy, 21 August 2026)

### The finding, and it is neither of the two branches that were expected

The question put was: does the spec name a population, or is it silent? **It names one, and the implementation cannot meet it, and that is a third thing.**

The invariant reads: *"computed flows are reconciled against Plaid-reported balances **per account on every sync**"*.

**That population is unachievable on the endpoint we sync through.** `/transactions/sync` returns balances only for accounts it returns transactions for, and it returns only accounts that **have** transactions on a page. So **"Plaid-reported balances per account on every sync" is not an input that exists** on this path. It would require `/accounts/balance/get`, a separate call.

**This is not an implementation that ignored its spec.** The spec assumed an input the chosen endpoint does not supply, and nothing discovered that until a reconciler was built and pointed at real accounts. Recorded that way deliberately: "the implementation drifted" would be the easier sentence and the wrong one.

### The restatement

**No drift observed across N consecutive observations on accounts with N or more observations, and the count of accounts with fewer than N observations, stated beside it.**

**The gap is reported, not footnoted.** A criterion that reports its coverage without reporting its gap is halfway to the defect it exists to prevent. If five accounts are unobserved, **the criterion says five.**

On the founder household as of 21 August 2026 that number is **five**: Xmas Gifts (0 transactions ever), Vacation (1, in August 2026), Chase 7956 (4 in two years, last October 2025), and both investment accounts, which are excluded by design because Plaid reports `0.00` for them while they hold real money.

### The standing limitation, which is a property rather than a gap

**Reconciliation-on-sync cannot reach a balance change that arrives without a transaction, and it never will.** An account is observed when Plaid returns it, Plaid returns it when it has transactions, so a fee or interest applied outside the transaction feed on a dormant account is invisible to this mechanism.

**Nobody should read the invariant as a statement about balances generally.** It is a statement about balances **that moved with transactions we received**.

**1b did not create this and the sequence must not be read as losing coverage.** Before 1b, unrefreshed accounts were reconciled against stale balances and produced zeros, which counted as clean observations. **The gap existed and was concealed by exactly the rows that made the criterion look green.** The fix made it visible. Anyone reading the two changes in order will otherwise conclude coverage was lost, when what was lost was a false claim of it.

### This is a species, not an instance

**A spec written before an endpoint was chosen can name inputs that endpoint does not return, and nothing in this repository checks a spec's named inputs against a provider's actual contract.** `/transactions/sync` is simply the first place anybody looked hard enough to notice.

**The live second instance is already visible.** Cash Flow's committed outflow names `last_statement_balance` and `next_payment_due_date` as inputs. Those come from `/liabilities/get`, which **has never been called**, on Items that have consented to it. Same shape: a spec naming an input, and the path that would produce it not running. Whether the cause is the same is what the liabilities task determines, and it opens knowing this rather than discovering it at the end.

**Is a cheap check buildable? Partly, and the honest answer is that one check does not cover both.**

**The liabilities shape is checkable and the mechanism already exists.** A spec names a FIELD as an input; the field has a column; the column has no writer. `config/single-writer-columns.json` already enumerates writers per column and its control already fails on an undeclared one. Extending it to carry "named as an input by spec X" and failing when `declared_writers` is empty **and** no open item covers it is a small change to an existing control rather than a new one. **That would have caught the liabilities gap on the day the column was created.**

**The reconciliation shape is probably not checkable.** What the spec named was not a field but a **cadence and coverage property**: balances *per account, on every sync*. Verifying that against Plaid's contract means machine-reading a provider's documentation about which accounts an endpoint returns, which this project cannot do and should not pretend to. **The nearest honest mechanism is a declaration** written when an endpoint is chosen, saying what it returns and how often, checked against what the spec assumed. That is a real artifact somebody must write and keep true, which is a second statement of a fact and therefore a drift risk, and it is the expensive option.

**Cost, stated so the decision is available rather than implied.** The field half is hours and reuses a control. The cadence half is a new declaration per endpoint plus the discipline to update it, and it would have caught one of these two. **Not built. Recorded so the choice is made deliberately.**

### Tolerance

The invariant says *"drift beyond tolerance"*. **The tolerance is zero**, ruled 21 August 2026: any non-zero threshold is a guess about an error nobody has observed, and every failure expected here is timing rather than magnitude, so a dollar threshold answers the wrong axis.
