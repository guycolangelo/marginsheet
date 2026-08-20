# The imperative inventory
## 18 August 2026. A survey, not a fix. Nothing in this document was repaired.

**What prompted it.** Two failures in one session shared a shape. A lint rule recorded a prohibition and permitted its inflections. A contract comment said `FORCES` and forced nothing. Both are **a specification mistaken for a mechanism**, and both sat green.

**The question this answers:** how much of what this codebase asserts about itself is actually held up by something.

---

## 1. Method, and its limits, before any numbers

**Extraction.** Every comment block in `services`, `packages`, `scripts`, `.github/scripts`, `config` and `apps` containing an imperative: *must, always, never, forces, only, exactly, cannot, shall, required, prohibited, refuses*, plus the compose-obligation verbs *composes, obligates, guarantees, ensures, implies*. Blocks, not lines, so a unit is a claim rather than a fragment.

**537 imperative comment blocks across 162 files.**

> **SNAPSHOT, TAKEN AT COMMIT `8bc5893` ON 18 AUGUST 2026, AND IT HAS ALREADY MOVED.** Re-running the three scripts from a clean checkout on 19 August yields **577 blocks, 221 mechanism claims, 145 not confirmed enforced.** Nothing regressed: the difference is this week's own commits, which added comments faster than anything read them.
>
> **The figures below are deliberately NOT regenerated**, for one reason. The random sample of twenty is drawn from the 126 recorded here, and refreshing the population mid-measurement would replace a sample of a known set with a sample of a moving one.
>
> **Read the drift as the finding it is.** A survey states a number and the number is true when written; the codebase is not asked to hold still. So a count in prose is a claim about a moment, and it needs the moment attached or a reader six months from now compares it to today and concludes something false. That is the same shape as the open item that said "29 controls" and was stale inside a day, on a fact bound for a public page. **The scripts are the durable artifact. These numbers are a photograph.**

### The wordlist has a ceiling, and it was found by probing

The first pass used only Guy's list and **missed three obligations entirely**, because they carry no imperative word:

- `Correction.band_demoted`, *"composes 'I've started asking again'"*
- `Correction.verdict_changed`, *"true = highest-stakes fixture"*
- `Alert.first_flag`, *"false = follow-up register plus the follow-up banned list"*

Adding the compose verbs recovered the first. **The other two are still invisible to any wordlist**, because they assert a consequence with an equals sign and no verb at all. So the inventory is a floor, and obligations phrased as bare equations are outside it.

### The first classifier was wrong and its numbers were discarded

It had two outcomes, ENFORCED and ADVISORY, and reported 77/23. **Checking it against cases with known answers showed most ADVISORY verdicts were `symbol=null`**: the classifier failing to identify a subject, not evidence that nothing held the claim up. It also marked `recovery-routes.ts:113`, which asserts no-account-enumeration and has a test named for it, as advisory because it picked a local variable as the subject.

**Calling that ADVISORY asserts a negative that was never established.** The classifier was rebuilt with three outcomes.

| Outcome | Meaning |
|---|---|
| **ENFORCED** | positive evidence: the claim is in a test file, its file is named by the control register, or a constraint sits in the DDL below it |
| **UNKNOWN** | the module is exercised by tests, but **this claim** is not traced to any assertion |
| **ADVISORY** | the claim names a subject and **nothing anywhere references it** |

**Claim-level enforcement is not machine-decidable.** What is checkable is whether the surrounding code is exercised at all. UNKNOWN is the honest bucket and it is large by design.

---

## 2. The numbers

| | Count | Share |
|---|---|---|
| Imperative blocks | **537** | |
| ENFORCED | 232 | 43% |
| UNKNOWN | 226 | 42% |
| ADVISORY | 79 | 15% |

**These over-count, and the reason matters more than the number.** Most comments in this codebase **explain why a design is right**, and an explanation is not a rule awaiting a test. *"Escaped rather than trusted, because 'it looks like base64url' is not a security property"* is reasoning. It cannot be unenforced, because there is nothing in it to enforce.

### The actionable cut: claims that a mechanism exists

The two original failures were narrower and share a shape: **a comment asserting that a mechanism is in place.** That is the class of statement that can be *false*. An explanation can only be wrong, which is a different problem.

Filtering to present-tense mechanism assertions (*forces, obligates, guarantees, cannot, the test asserts, fails closed, refuses to, nothing can, prevents*):

| | Count |
|---|---|
| **Mechanism claims** | **198** |
| Confirmed enforced | 72 |
| Unknown | 83 |
| Advisory | 43 |
| **Not confirmed enforced** | **126, across 58 files** |

