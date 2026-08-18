# CLAUDE.md — MarginSheet™
## The constitution. Read before every task. If a task contradicts this file, stop and ask Guy.

MarginSheet is a premium household financial operating system: an AI bookkeeper (MyKeeper™) and an AI CFO (MyCFO™) keep a household's books and watch the month ahead. The core is three things: the brains, the MarginSheet (actuals + projections), and Cash Flow. The product is a belief system — The Margin Method™ — and features are downstream of doctrine.

---

## Authority hierarchy (when documents disagree)

1. Guy's live rulings in conversation
2. `conversation-service-spec.md` + `mycfo-mykeeper-conversational-spec.md` (all of Phase B)
3. The Margin Method / Manifesto (doctrine, vocabulary, posture)
4. The eight Phase A specs (below)
5. Base44 code (historical reference only; it is being decommissioned)

## The spec map

| Module | Spec |
|---|---|
| M0 foundation | this file |
| M1 schema | `data-model-spec.md` |
| M2 fact packages | conversation-service-spec §fact-package |
| M3, M7 auth/spine/billing | `identity-onboarding-spec.md` |
| M4 Plaid | `plaid-pipeline-spec.md` |
| M5 filing | `categorization-spec.md` |
| M6a actuals | `ledger-spec.md` |
| M6b projections/goals/cash flow | `projection-spec.md` |
| M8 app | `app-ui-spec.md` |
| M9 migration | `migration-spec.md` |
| Amendments, Aug 2026 | `docs/spec-amendments-2026-08.md` (year-end projection, goal priority, Dashboard, Cash Flow, budgeting scope) |
| M10–M21 conversation service | conversation-service-spec + conversational spec |

---

## Build discipline (non-negotiable)

- **One module at a time. Never stacked.** Tests green before the next module opens.
- **Every task plan is drafted for Guy's approval before execution.** No unapproved scope.
- **Verify against the database directly, never against reports.** Reports lie, data doesn't.
- **"If the thing this guards were completely broken, would this go red?"** Ask it of every control before trusting it. A control that observes something adjacent to what it is trusted to guarantee will pass honestly and forever while the guarantee is absent. Ten have now failed this question: `/health` returned green against three databases holding zero tables; six connection-string secrets held the empty string while every environment reported healthy; the isolation suite validated a credential no Worker uses; the production environment carried no reviewer while the workflow said it did; a live Twilio probe reported DECOUPLING: HOLDS by scanning a 404 error body; deploy verification was guarded by `if: success()`, so it reported on the case where nothing was wrong and was absent in the case it existed to catch; the role-rotation gate asked permission to rotate and never named a target; and **the open-items mechanism this file has required since M0 was never built at all.** Each was correctly written. None could go red. A control that cannot fail is documentation.

  **The companion question, and it comes FIRST: before asking whether a control can fail, ask whether the thing it guards can happen.** Asking "would this go red if the thing it guards were broken" of a control you have already designed is a weaker question than asking it of the risk. **A control pointed at an impossible shape passes forever and is indistinguishable from one that works.**

  The clearest instance available, from 18 Aug 2026. Invariant 7's behavioural half was specified as: does Sentry scrubbing survive a Plaid error object carrying an access token in a nested field. Asked the standing question, that control answers **yes** cleanly: break the scrubber and the test goes red. It is a well-formed control by every test in this file.

  It was aimed at a shape that does not occur. Seven Plaid error classes captured from Sandbox returned an **identical seven-key envelope** with no nesting, no request echo, and no credential even in the error whose entire subject is a bad secret. The token is in the **request**, not the response, so the real exposure is anything of ours that serialises what we sent, and the scrubber would have passed forever while guarding nothing.

  Two things make it worth stating as a rule rather than as a story. **The question was answerable in twenty minutes** by capturing real error bodies, against a module's whole build. And the answer **changed what the control guards rather than how it is built**, which is the expensive kind of change to make late: a control aimed at the wrong risk is not repaired by improving it.

  The sixth is the purest example of the family and worth stating on its own: **it was not a control pointed at the wrong thing, it was a control that structurally cannot observe its own failure case.** The first five watched a proxy. This one watched the right thing and was skipped exactly when the thing went wrong. When a check is conditional, the condition is part of the check, and "run only if everything already succeeded" means "never run when it matters."

  Its sibling: nothing compared deployed state against main's tip, so **"green" never meant "current."** An approval arriving out of order rolled production back one commit and no check said so. A control that verifies the artifact without verifying that the artifact is the current one is answering a question nobody asked.

