# identity-onboarding-spec.md
## Auth, the onboarding spine, billing, and cancellation. Governs M3 and M7.
## Drafted 14 August 2026. Design-forward: the auth stack is new; Stripe mechanics port with the 14-day ruling applied.

Sources: brain spec's locked onboarding spine, Base44's billing entities and functions (TrialRecord, entitlement states, checkout/webhook/cancel functions), 14 August rulings (14-day trial, Better Auth over Clerk, beta promo code, consent in the spine).

---

## 1. Auth architecture (M3)

**Better Auth**, self-hosted on Workers, tables in the same Neon Postgres (owned by Better Auth's migrations; `members.auth_user_id` is the join point per data-model-spec §1).

### Passwordless, entirely
No password exists anywhere in the product. Two methods:

1. **Passkey, primary.** Passkey-first registration (pre-auth, Better Auth 1.6+): the passkey is created *as* the signup, before any session exists. Face ID / Touch ID / Windows Hello.
2. **Magic link, fallback and recovery.** Sent via Postmark from the MarginSheet identity (commercial infrastructure, not a brain — nobody replies to a login link). The magic link *is* the account-recovery path: lose every device, keep your email, keep your account.

Rationale: the product's selling point is never needing to log in, so every login is a rare login, and every password would be a forgotten one. Passkey-or-link removes the failure mode instead of handling it.

### Phone verification: Twilio Verify, not the A2P numbers
The phone is a **security primitive, never a login method** (SIM-swap surface stays minimal). Verification is OTP via Better Auth's phone-number plugin, with the send hook wired to **Twilio Verify**.

**Verified live 15 August 2026.** A real OTP was sent and approved against the production Verify service using `scripts/verify-decoupling-probe.sh`. The check returned HTTP 200 with `status=approved, valid=True`, and the response carried no token, session, JWT, or credential-shaped field of any kind. The decoupling holds in practice: an approved verification yields a verdict and authenticates nobody. If that ever stops being true, the probe exits non-zero and this paragraph is wrong.

**This is a scheduling decision, not just a technical one:** Twilio Verify OTP delivery is pre-registered by Twilio and does not wait on our A2P 10DLC campaign approval. Phone verification works day one even if the brains' two A2P numbers are still in vetting. The single worst external dependency stops blocking onboarding entirely; it only gates the brains' conversational SMS.

Rules (from data-model-spec, restated as behavior):
- No channel access of any kind until `phone_verified_at` is set
- Phone changes happen in-app only, behind a fresh auth challenge; no write path from any channel
- **TIGHTENED 15 August 2026 (Guy).** The fresh auth challenge for a phone change is a **passkey** when the member has one registered. A magic link is accepted only when no passkey exists on the account. Reasoning: the phone is the SIM-swap surface, so accepting an email-delivered link to change it lets an attacker who controls the inbox move the security primitive. A passkey is bound to hardware and cannot be forwarded, which is the property that matters for this specific action. Members with no passkey are not locked out, but they are the weaker path by construction, and registering a passkey is what closes it.
- One verified phone per member; a phone number in use by another member in any household is rejected with support routing

### Sessions
Better Auth session cookies, secure/httpOnly, 30-day rolling. The app is low-login by design; long sessions are correct here. Sensitive actions (phone change, cancellation, member removal, export) require recent-auth re-challenge (10-minute window).

---

## 2. The onboarding spine (M7)

Locked order, one unbroken session:

**signup with card → cell number → home address → add members → connect accounts**

### Step by step

| # | Step | What happens | Fires |
|---|---|---|---|
| 1 | **Identity** | Passkey created (or email + magic link). `members` row, `is_primary`, household created. | — |
| 2 | **Card** | Stripe SetupIntent → PaymentMethod attached → subscription created, `trial_period_days: 14`. Promo code field lives here (§4). Trial-abuse check (§5) runs before subscription creation. Cardholder name seeds `display_name`. | `entitlement_state = trialing`, `trial_ends_at = now + 14d` |
| 3 | **Cell** | Phone entered, Twilio Verify OTP, `phone_verified_at` set. `sms_transactional` consent checkbox captured to `consent_records` (TCPA; also the A2P vetting asset). | — |
| 4 | **Address** | Home address → timezone resolved and stored. Quiet hours and every scheduled send now computable. | — |
| 5 | **Members** | Optional, skippable, returnable: partner's name + phone → `invitations` row → SMS invite (via the transactional path until A2P clears; see §7). "Members before intros so both spouses meet the staff on day one." | — |
| 6 | **Connect** | Plaid Link, production, non-blocking accordion with progressive rendering (ported pattern). Multiple institutions in sequence. "I've connected all my accounts" button. | `connected_first_account_at`; backfill starts; the M13 intro triggers arm |

**The MarginSheet introduction email** (Kit) sends at step 2 completion — account creation with card — per the brain spec's beat one, so it's in the inbox while the backfill runs.

### The session doctrine, and honest resumability
Designed to complete in one sitting; the connect step is the headline abandonment metric that decides whether 14 days was right. But people fail, so every abandonment state is defined:

| Abandoned after | State | Recovery |
|---|---|---|
| Step 1 | Auth identity, empty household, **no subscription** (no orphan possible — subscription requires the card step) | Magic link back in; resume at step 2. One Kit nudge at 24h, one at 72h, then silence. |
| Step 2–4 | `trialing`, clock running, no accounts | Resume at first incomplete step. Kit nudge notes the clock plainly ("your 14 days started Tuesday"). |
| Step 5 skipped | Normal | Members addable any time in-app; intros fire for late-added members per M13. |
| Step 6 partial | Some institutions connected | Intro trigger fires on backfill-complete or 30 min after last institution (the tightened trigger); more institutions addable any time. |

**No step is ever re-completable in a way that double-fires its side effects**: subscription creation, consent records, and intro triggers are all idempotent on their keys.

---

## 3. Stripe structure (M7)

- **Prices:** $24.99/month (everyone starts monthly), $249/year (upgrade path). The annual-price invitation stays at **month 3** per the original locked journey; the day-45 offer drafted earlier is dead (superseded 14 August by the day-7 early activation offer, §3a).
- **Object:** one subscription per household, created at step 2 with `trial_period_days: 14` and the SetupIntent's PaymentMethod as default.
- **Day 12:** the notice email via Kit — built and sent regardless of whether a 14-day trial legally requires ARL pre-charge notice (attorney item 8 decides the legal question; we send either way — ruled). Content: work-done recap, then the required disclosures plainly and conspicuously: first-charge date, amount, cancel path. Carries the early-activation offer's final showing if and when one is ruled (§3a, parked).
- **Day 14:** first charge. Success → `active`.
- **Decline:** `past_due`, `grace_period_ends_at = now + 14d` (ported). Dunning and card-update requests are **MarginSheet through Kit, never a brain** (a bookkeeper does not send the invoice). Card update in-app via SetupIntent (ported `confirm-card-update` pattern). Grace lapse → `expired`, Plaid Items disconnect.
- **Webhooks:** all Stripe events through `provider_events` idempotency first. Reconciliation trusts **customer-level Stripe truth over stale local records** (ported fix, kept as doctrine).
- **Access gates** (ported from `get-marginsheet`): `trialing | active | past_due` read the product; `canceled | expired` get the paywall, not a 403 page — the paywall states the state plainly and offers the card path.

---

## 3a. Early activation offer: PARKED (14 August)

An offer inviting mid-trial activation is intended but not designed; the strategy is Guy's open decision. Candidates considered and set aside for now: free Annual Planning Session (superseded when the session became included with every subscription), 90-day money-back guarantee, gift-a-subscription. **Nothing here is build scope.** Two hooks stay warm at zero cost: the day-12 notice email exists regardless and can carry an offer's final showing when one is ruled; the day-7 slot after the Briefing is the natural first showing. When ruled, mechanics land in this section.

---

## 4. The beta path (ruled 14 August)

- Promo code field at step 2, validated server-side (port `validate-promo-code`)
- **Stripe coupon, 100% off, `duration: repeating`** for N months (N set when the beta window is set) — the beta ends by calendar, converting itself; no manual intervention
- **No trial stacked on the coupon.** Beta subscriptions are `active` at $0 immediately. Avoids the "your subscription begins" email preceding a $0 invoice, which reads broken.
- **Card still required.** The card is how the beta ends cleanly: coupon exhausts → next invoice bills normally → standard dunning if declined.
- `trial_records.exempt = true` for coupon signups (§5 bypass)
- Heads-up email via Kit before the first real charge: the beta household is told the date and the amount before money moves. Same courtesy as the trial notice, same reason.

---

## 5. Trial abuse detection (ported)

At step 2, before subscription creation: normalize the email (lowercase, strip plus-aliases, strip gmail dots), take the card fingerprint from the SetupIntent's PaymentMethod, check `trial_records`. A match on either → no second trial: subscription created **without** `trial_period_days`, first charge immediate, stated plainly at checkout ("you've had a trial before; your subscription starts today"). `exempt = true` bypasses (beta invitees). Every trial start writes its record.

---

## 6. Cancellation (M7 flow; M20 owns the goodbyes)

**Two clicks, in-app, no phone call** (site promise; ARL requirement independently):
1. Settings → Cancel subscription
2. Confirm screen, which carries exactly three things: the retention question (**keep my file 12 months in case I return** — default — or **delete everything**), the export pointer, and the confirm button

On confirm: `cancel_at_period_end` (paid time is theirs through period end) → at period end: `canceled`, **Plaid Items disconnect immediately in all cases** (no live bank connection survives the subscription), retention choice executes, M20's goodbye sequence fires (one message per brain, staggered, no rescue). Save-flow, if any ever exists, is Kit's before the confirm — the brains never retain.

**Trial lapse variant:** cancellation during trial → nothing charged, Items disconnect at trial end, only MyKeeper says goodbye (books state + export pointer), folded into Kit's trial-end sequence. MyCFO stays silent (ported doctrine).

---

## 7. Member invitations (M3)

Primary adds a member: name + phone (+ optional email) → invitation with unguessable token, 14-day expiry (ported). Invitee path: link → passkey/magic-link identity → phone OTP → joined as `full_member`. On join: brain intros fire for the new member per M13, with prior members' goals answers carried attributed ("Guy mentioned paying off the truck. Anything you'd add?"). No secrets between principals is stated in the invite email, before joining, not after.

Until A2P clears, the invitation SMS rides the transactional path; the *brains'* messages wait for their own numbers. If both are blocked, invitations fall back to email — degraded, documented, temporary.

---

## 8. Instrumentation

Per-step entry/completion/abandonment, PostHog. Headline metric: **step-6 completion rate within first session.** Secondary: step-2 promo usage, OTP failure rate, time-to-first-account, invitation acceptance rate, **day-7 early-activation acceptance rate**, day-12→14 cancel rate, day-14 decline rate. The step-6 number is what decides, with real data, whether the 14-day trial and the one-session doctrine survive contact with strangers.

---

## 9. Invariants (M3/M7 test suite seeds)

1. No subscription exists without a card on file (SetupIntent precedes creation, always).
2. Abandonment at any step leaves no orphaned Stripe object and no double-fired side effect on resume.
3. No channel message of any kind reaches an unverified phone.
4. Phone change requires in-app recent-auth; no channel input can ever alter a phone.
5. A second trial for a seen email or card fingerprint is impossible unless `exempt`.
6. Beta signup produces `active` at $0 with a card, never `trialing`.
7. Day-12 notice precedes every first charge; the beta heads-up precedes every first real beta charge.
8. Cancellation is reachable in two interactions from Settings; confirm always carries the retention question.
9. No Plaid Item survives `canceled` or `expired`, verified at Plaid, every path.
10. Three full onboarding runs with three real cards and three real institutions verify at Stripe and in the database directly, never against reports (ported discipline).
11. **PARKED with §3a:** any future early-activation mechanics must re-derive their invariants here before build; none exist today.
12. **Annual Planning Session is included with the subscription** (ruled 14 August; the "everything included" promise honored). The $99 fee and the included-with-annual distinction are dead everywhere; the clean-books gate survives untouched as eligibility.

---

## 10. Open for Guy

1. **Nudge cadence for abandoned onboarding** (24h/72h then silence is drafted here) — Kit copy, commercial voice; sign off or adjust.
2. **Beta coupon duration N** — set when the beta window is set; drives the §4 heads-up timing.
3. **The early-activation offer strategy** — parked per §3a; Guy owns the decision.
4. **Attorney item 8:** the 14-day ARL question, plus (when an offer is ruled) whether it may share the notice email.