**126 claims that a mechanism exists, with nothing found holding them up.** Not 126 bugs. 126 places where the assertion and the evidence have not been connected, and where the two known failures came from.

---

## 3. What the sweep found by name

### A fourth forcing field, and this one is genuinely structural

`FraudReply.boundary_line` is typed as the literal `true` with the comment *"Forces the bank-authority sentence."* Because the type admits no other value, the flag cannot be absent or false. **The type system is doing real work here.** What is unchecked is whether the composed sentence appears, and that cannot be checked until golden output exists. Canon before capability, correctly.

### A claim of construction where there is no construction

`classes.ts:102`:

> **HERALD FACTS ARE A SUBSET OF CLOSE FACTS BY CONSTRUCTION.**
> One call, one package: the herald cannot say something the close does not.

`HeraldHeadlineFacts` and `CloseEmailFacts` are two independent interfaces. Nothing relates them.

**Probed rather than argued.** Adding `invented_field?: string` to `HeraldHeadlineFacts`, a herald fact with no close counterpart at all, produced **no error and no failing test**. The claim says `BY CONSTRUCTION` and there is no construction. It is the same shape as `FORCES` forcing nothing, in the same file, four lines apart in spirit.

`one_notable` is also not a field of `CloseEmailFacts`; the close carries `notable: StringFact[]`. The intent is clear and the guarantee is absent.

### The mistake doctrine is advisory

`verdict_changed`, `band_demoted` and `first_flag` all carry compose obligations and none is enforced. **That is the doctrine governing how the product behaves when it is already wrong**, and a rule that only applies when nothing has gone wrong is not a rule. Logged as one item, not three.

---

## 4. The inventory

126 mechanism claims not confirmed enforced, by file. **Nothing here was changed.**

**`.github/scripts/boundary-report.mjs`** (1)

- `:1` **UNKNOWN** What M3 does NOT cover (M3 task 3.6). A green summary that omits its own limits is the report equivalent of a control that cannot fail. This prints the boundary, and it is GENERATE

**`.github/scripts/planted-failures.mjs`** (4)

- `:1` **UNKNOWN** Break each control on purpose, and require the right test to go red (3.6). Task 0.4's planted-failure proof, applied to M3's controls. A control nobody has watched fail is a contro
- `:82` **UNKNOWN** Runs one named test. Returns whether it passed. Which workspace package owns a test path, and the path relative to it. THE HARNESS RAN EVERYTHING AGAINST @marginsheet/api. Register
- `:266` **UNKNOWN** The tree must be exactly as it was found. A harness that can leave source mutated is a harness that will, and the mutation it leaves is a control silently switched off. CHECKED AFT
- `:301` **UNKNOWN** TWO CAUSES, AND THE HARNESS CANNOT TELL THEM APART. The took-effect check proves the FILE changed, not that BEHAVIOUR did, and proving the second is undecidable in general. So the 

**`.github/scripts/verify-deploy.sh`** (1)

- `:245` **UNKNOWN** THE DEPLOYED ROUND TRIP, using the key sync actually holds. The unit tests supply their own key, which proves the algorithm and says nothing about the value in the secret store: ma

**`.github/scripts/verify-edge-rules.mjs`** (2)

- `:1` **UNKNOWN** Verifies the Cloudflare edge rate limiting rules against what the repo says. WHY THIS EXISTS. Per-source rate limiting lives at the Cloudflare edge, so that the client IP never rea
- `:61` **UNKNOWN** A 404 here means the phase entrypoint has never been created, which is what a zone with no rate limiting rules looks like. That is "absent", not cannot read", and it is a legitimat

**`.github/scripts/verify-worker-secrets.mjs`** (2)

- `:1` **UNKNOWN** Does each Worker hold exactly the secrets it is permitted to hold? (4.2.3) THE POINT IS THE REMOVAL HALF. M4 section 2a puts the Plaid token's key on a Worker with no public routes
- `:47` **UNKNOWN** Includes auth failures, a missing Worker, and a wrangler that would not start. All of them mean the same thing for the RESULT (this check did not run) and completely different thin

**`config/control-register.json`** (22)