- **The eighth is the one that was tracking the other seven.** This file has required since M0 that "open items travel with named owners and print in CI". Nothing implemented it. Every owed item across three modules lived in prose that no gate ever read: the reviewer that did not exist, the handler half owed to M4 and M7, the canon fixtures, the sandbox limits that fail closed only when a real recipient appears. They were recorded faithfully and tracked by nobody.

  That makes it different in kind from the other seven. **A control that guards nothing is one failure; the mechanism for remembering failures guarding nothing is how the other seven stayed open.** It was found the same way as the rest, by trying to use it: an item needed recording "like the others" and there were no others.

  Now `docs/open-items.json` carries them and the `open-items` CI job prints them, failing when an item has no owner or nothing it is owed to. It does **not** fail because items exist. Carrying an open item is legitimate; carrying an unowned one is not.

- **The ninth is a different failure from the other eight: an honest control whose test data could not exercise it.** `household_isolation` filters on `household_id`, and every isolation test written from M1 to 3.5 passed while proving only half of what it claimed. Two members of one household should see each other; members of different households should not. **No fixture could express a household with two members**, because nothing created one until invitations existed, so only the second half was ever exercised. **Had the policy been accidentally per-member rather than per-household, every one of those tests would still have passed.**

  This is not a control pointed at the wrong thing, and not a control that could not run. The control was right, the assertion was right, and **the test data could not distinguish passing from failing.** Coverage was degenerate rather than absent, which is harder to see: a missing test is a gap somebody notices, while a test whose fixtures admit only one case looks like proof.

  The question to add when reading a suite: **what values can this fixture take, and does the failure case exist among them?** A test that can only construct the passing shape is a tautology wearing an assertion's clothes.

- **A flaky fixture is worse than an absent one, and a fixture must be asserted large enough to distinguish passing from failing before anything is measured.** This is the ninth finding's rule, written down because the ninth finding recurred within an hour of the M4 plan naming it, in the spike built to avoid it.

  **The case, because the abstraction alone would not have caught it.** Spike 1c exists to settle whether Plaid's cursor resumes with no gap and no replay. Its first run reported `noGap: true` and `noReplay: true`, and it was comparing **two empty sets**. The helper waited for `/transactions/sync` to stop returning an error rather than waiting for transactions to exist, so a fresh Sandbox Item that had generated nothing yet answered `200` with an empty page and every assertion passed vacuously. The spike was written by someone who had just finished writing the paragraph warning about exactly this, and it still happened, which is the argument for a rule rather than for care.

  So the minimum is asserted **before** anything is measured, and the run aborts rather than reporting on sets too small to tell a pass from a failure. An assertion over an empty set is not weak evidence, it is **zero** evidence wearing a green tick.

  **The flaky half is its own point, and it cuts the other way.** `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION` reproduced 3 times out of 5. A test that reddens 60% of the time when the code is correct does not teach people to look, it teaches them to re-run, and that habit is how a **real** red gets ignored. The damage is not the failing run, it is what the suite comes to mean.

  **Absent-with-an-owner beats flaky.** A gap in `docs/open-items.json` is honest, it is visible in CI, and somebody owns closing it. A flaky test is a false claim of coverage that also corrodes every true claim next to it. When a fixture cannot be made deterministic, the branch is split: test our **handler** against a synthesised response and say plainly that Plaid's behaviour is not what was proven.

  **A helper correct for the inputs it was written against is not a correct helper, and the tell is that its correctness depends on a property of the data rather than on its own logic.** The tamper tests in 4.2.2 decoded base64url by appending a literal `==`. The iv case threw immediately, because a 12 byte iv encodes to 16 characters and is already a multiple of 4. The ciphertext case **passed, and passed only because its length happened to need exactly two.** One of the two was going to be wrong and which one was decided by the length of a Plaid token. That is the fixture rule in miniature: the assertion was fine, the data made it look correct, and nothing in the helper's own logic was load-bearing.