- `:2` **ADVISORY** _doc": [ Every control M3 ships, and for each one THE TEST THAT WOULD FAIL if the thing it guards were completely broken (M3 task 3.6). WHY THIS EXISTS. The constitution asks of ev
- `:74` **ADVISORY** id": "token-domain-separation control": "readSignInToken and its siblings guards": "One token kind cannot open another kind's door. test": "services/api/test/token-matrix.test.ts n
- `:87` **ADVISORY** id": "invitation-token-prefix control": "invitations_token_purpose_prefix guards": "An issuer cannot mint an unprefixed invitation token. test": "services/api/test/invitations.test
- `:103` **ADVISORY** id": "resolver-privilege control": "auth_household_id EXECUTE is enumerated guards": "The sync worker cannot resolve arbitrary users to households. test": "services/api/test/rls-re
- `:147` **ADVISORY** id": "recent-auth control": "withinRecentAuthWindow on the phone change guards": "A sensitive action cannot run on a stale session. test": "services/api/test/recent-auth-wired.test
- `:160` **ADVISORY** id": "sensitive-action-reachability control": "SENSITIVE_ACTIONS direction 2 guards": "A listed action cannot claim to be built while nothing routes it. test": "services/api/test/s
- `:173` **ADVISORY** id": "send-limits-fail-closed control": "recordSendIfPermitted fails closed guards": "An unreachable ledger refuses rather than granting permission. test": "services/api/test/send-
- `:199` **ADVISORY** id": "rotation-target-guard control": "rotateAppRole refuses a non-ephemeral target guards": "A destructive operation cannot hit a long-lived branch. test": "services/api/test/app-
- `:212` **ADVISORY** id": "household-is-the-unit control": "household_isolation on members guards": "Two members of one household see each other; other households do not. test": "services/api/test/invi
- `:228` **ADVISORY** id": "sync-role-boundary control": "marginsheet_sync's enumerated grant (migration 0023) guards": "The Plaid sync worker cannot read a household's conversation, memory or advisory 
- `:260` **ADVISORY** distinction": "A COUNT CATCHES A WIDENING A NAMED-ITEM CHECK CANNOT. sync-role-boundary proves three specific tables are refused; this proves the set is exactly nine. Grant a fourt
- `:263` **ADVISORY** id": "token-crypto-tag control": "AES-GCM authentication tag verification guards": "A tampered ciphertext cannot be decrypted into something a caller treats as a token. test": "ser
- `:278` **ADVISORY** id": "token-never-escapes control": "PlaidError carries no request material guards": "A failed Plaid call cannot leak the access token into a log, a Sentry payload or a serialised 
- `:305` **ADVISORY** distinction": "This is the coverage-degenerate failure rather than a control failure. token-never-escapes guards one module and nothing else enforced that the module was the only o
- `:372` **ADVISORY** id": "sweep-is-blind-to-unannounced-rows control": "the repair sweep's enqueued_at predicate (M4 task 4.4.5) guards": "The repair sweep cannot become a poller for unannounced work.
- `:402` **ADVISORY** id": "mutation-branch-does-not-replay control": "the restart cursor after TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION guards": "A refused pagination is not retried from the cursor
- `:429` **ADVISORY** distinction": "The fixture's failure case is a HEALTHY long backfill, and it has to exist among the values the fixture can take or nothing is proven: a suite whose syncs all start 
- `:444` **ADVISORY** distinction": "A DELETE loses a row nobody can reconstruct, and the household sees a month's Kept figure change with no record of why. It is also irreversible in a way the flag is 
- `:447` **ADVISORY** id": "first-sync-milestone-set-once control": "the IS NULL guard on first_sync_completed_at (M4 task 4.4.4) guards": "A second sync cannot re-arm the intro trigger and introduce a 
- `:462` **ADVISORY** id": "ledgers-diverge-obligates-cash-ledger control": "the ledgers_diverge forcing field (fact package) guards": "A scenario answer claiming the ledgers diverge cannot omit the cas
- `:474` **ADVISORY** distinction": "THE COMMENT SAID FORCES SINCE M2 AND FORCED NOTHING. This is an OMISSION FAILURE: answering one ledger is not a banned word, it is a missing half, so no vocabulary r
- `:477` **ADVISORY** id": "honored-fully-obligates-not-honored-part control": "the honored_fully forcing field (fact package) guards": "A preference confirmation that was not honored fully cannot omit 

**`config/rate-limits.json`** (1)

- `:2` **ADVISORY** _doc": [ Send limits for the auth flows (M3 task 3.2e). CONFIG, NOT CONSTANTS: these live here so a limit can be read, reviewed and changed per environment without a code change, a

**`config/suite-duration.json`** (1)

- `:2` **ADVISORY** _doc": [ The database-backed suite's wall-clock budget, and the band it actually runs in. WHY THIS FILE EXISTS. On 17 Aug 2026 the api suite's testTimeout was raised from vitest's 

**`config/worker-secrets.json`** (1)

- `:2` **ADVISORY** _doc": [ Which secrets each Worker is PERMITTED to hold, per environment (M4 task 4.2). WHY. M4 section 2a rules that the Plaid token is decrypted only inside a sync Worker with no