- **A test that decrypts with a WRONG KEY proves less than it looks, and "we test with a wrong key" reads as sufficient when it is not.** Recorded where the next person writing a crypto test will meet the claim rather than only in the test that got it right.

  A wrong key can be refused **upstream of authentication**: by key import, by a length check, by a format check, by anything that inspects the key before the ciphertext is touched. A rejection therefore does not establish that the authentication tag was verified, and if the tag were silently unverified that test would still pass.

  **The test that isolates the tag is one flipped byte of ciphertext decrypted with the CORRECT key.** Nothing upstream rejects it: the key is valid, the format is valid, the version is valid, the iv is valid. Only tag verification refuses it, and if the tag is not being checked the call returns corrupted bytes and the assertion fails. The same applies to a flipped byte of the iv.

  The general shape, which is the ninth finding again: **an assertion passes for a reason, and the reason has to be the one the test claims.** A wrong-key rejection and a tag verification are two different reasons wearing one green tick.

- **Guard the target, not the action.** A gate that asks "am I allowed to do this" is not a gate on "am I allowed to do this **here**", and the damage is always decided by the second question. The role-rotating test suites were gated by `AUTH_ADAPTER_TEST_MAY_ROTATE_ROLE`, a permission to rotate that never named a place. It was set by hand against the shared dev branch on 16 Aug 2026 and dev's Workers lost their database until the secret was reissued. The operator answering that prompt is answering a question about themselves while the blast radius is a property of the target. **Any destructive operation guarded by permission rather than by place has this hole.**

  Two corollaries, both paid for.

  **Allowlist the target, never blocklist it.** Resolving the endpoint and refusing dev, staging and main is a blocklist, and a blocklist is wrong by default the moment a new long-lived branch exists: the one nobody remembered to add is the one that gets destroyed. Naming the target and refusing anything that is not `pr-<n>` fails closed on everything unanticipated. Same shape as the enumerated column grants in migrations 0002 and 0011, which list what the role may write rather than granting ALL and subtracting.

  **The refusal belongs at the operation, not in each caller.** Four test files carried their own copy of the `ALTER ROLE` and their own copy of the gate. A control that has to be remembered in four places is a control that will be correct in three. It now lives in one helper that throws before the connection is touched, so a caller whose skip logic is wrong still cannot rotate anything.

  The workflow had also carried a prominent comment saying "Never point this at a long-lived branch." It was accurate and it stopped nothing, which is the 15 Aug lesson restated: **a document asserting a practice is not evidence of the practice.**
- **A second SECURITY DEFINER function needs a household harmed, not a household inconvenienced.** That is the bar (Guy, 17 Aug 2026). `auth_household_id()` from migration 0018 is the first deliberate hole in the RLS boundary and exists because authentication cannot bootstrap without it: a session names a user, the member row names the household, and the member row cannot be read until the household is known. Every later candidate is measured against the cost of NOT having it.

  The first one to fail that bar is recorded, because a rejected case teaches the line better than an accepted one. Rule 2's global phone uniqueness cannot be pre-checked inside the policy, so a household learns a number is taken only after receiving a code. A definer function would have closed it. Ruled not worth it: **one wasted SMS and a clear refusal is an inconvenience, and the alternative is a permanent widening of the boundary** for a case that is genuinely rare, where the honest resolution is support either way. The constraint still enforces the rule; only the timing of the message changes.

- **The tenth is the control-verifier itself, and it is the one worth being least comfortable about.** 3.6's planted-failure harness exists to answer the standing question by breaking each control and requiring the right test to go red. Building it produced five flaws, four of them in the harness: a restore that could not succeed against data its own mutation permitted; a throwing restore that crashed the run and would have left the branch mutated with no report; a took-effect check too strict for insertion mutations; an inert mutation reported as an insensitive control; and a tree check that exited before printing the results it had just produced.

  What distinguishes it from the previous nine: those were controls that could not observe, could not run, or could not be exercised by their fixtures. **This was a control-verifier that could have reported every control as correctly red while mutating nothing at all.** Built specifically to catch the pattern, and vulnerable to the pattern. Caught by being run, not by being reasoned about, which is the only way any of the ten were caught.

  So the harness asserts its own mutation took effect before running anything, and that assertion is not negotiable.

- **Register mutations are reviewed as code, not as data.** The harness proves a mutation changed the FILE, never that it changed BEHAVIOUR, and proving the second is undecidable in general. A mutation that alters a line without altering what runs makes the harness report an insensitive control when the control was fine.

  **That failure leans toward alarm rather than false comfort, which is the safer direction**, and it still costs somebody an afternoon rewriting a test that was never broken. That direction is now a stated preference rather than a happy accident, because it has come up twice: **when a verifier must err, it errs toward refusing to proceed.** The took-effect check was too strict and aborted a run it could have completed. The sync-role boundary harness turned real refusals into red by wrapping each attempt in a transaction. Both cost an afternoon. The mirror images do not cost an afternoon: a took-effect check that is too loose reports every control as correctly red while mutating nothing, and a boundary harness that turned real reads into green would ship a role that can read every household's conversation **while reporting a boundary**. A verifier that fails open is worse than no verifier, because it also carries authority.

- **A check that reads its expectation from the thing it is checking cannot disagree with it.** Independent expectation, or no check. This is the general form of several findings rather than a new one, which is why it is worth stating once instead of being rediscovered per instance.

  Three, all found the same way:

  - **The isolation suite derived its own connection string** from `neonctl` and then validated it, so it proved a credential no Worker uses. The expectation and the subject came from the same place. `/debug/db-identity` fixed it by asking the deployed Worker what it actually authenticates as.
  - **The boundary report** would have been worthless generated from the prose it might restate. It is built from the register and `docs/open-items.json` instead, so it cannot drift into optimism by quoting the optimism.
  - **`sync-db-url.mts` keeps its nine-table list as a literal** rather than parsing migration 0023. Reading the expectation out of the migration would make the check agree with whatever the migration says, including a tenth table somebody added without thinking. Two independent statements of what the role may reach is the entire point; one statement read twice is not a check.

  The tell is that the check would still pass if the subject were wrong, **because the wrongness is in both halves.** A test can only distinguish a pass from a failure if its expectation was written down somewhere the failure could not reach.

- **A correct classification with a wrong priority, because the remedy was familiar and the consequence was never examined.** A different shape from everything above. Every finding in the list is a control that could not observe something. This one observed correctly, wrote the finding down accurately, gave it an owner, and filed it two module boundaries away from where it belonged.

  On 18 Aug 2026 `secret-inventory` was found to verify that a secret's NAME exists and nothing more, because `wrangler secret list` returns no value. The fix landed for `marginsheet-sync`. The same gap on `api` was logged as "the same shape sync already carries", owner build, triggered before M7 or M13.

  **An empty `TOKEN_ENCRYPTION_KEY` means Plaid tokens cannot be read. An empty `BETTER_AUTH_SECRET` means sessions can be forged.** Identical remedy, and not remotely the same failure. The second was live in production, and every check in this repository reported green while it was true.

  **The tell is the phrase itself: "same shape as X" answers how to fix something and says nothing whatever about what happens if it is not fixed.** It is a statement about the remedy borrowed as though it were a statement about the risk, and it is persuasive precisely because it is true. Severity is a property of the consequence, never of the fix.

  So a finding gets **two** sentences before it gets a trigger: what it is, and what happens if nobody does anything. If the second sentence describes something already true in production, the trigger is not a module boundary.