**`packages/fact-packages/src/canon.ts`** (1)

- `:1` **UNKNOWN** Canon status, as a TYPED PROPERTY rather than a comment (ruled 15 Aug 2026). A partial fixture that gets promoted by forgetting is how invented text becomes doctrine. M12's golden 

**`packages/fact-packages/src/classes.ts`** (4)

- `:1` **UNKNOWN** Per-class blocks, transcribed from the locked schema. Each block is exactly the list of facts its canon entry says the message contains; IF A FACT IS NOT IN THE BLOCK, THE MESSAGE 
- `:102` **UNKNOWN**  HERALD FACTS ARE A SUBSET OF CLOSE FACTS BY CONSTRUCTION. One call, one package: the herald cannot say something the close does not. 
- `:177` **UNKNOWN** true FORCES the two-ledger answer shape.
- `:221` **UNKNOWN** Forces the bank-authority sentence.

**`packages/fact-packages/src/internal.ts`** (2)

- `:1` **UNKNOWN** RULE 1: INTERNAL FIELDS NEVER COMPOSE. Confidence bands, rule IDs, calibration stats travel in the package for logging and routing but are marked internal; the lint layer fails any
- `:49` **UNKNOWN**  The composer's input type: the package with every internal field removed, recursively. A composer holding a ComposerView has NO PROPERTY to reach for. Accessing pkg.block.question

**`packages/fact-packages/src/null-behavior.ts`** (2)

- `:1` **UNKNOWN** RULE 2: NULLABILITY IS DOCTRINE. A null field composes its canonical fallback (null transaction count composes 'several thousand') or omits the topic entirely; it never composes a 
- `:22` **UNKNOWN**  Every nullable field in the schema, with what null composes. COMPLETENESS IS THE ENFORCEMENT: a test walks every nullable field in every class and fails if one is missing here. A 

**`packages/lint/src/rules.ts`** (2)

- `:130` **UNKNOWN** THE SINGLE ASSISTANT RULING'S ONE LINT-ENFORCEABLE CLAUSE. CLAUDE.md has said since 15 Aug 2026 that "MyCFO" is a banned string in composed output, "enforced by packages/lint along
- `:156` **UNKNOWN** === Category canon v3.1, 18 Aug 2026 ================================== MarginSheet is a Money Intelligence Platform; MyKeeper is a Personal Money Intelligence Analyst. The rules b

**`packages/schema/migrations/0000_foundation.sql`** (1)

- `:20` **ADVISORY** updated_at is maintained by trigger, not by application code, so a write path that forgets it cannot produce a stale value (data-model-spec §0).

**`packages/schema/migrations/0014_session_auth_method.down.sql`** (1)

- `:1` **ADVISORY** Reverses 0014_session_auth_method.sql. Reversing this removes the only signal the §1 phone-change tightening has. Without it every session looks alike and the guard cannot distingu

**`packages/schema/migrations/0014_session_auth_method.sql`** (1)

- `:1` **ADVISORY** ========================================================================= 0014_session_auth_method: a session records which credential class established it. WHY. identity-onboardin

**`packages/schema/migrations/0016_network_identity_asymmetry.sql`** (1)

- `:1` **ADVISORY** ========================================================================= 0016_network_identity_asymmetry: record what 0012 actually protects. WHY THIS IS A MIGRATION AND NOT AN ED

**`packages/schema/migrations/0017_auth_send_attempts.sql`** (1)

- `:1` **ADVISORY** ========================================================================= 0017_auth_send_attempts: the ledger the magic-link rate limiter counts (M3 task 3.2e). WHAT IT IS FOR. Two

**`packages/schema/migrations/0020_channel_gate_scope.sql`** (2)

- `:1` **ADVISORY** ========================================================================= 0020_channel_gate_scope: what phone_verified_at actually gates (M3 task 3.3). APPEND-ONLY. 0001's comment 
- `:41` **ADVISORY** 0001's rule 1 named a recent-auth window as the first half of the no-write-path defence. Recording here that it is KNOWN to be unenforced as of 0020: the credential-class tightenin

**`packages/schema/migrations/0021_rule_one_fully_enforced.sql`** (1)

- `:1` **ADVISORY** ========================================================================= 0021_rule_one_fully_enforced: rule 1 is no longer half a rule (M3 task 3.4). APPEND-ONLY. 0020's comment s

**`packages/schema/migrations/0022_invitation_token_format.sql`** (1)

- `:1` **ADVISORY** ========================================================================= 0022_invitation_token_format: the invite prefix, made structural (3.5). OWED SINCE 16 AUGUST. 3.2c gave ev

**`packages/schema/src/conventions.ts`** (4)

- `:16` **UNKNOWN**  Primary key: UUIDv7, generated by Postgres. Time-ordered, so index locality holds as tables grow (UUIDv4 scatters B-tree inserts). Not sequential integers: household ids appear in
- `:31` **UNKNOWN**  Money: numeric(14,2). Never float, never for percentages. Binary floating point cannot represent 0.10. Sum enough of them and Kept is wrong by cents, which in a product whose enti
- `:52` **UNKNOWN**  A computed ratio stored as a percentage. Read this before using it. Margin (kept / income, rendered as %) is normally NOT a column: it is computed at read time by the P&L engine, 
- `:100` **UNKNOWN**  created_at and updated_at, on every table. updated_at is maintained by trigger (see the touch_updated_at function in the first migration) rather than by application code, so a wri

**`packages/schema/src/migrate.ts`** (1)

- `:1` **ADVISORY** Migration runner. Up applies every pending migration; down reverses the most recent one. Down matters more than it looks: a migration that cannot roll back is a migration you canno

**`packages/schema/src/schema.ts`** (4)

- `:35` **UNKNOWN**  Entitlement state. Null until first checkout, which the enum cannot express and the column comment records. 
- `:295` **UNKNOWN** Invariant 1, first link: an account cannot sit under another household's item. The simple plaid_item_id FK above carries the RESTRICT-on-delete semantics; this one carries househol
- `:522` **UNKNOWN** Invariant 1, second link: a transaction cannot point at another household's account. With the first link this holds transitively across transaction, account, and item.
- `:971` **UNKNOWN**  condition_states (data-model-spec §5). The watcher's dedup memory. subject_hash is GENERATED so two writers cannot hash the same subject differently and defeat the unique key. 

**`packages/shared/src/db.ts`** (4)

- `:1` **UNKNOWN** The two questions a deployed Worker must be able to answer about its database: what am I connected AS, and is the schema I was built against actually there. Both services asked the
- `:20` **UNKNOWN** GET /debug/db-identity Returns the database role this Worker authenticates as, and whether that role holds BYPASSRLS. Two values: a role name and a boolean. WHY THIS EXISTS IN PROD
- `:69` **UNKNOWN** The database half of GET /health. WHY THIS EXISTS (ruled 15 Aug 2026). /health reported {service, environment, build} and nothing else, so it proved the Worker had booted and the e
- `:114` **UNKNOWN** Schema health for the SYNC Worker, which cannot read `households`. marginsheet_sync was narrowed to nine tables by migration 0023, and `households` is deliberately not among them. 

**`packages/shared/src/models.ts`** (1)

- `:1` **UNKNOWN** The model routing table from CLAUDE.md as typed config (M0 plan Task 0.5). Registry doctrine (ruled 15 Aug 2026): call sites never carry model ID strings. Chains reference registry

**`packages/shared/src/required-secrets.ts`** (1)

- `:29` **UNKNOWN** Fails closed. A deploy that stops beats one that verifies nothing, and an environment the declaration has never heard of is exactly the case where an empty list would look like suc

**`packages/shared/src/sentry-scrub.ts`** (1)

- `:92` **UNKNOWN** Explicit null, not delete. Observed 15 Aug 2026: deleting the user object makes Sentry's ingest infer one from the connecting hop and derive a geography from it, after beforeSend h

**`scripts/neon-pr-branch.sh`** (1)

- `:32` **UNKNOWN** Delete any branch left by a previous run, so the ledger cannot survive into this one. Failure here is ignored on purpose: the usual reason is that there is nothing to delete.

**`scripts/verify-decoupling-probe.sh`** (1)

- `:1` **UNKNOWN** usr/bin/env bash The live Twilio Verify decoupling probe (M3). WHAT IT PROVES: identity-onboarding-spec §§1 and 7 require that phone is a security primitive and NOT an authenticati

**`services/api/src/auth-guard.ts`** (1)

- `:1` **UNKNOWN** The credential-class guard behind identity-onboarding-spec §1, as tightened by Guy on 15 August 2026. THE RULE: a phone change requires a passkey when the member has one registered

**`services/api/src/confirm-page.ts`** (1)

- `:1` **ADVISORY** The page the emailed sign-in link opens (M3 task 3.2a). THE LINK CONSUMES NOTHING (ruled 15 Aug 2026). This page is the whole reason that ruling is implementable: corporate email s

**`services/api/src/email.ts`** (1)

- `:80` **UNKNOWN** Leave the fallback. A body we cannot parse is not worth guessing at.