- **Two hand-written statements of one requirement drift by default, and the fix is to make one derive from the other rather than to keep them agreeing.** Not a check reading its expectation from its subject, which is the rule above. This is one author writing the same fact twice, hours apart, both times correctly.

  `config/worker-secrets.json` declared `sync/production` as two secrets, which was right, because production Plaid credentials are deferred to task 4.5b. `REQUIRED_SECRETS` in the sync Worker demanded four in every environment, which was also right when written, because dev and staging hold four. Neither was wrong. **They were just two**, and the deploy that first exercised both failed.

  **The tell is that both statements are correct when written and neither is ever edited into being wrong.** They drift because reality moves under one of them, and nothing connects them, so nothing notices. A rule about keeping them in sync is a rule somebody follows for a while.

  The two rules are easy to confuse and their difference is exact. A **check** needs an expectation its subject cannot reach, or it cannot fail. A **requirement** stated in two places is not two checks, it is duplication, and the second copy has no independent authority. So: derive, and let the single statement be verified by checks that examine different properties of it.

  The version that made the fix worth having: the sync Worker now derives its required list from the declaration, so **adding a secret to the declaration makes the Worker require it.** A paste that is declared and never performed fails the next deploy, which turns a runbook step into an enforced one.
 So a "did not go red" result names both causes, and adding a register entry is a code review of the mutation rather than a data entry: the question is not "does this edit the right file" but "does this actually break the thing the test is supposed to notice".

  **And the direction of the break is part of the review.** A mutation must break the control in the direction the control exists to guard, not in whichever direction is easiest to write. The two-member policy check was first planted with `USING (false)`, which turned the test red and proved almost nothing: nothing was ever going to disable that policy quietly, because disabled breaks loudly for everyone on the first request. Replanted as `AND is_primary`, it narrows visibility to one member while leaving cross-household isolation intact, which is the failure that actually threatened this system and passed every isolation test for two weeks. Both mutations redden the test. Only one of them means anything, and the test for a planted failure is not "does this break something" but **"does this break the thing the register says this test notices"**.

- **A role's documentation is a security claim, and the grant is what is true.** Two roles have now been found wider than the thing describing them, and **both were found by looking, not by anything failing.** That makes it a class rather than a coincidence, and the question belongs in every review that touches a role: **does the grant match the description?**

  `marginsheet_app` held table-level INSERT and UPDATE on `plaid_items`, which masked the column control withholding `access_token_ciphertext`: the control was correctly written and did nothing, because a table grant outranks a column revoke. `marginsheet_sync` is described in the custody doc as *"The Plaid sync worker. The only place TOKEN_ENCRYPTION_KEY is used to decrypt"*, and held INSERT, SELECT and UPDATE on **39 tables**, including `messages`, `threads`, `known_context`, `decision_journal` and every LLM log. A component with one job, and a role that can read every household's conversation history, are different things wearing the same sentence.

  **The fix both times is the same: enumerate, never grant-and-subtract.** Naming the eight tables a pipeline needs fails closed on the thirty-first table somebody adds later; granting broadly and revoking what looks sensitive fails open on everything nobody thought of. Same shape as the enumerated column grants in 0002, 0011, 0017 and 0019, and as allowlisting the rotation target rather than blocklisting long-lived branches.

  A negative control for a narrowed role attempts **several** forbidden tables from different parts of the schema, not one. One refusal proves a boundary exists; three across different sections prove it is a boundary rather than a single lucky revoke.

- **When a failure message cannot distinguish its causes, build the diagnostic. Do not guess better.** A message that reads the same for several different problems is not evidence, and reasoning harder about which one it means produces confident wrong answers at speed. The fix is a probe that separates the cases and reports which one it is.

  Cloudflare returns `10000: Authentication error` identically for an invalid token, a token unscoped to the zone, and a token scoped to the zone but not the endpoint. Those are three different fixes and one of them is not a permission at all. Guessing cost two wrong permissions and forty minutes. Adding one probe, `user/tokens/verify` plus a zone read on any refusal, turned it into a finding in a single run: token valid, zone visible, rulesets refused.

  The tell is that a second attempt at the same class of fix is being proposed. If the last answer was wrong and the evidence has not changed, the next answer is a guess wearing different words. Stop and make the evidence finer instead. This is the same instinct as **verify against the database, never against reports**, applied to error messages: the message is a report, and a probe is the database.