**`services/api/src/index.ts`** (7)

- `:55` **UNKNOWN** GET /health Reports the commit at the edge AND whether this Worker can actually query its database. Both halves are required: for ten merged PRs this endpoint returned green agains
- `:176` **UNKNOWN** The magic-link SEND is rate limited before Better Auth sees it (3.2e). Per email, so one address cannot be mailbox-bombed, and a global ceiling as a cost backstop, because a runawa
- `:214` **UNKNOWN** Fails closed, including when the ledger itself is unreachable. A limiter that cannot count must not grant permission.
- `:223` **UNKNOWN** The recovery path (3.1b). Mounted in the same task that built the service, because a service with no caller is a control that cannot fail, which is what the phone-change endpoint's
- `:234` **UNKNOWN** Twilio credentials are deferred until M3's phone work ships them. With none present the OTP half cannot be met, so recovery FAILS CLOSED rather than completing on one factor.
- `:285` **UNKNOWN** Delivery or nothing: an invitation that cannot be sent is not created.
- `:371` **UNKNOWN** The router, unwrapped. Exported so the journey test can enter through the same routing a browser hits: the 404 that started task 3.2a's rework was a ROUTING failure, and a test tha

**`services/api/src/invitation-routes.ts`** (1)

- `:1` **ADVISORY** The invitation endpoints (M3 task 3.5). Mounted in the same task that built the service, for the reason recorded in recovery-routes.ts: a service with no caller is a control that c

**`services/api/src/invitations.ts`** (1)

- `:190` **UNKNOWN** Single use. The status change and the member creation are one transaction, so a failure cannot leave an accepted invitation with no member or a member with a still-pending invitati

**`services/api/src/otp.ts`** (2)

- `:25` **UNKNOWN**  Checks a code against a number. Returns a BOOLEAN VERDICT and nothing else, by design. A richer return type is how a "session-shaped field" arrives: the caller must not be able to
- `:89` **UNKNOWN** A wrong code is a 404 from Twilio, not an error condition for us: it is a verdict of "no". Only the approved status is a yes, and nothing else from the response crosses this bounda

**`services/api/src/phone-change.ts`** (3)

- `:1` **ADVISORY** POST /auth/phone: the minimal real phone-change endpoint (M3 task 3.1a). OWED SINCE 15 AUGUST. The 3.2 plan ruled: "Build the minimal real endpoint here, not a stand-in. A control 
- `:76` **ADVISORY** BOOTSTRAPPING PAST RLS, exactly one id wide. `members` carries household_isolation, which filters on the marginsheet.household_id GUC. A session identifies a USER; the member row s
- `:159` **ADVISORY** Refused BEFORE any write. The test asserts on the database row rather than this response, because a handler that returns 403 while writing the change would otherwise look identical

**`services/api/src/phone-verify.ts`** (4)

- `:1` **UNKNOWN** Phone verification, and the two failures a household must be able to act on (M3 task 3.3). Verification is Twilio Verify OTP. `phone_verified_at` is set ONLY by an approved check, 
- `:70` **UNKNOWN**  Whether this number is already VERIFIED by a different member THAT THIS CALLER CAN SEE. !!! THIS CANNOT ENFORCE RULE 2, AND IT IS NOT WHAT DOES. !!! Rule 2 is global: a number ver
- `:147` **UNKNOWN** Rule 2, best effort before sending, so a household in the SAME household never receives a code for a number they cannot keep. The cross-household case is invisible here and is caug
- `:224` **UNKNOWN** The one place this column is ever set, and the place rule 2 is actually enforced. The partial unique index sees every household; this query does not. So the write is attempted and 

**`services/api/src/recent-auth.ts`** (1)

- `:1` **UNKNOWN** The recent-auth window (M3 task 3.3, wired by 3.4). !!! THIS IS WIRED TO NOTHING TODAY, DELIBERATELY AND VISIBLY. !!! Rule 1 of migration 0001 says a phone change happens "in-app o

**`services/api/src/recovery-routes.ts`** (1)

- `:1` **ADVISORY** The recovery endpoints (M3 task 3.1b). WHY THESE ARE MOUNTED IN THE SAME TASK THAT BUILT THE SERVICE. On 17 Aug 2026 the §1 phone-change tightening was found to have been nominally

**`services/api/src/recovery.ts`** (3)

- `:1` **UNKNOWN** The lost-every-device recovery path (M3 task 3.1b). §1: magic link AND phone OTP, both required, neither sufficient, ending in a newly registered passkey. Recovery that leaves some
- `:98` **UNKNOWN**  The member's verified phone, read through the RLS resolver. `members` carries household_isolation, so this cannot be read without the household GUC, and recovery runs before any h
- `:283` **UNKNOWN** The grant is spent FIRST, conditionally, so a concurrent second attempt cannot also pass. The update returns no row if somebody else spent it.