- **Enumerating causes is not the same as enumerating them completely, and a list of three that reads as exhaustive is worse than no list at all.** The corollary to the rule above, and it had to be paid for separately.

  The sync deploy check was written to name which half failed rather than say "unhealthy", which is the rule working. Its message for a database failure read *"empty, wrong, or issued for a role that cannot connect"*. The first real failure was a fourth cause: **connected fine, refused a table.** The role was correct, the credential was correct, and the probe was reading `households`, which migration 0023 had deliberately taken away from `marginsheet_sync`.

  A reader trusting that list would have gone looking at the credential, which was the one thing that was fine. **No list at all would have sent them to the raw error, which said `permission denied for table households` and named the problem exactly.** The list was written by someone thinking specifically about messages that cannot distinguish their causes, which is the argument for a form rather than for care.

  **The form** (Guy, 17 Aug 2026): when a diagnostic enumerates causes, it says whether the list is **exhaustive or illustrative**, and when it cannot know, it **reports the raw signal alongside the interpretation so the reader can disagree with it.** An interpretation presented without its evidence asks to be trusted; presented with it, it can be checked. Only a list that is genuinely closed, because the code enumerates every branch it can take, may be stated as exhaustive.

- **A journey test starts where the household starts.** For any flow that ends in a person doing something, the test follows the artifact the person receives: it fetches the URL out of the sent email, presents the token as delivered, opens what was actually sent. It does not call the handler directly. Calling the handler proves the mechanism; only following the artifact proves the journey, and a household never reaches the mechanism except through the artifact. On 16 Aug 2026 eleven passing tests proved a sign-in action worked while the emailed link returned 404, because every one of them reached past the link. This shape recurs wherever a composed message contains something a person is meant to act on, which is most of M13, M14 and M15.
- **Migrations are append-only after merge.** Once a migration file is on main, its contents are frozen. Corrections go forward as a new migration, never as an edit. The failure mode is worse than an error: an environment that has already applied a migration will never apply it again, so an edit reaches only the databases that have not seen it yet, and you end up with **two databases carrying identical ledgers and different schemas**. Nothing reports a problem until something reads the column. Enforced by the `migrations-append-only` CI job, which hashes every migration on main and fails on any modification. Additions pass; edits do not.
- Each spec's invariants section seeds that module's test suite. An invariant without a test is not done.
- Golden tests and the lint layer block merges in CI. No prompt version ships failing either.
- The advice gate is live before the first real message ever sends, and it never fails open.
- Scope creep toward parked items (Module 8 Balance Sheet, Module 11 build, shared learning networks, early-activation offer) is refused by default; "while we're in there" is a 2027 phrase.

## Stack (locked)