**`services/api/src/send-limits.ts`** (4)

- `:1` **UNKNOWN** Send limiting for the auth flows (M3 task 3.2e). TWO LIMITS, TWO JOBS, AND A THIRD THAT IS NOT HERE. per_email one address cannot be mailbox-bombed global a cost backstop on Postma
- `:75` **UNKNOWN**  Decides whether one more send is permitted, and records it when it is. The count and the insert are one statement each inside a single transaction, so two concurrent requests cann
- `:95` **UNKNOWN** Prune first, so the ledger cannot grow without bound and the counts below never scan rows that no window can include.
- `:134` **UNKNOWN** Fails closed. See the header: a limiter that cannot count must not grant permission. The error is deliberately not surfaced to the caller, who renders the same answer either way (s

**`services/api/src/sensitive-actions.ts`** (1)

- `:104` **UNKNOWN**  Routes that LOOK sensitive to the scan and deliberately are not. An exclusion list is a place carelessness accumulates, so every entry carries a reason and the test asserts the re

**`services/api/src/tokens.ts`** (4)

- `:1` **UNKNOWN** Token discipline: domain separation across token kinds (M3 task 3.2c). THE FAILURE THIS PREVENTS. Three token kinds carry three different powers: a sign-in link creates a session, 
- `:31` **UNKNOWN** The kinds. Recovery is reserved here so 3.1b cannot invent a colliding one.
- `:44` **UNKNOWN**  32 bytes of randomness as lowercase hex. 256 bits, URL and email safe. HEX RATHER THAN BASE64URL, and the reason is the separator. base64url's alphabet includes `_`, so a base64ur
- `:128` **UNKNOWN** THE MATRIX IS NOW 3x3 (3.1b closed 3.2c's second pass for recovery). Three kinds, three consumers, three diagonal cells that must succeed and six off-diagonal cells that must be re

**`services/api/wrangler.jsonc`** (1)

- `:1` **ADVISORY** marginsheet-api. Top level is dev; staging and production are named envs. Deploy: wrangler deploy [--env staging\|production] --var BUILD_SHA:$(git rev-parse --short HEAD) nodejs_co

**`services/conversation/src/index.ts`** (1)

- `:33` **UNKNOWN** GET /health Reports the commit at the edge AND whether this Worker can actually query its database. Both halves are required: for ten merged PRs this endpoint returned green agains

**`services/sync/src/apply-streams.ts`** (1)

- `:30` **UNKNOWN** UPDATE, and there is no code path here that deletes. The spec's phrase is flag, never delete", and a DELETE would also make the removed stream irreversible: Plaid can report a tran

**`services/sync/src/exchange.ts`** (3)

- `:1` **UNKNOWN** Token exchange (M4 task 4.3.2). RUNS HERE AND NOWHERE ELSE. The access token is encrypted with a key only this Worker holds, so the exchange happens where the key lives. `api` prox
- `:71` **UNKNOWN** Encrypted BEFORE the connection is opened, so a database failure cannot leave a window where the plaintext is held longer than it needs to be.
- `:78` **UNKNOWN** household_isolation filters on this GUC. Set inside the transaction so it cannot leak to another request on a pooled connection.

**`services/sync/src/index.ts`** (1)

- `:1` **UNKNOWN** marginsheet-sync: the deployable that holds TOKEN_ENCRYPTION_KEY. NO PUBLIC ROUTES, BY RULING (M4 section 2a). Reachable only over a service binding from api, so a household reques

**`services/sync/src/outbox.ts`** (1)

- `:1` **UNKNOWN** The outbox: writing signals, announcing them, and the two readers that point opposite ways at the same column (M4 task 4.4.5). enqueued_at IS SET AFTER THE DATA COMMITS. That order

**`services/sync/src/plaid-client.ts`** (2)

- `:39` **UNKNOWN** What may be logged or sent to Sentry. Enumerated, never the whole object. Enumerating is the same shape as the column grants in 0002 and the table grants in 0023: naming what may b
- `:70` **UNKNOWN** Calls Plaid. THE ONLY PLACE A REQUEST BODY CARRYING A TOKEN IS BUILT. The body is constructed inside the call and is never attached to anything that escapes: not to the error, not 

**`services/sync/src/reconnect.ts`** (3)

- `:1` **UNKNOWN** Reconnect, in Plaid's update mode (M4 task 4.3.4). KEYED ON THE ITEM, NEVER ON THE INSTITUTION (ruled 18 Aug 2026). An Item is a LOGIN. A household with a personal and a business l
- `:22` **UNKNOWN** The Item being repaired. Returned so a caller cannot mistake which.
- `:26` **UNKNOWN** Mints an update-mode link token for ONE Item, identified by its row id. Takes the item row id rather than a household plus an institution, because a signature that cannot express t

**`services/sync/src/sync-state.ts`** (1)

- `:31` **UNKNOWN** Should the watchdog sweep this Item back to queued? Returns a reason rather than a boolean, so a sweep that fires can say which condition it fired on. A watchdog that reports only 

**`services/sync/src/token-crypto.ts`** (1)

- `:1` **UNKNOWN** AES-GCM for Plaid access tokens (M4 task 4.2.2). LIVES HERE AND NOT IN packages/shared, DELIBERATELY. Only the sync Worker may decrypt, so only the sync Worker gets the code. Putti

**`services/sync/src/transactions-sync.ts`** (2)

- `:64` **UNKNOWN** The outer loop exists ONLY for the mutation branch. It is not a retry loop: each pass starts from a DIFFERENT and strictly safer cursor, so it cannot spin on the same rejected posi
- `:104` **UNKNOWN** Genuinely stuck, which is different from the branch being taken. A pagination that cannot complete across several restarts is not the normal case and should surface.

**`services/sync/wrangler.jsonc`** (1)

- `:1` **ADVISORY** marginsheet-sync. Top level is dev; staging and production are named envs. THE DEPLOYABLE WITH NO PUBLIC ROUTES. M4 section 2a ruled a third Worker so the Plaid token's decryption 

---

## 5. How to read this, and what it is not

**It is not a defect list.** A claim in UNKNOWN is usually true and usually exercised in spirit by a test that does not name it. The value is knowing which assertions have never been connected to evidence, because that is the population the two known failures were drawn from.

**The honest summary:** of 537 imperative claims, **198 assert that a mechanism exists**, and for **126 of those nothing was found holding them up**. Two were checked by hand this session and both were false: `ledgers_diverge` forced nothing, and the herald subset has no construction. That is a sample of two, and the sample was not random: they were the two already suspected.

**The right next step is not to fix 126 things.** It is to check a random sample of them and find out what the real rate is. Two-for-two on a biased sample says nothing about the population.

**And the method has a floor, which is a KNOWN LIMIT rather than a gap to close.** Obligations phrased as bare equations carry no verb and are invisible to any wordlist. Two of the three mistake-doctrine fields were exactly that, and they were found by reading the contract by hand. **The inventory undercounts permanently and chasing that is not worth doing**: the wordlist is a net, not a census, and the response to a permanent floor is to know it rather than to widen the net until it catches prose.

**The preferred form, above a runtime check and far above a comment: let the type system carry it.** `FraudReply.boundary_line` is typed as the literal `true`, so the flag can never be absent or false and nothing has to enforce that. The herald subset became a conditional type on 18 Aug, and the probe that had produced nothing then fails to compile now. **A type cannot be forgotten, cannot drift, and needs no test to remember it.** A comment is the weakest form of a rule and the easiest to write, which is where all 126 came from.

**THE RATCHET DOES NOT HOLD THE WHOLE LINE, AND NOBODY SHOULD READ IT AS IF IT DOES.**

The ratchet guards **12** claims under a strict, high-precision definition. This survey found **126** under a looser one. **Roughly 110 sit outside the ratchet and can regrow freely.**

That is a deliberate choice and probably the right one: the strict class is the class that can be *false*, and a rule firing on legitimate comments is a rule people learn to suppress. But the gap is real, and in six months somebody will assume the linter covers everything in this document unless it says otherwise. It does not.

**This gives the random sample a second job.** Besides measuring the rate, it tells us whether the ratchet is scoped correctly:

- if the loose class is mostly fine, **12 was the right thing to guard**
- if a meaningful share is real, **the ratchet is under-scoped and widens**

**A third bucket is counted separately: disclaimed obligations.** A comment saying "NOT ENFORCED, owed to M13" is the honest outcome the rule asks for, and an escape hatch nobody counts becomes invisible debt. Five today, recorded in the baseline beside the unbacked count, and unlike that one **it may go up**. A number that can rise is visible; a permitted form that is not counted is not.

**What was done with this survey, so it is not read as a backlog.** The ratchet in `packages/lint/test/mechanism-claims.test.ts` stops the pile growing, which was the actual fix. `docs/imperative-triage.md` splits the rest by module built or unbuilt. A random sample of twenty is owed, and until it is drawn nothing here is a rate.