Cloudflare Workers + Pages · Neon Postgres (single DB, branching in CI) · Durable Objects (per-household lock) · Queues + Cron · R2 · Better Auth (passwordless: passkey + magic link; phone = security primitive via Twilio Verify) · Plaid production (Sandbox for CI only) · Stripe · Twilio (two A2P numbers, one per brain) · Postmark (brains' email) · Kit (commercial voice only) · Sentry · PostHog · GitHub Actions.

**Model routing** (fallback chains, golden-tested per chain member):
- High-stakes composition (close, Briefing, verdict-flip corrections): Fable 5 → Sonnet 5 → **stop and queue**
- Routine composition: Fable 5 → Sonnet 5 (flagged)
- Time-critical alerts: Fable 5 → Sonnet 5 → canonical fixture
- Advice-gate judge: Sonnet 5 → Haiku 4.5 → **no send, ever**
- Parsing/extraction/merchant lookup: Haiku 4.5 → Sonnet 5
- The composer never computes; every number traces to a fact-package field or it is a hard failure.

## Vocabulary and format (locked; lint-enforced)

- Dollar result = **Kept** (negative = **Overspent**). Percentage = **Margin**, always the % symbol.
- Negative Margin in parentheses: (6%). Positive figures never take parentheses. Overspent renders as a positive figure and is never behavioral commentary.
- **No em dashes anywhere**, in any output, code comments included.
- "budgeting apps" always in quotation marks. "Commandments" banned. Numerals for day counts ("the first 14 days").
- ™ on first/prominent use: MarginSheet™, The Margin Method™, MyKeeper™, MyCFO™. "AI" never appended to the marks. **"AI" appended is lint-enforced; PLACEMENT IS NOT, deliberately (ruled 16 Aug 2026).** The unit of "first use" is a **journey, not a file**: the sign-in confirm page and the signed-in page are two files and one journey, and a household walking it met the mark twice inside two sentences while each file was individually correct. A file-scoped rule would have passed that and called it checked. **A rule that is wrong about its unit is worse than a human reading the copy**, because it produces confidence rather than merely producing nothing. So trademark placement is a **copy-review item**, checked when a journey's copy is reviewed, and it is not lint's job.
- P&L lines: income, fixed_obligations, variable_operating, discretionary, interest_fees, transfer, deployment. Taxes is a category ("Taxes After Takehome") under fixed_obligations, **not a line**.
- Banned in analytical replies: "should," "need to," "afford," "cut" (as instruction), "recommend," affordability verdicts, "delta/variance/discrepancy" in corrections, "again/still haven't/reminder" in follow-up alerts, "good call"/"that cost you" on decisions.

## Product doctrine (the short form)

- Income − Spending = Kept. The trial is 14 days, card required. Annual Planning Session is included with every subscription; the clean-books gate is eligibility, never price.
- Unconfirmed inflows count as income, labeled, with the transparency counterfactual shown. Transfers are neither. Refunds net against spending. Reimbursements are AR. Gifts are income, filed by asking.
- The brains state facts and costs; they never name actions with money. Meanings are asked, never asserted. Estimates are sourced or asked, never invented. Model memory is banned as a source for current figures.
- Commercial voice (billing, offers, dunning) is MarginSheet through Kit — never a brain.
- The app is the inspection room, not the workroom. Nothing chases the household.
- Corrections: fix the books first, own it in one flat sentence, never silently revise a sent artifact.

## THE SINGLE ASSISTANT RULING (locked 15 August 2026)

Supersedes the two-staff model everywhere it appears.

**MyKeeper is the household's only named assistant.** One name, one phone number, one contact card, one email identity. A household never chooses who to contact, because there is only one door.

Behind that name the two brains remain architecturally separate:
- The bookkeeping brain: retrospective, transaction-level, structured.
- The advisory brain: prospective, aggregate-level, forward-looking.

They keep separate system prompts, separate jurisdictions, separate golden tests, and **the advice gate stays enforced on advisory output exactly as specified**. MyKeeper routes to the right brain, sometimes both, and answers as one.

**MyCFO becomes an INTERNAL DESIGNATION ONLY.** It may appear in fact packages, routing config, instrumentation, and the QA harness. It must never appear in any household-facing surface, message, email, or marketing. "MyCFO" is a banned string in composed output, enforced by `packages/lint` as `no-mycfo-in-composed-output`, bound to the `composed_artifact` context with a fixture pair. **That sentence was here from 15 Aug 2026 and was false until 18 Aug**: the only rule naming MyCFO caught "MyCFO AI" and permitted bare "MyCFO" everywhere. Worse than an ordinary gap, because the constitution told every reader the check existed and so nobody looked, and it would not have bitten until M10 composed its first message. The context binding is the whole rule: MyCFO stays legitimate in routing config, fact packages, instrumentation and the QA harness.

Consequences:
1. The conversational spec's two registers become two MODES of one voice. That is a canon revision, not a rename, and it is **owed to Guy**.
2. Handoffs stay in the architecture and become invisible. The three-minute fulfillment budget still applies; the brains no longer name each other to the household.
3. One A2P campaign, one number, one Postmark sender identity instead of two.
4. Intro flow: one introduction, not two staggered ones.
5. Any fact-package class existing only to carry cross-brain attribution is reviewed and **reported**, never silently deleted.

## THE ARTICLE-AS-ANSWER PATTERN (locked 15 August 2026)

Names a permitted mechanic. It tightens nothing and loosens nothing.

When a household asks a strategy question (debt payoff order is the canonical case), the permitted answer is: name the common approaches evenly with their real rationale, point to a published Method article, and state that the choice is theirs. Once the household names their choice, serve the data sorted the way that choice implies.

"Here are your cards ranked by rate, highest first" is a fact and passes. "Here's where to start" is a recommendation and fails. **The sorted list does the work; the framing sentence must not.**

This requires a named reference source in the fact package that the composer may point to, distinct from prose it generates. Owed as an M2 amendment with its own plan (Guy, 15 Aug 2026), carrying two requirements he added:

1. **The article's identity is a stable slug, not its URL or title.** Both of those change when an article is edited or renamed. The reference block carries the slug and resolves title and URL at assembly time, so a renamed article never strands a citation inside an artifact that was already sent. This is the same rule as corrections: a household who read something on Tuesday must still find it on Friday.
2. **The gate rule ships as a fixture PAIR, not only as a rule.** One passing example (cards ranked by rate, reference attached, no action named) and one failing example (the same list, framed as "here's where to start"). Side by side they make the line teachable to whoever tunes the judge; a rule stated in prose does not.

## NET WORTH DOCTRINE (locked August 2026)

MarginSheet's promise is control, and the opportunity to create wealth. It never promises wealth outcomes. The causal chain in all copy and all product language is: control, then opportunity, then wealth. Only the first is promised.

1. Net worth is never a hero metric. It is never the largest number on a screen, never the lead figure in a digest, never the opening line of any composed deliverable.
2. Net worth is never celebrated. No congratulations, no milestones, no streaks, no achievement framing, from either brain, in any channel, ever. The brains do not have opinions about the size of a household's net worth in either direction.
3. The Module 8 Balance Sheet reports position ("where you stand") without scoring it. Net worth may appear as a computed line on the Balance Sheet. It is information, not evaluation.
4. Margin is the only celebrated number, because Margin is the only number the household controls. Net worth moves with markets and estimates; Margin moves only with household decisions.
5. Rationale for reviewers: a net-worth-led product flatters the user about assets the same way a moralizing product lectures the user about debts. Both are the tool having opinions about the person. MarginSheet is an instrument. It sees everything and judges nothing.

Rules 1 and 2 are enforced by `packages/lint` (`no-net-worth-lead`, `no-net-worth-celebration`), the same engine that gates commits today and M11's send path in October. Rule 1's "largest number on a screen" clause is a design review item, not lint-detectable; see the rules file.

## NETWORK IDENTITY: CUSTODY IS THE LINE (amended 16 August 2026)

The original ruling (15 Aug) said MarginSheet holds no network identity: `disableIpTracking` plus the 0012 trigger, and Sentry stripped in three layers. Rate limiting forced the question of what "holds" means, and the answer is recorded here in both halves so the next person finds an answer rather than the argument.

**The rule is CUSTODY, not contact.** Cloudflare already handles the client IP as a matter of routing on every request, whether or not we act on it. A control that runs at the edge leaves custody where it already sits. A control that runs in our code takes custody, because we choose the key, the store and the lifetime.

- **Permitted:** Cloudflare edge rate limiting, WAF rules, and anything else where the IP is handled by infrastructure that already has it and never reaches a Worker.
- **Refused:** keying our own counters, logs, tables or caches on an IP **or any derivative of one**, including a salted hash with a short window.

**Why the hash was refused, since it is the tempting middle.** The bright line is the value, not its reversibility. A hashed IP with a 15-minute window is genuinely hard to reverse, and that is not the point: once "derived from network identity, transient, hashed" is an acceptable category, it gets cited for the next feature and the one after, and each citation is individually reasonable. A line that admits degrees is not a line. Guy, 16 Aug 2026.

**The cost, accepted knowingly.** Per-source limiting can only express what Cloudflare's rule engine expresses, and it cannot be combined with application state, so "this IP, for this household, on this endpoint" is not available. That is a real capability given up.

**The drift obligation that comes with it.** An edge control is invisible to code review, and a control living only in a dashboard is what broke production deploys on 16 Aug 2026. So any edge control is declared in the repo (`config/edge-rate-limits.json`) and verified against the live zone by the `edge-rules` CI job, which keeps "absent or altered" distinct from "could not read" and fails on both. An edge control without a repo declaration and a check is not permitted either.

## Current state (updated 14 Aug 2026)

Spec phase complete (8/8 + 2 brain docs). Targets: **1 Oct stretch** (platform, founder migrated), **1 Nov real** (founder fully live), beta cohort gated on founder OK + objective floor (zero advice-gate hard failures, zero traceability failures, trailing 14 days). M0 opens next. External clocks: A2P 10DLC submission, cyber liability quotes, attorney hour (8 items) — Guy's desk.
