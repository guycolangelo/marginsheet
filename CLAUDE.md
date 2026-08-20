# CLAUDE.md — MarginSheet™
## The constitution. Read before every task. If a task contradicts this file, stop and ask Guy.

MarginSheet™ is a **Money Intelligence Platform**. MyKeeper™ is the household's **Personal Money Intelligence Analyst**. The core is three things: the brains, the MarginSheet (actuals + projections), and Cash Flow. The product is a belief system, The Margin Method™, and features are downstream of doctrine.

**This sentence used to read "a premium household financial operating system", which the category canon bans twice over** (the word, and the category). Corrected 18 Aug 2026, and recorded rather than quietly replaced: the constitution described the product in a competitor's vocabulary for three weeks while banning that vocabulary elsewhere.

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
| Amendments, Aug 2026 | `docs/spec-amendments-2026-08.md` (year-end projection, goal priority, Dashboard, Cash Flow, budgeting scope; **11 to 13**: two-ledger rule, spending recognition by instrument, owed tender and term fields) |
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

  **The alternating signature, recorded so the next occurrence costs thirty seconds instead of a diagnosis.** Four consecutive production deploys failed on 18 Aug 2026 and looked like one repeating fault. They were two independent controls taking turns:

  - **every commit predating a fix fails VERIFICATION**, because it carries the defect the fix removes
  - **every commit that sat waiting while another merged fails the TIP GUARD**, because main moved underneath it

  Merging a fix produces both at once: the fix's own commit invalidates whatever is queued, and everything queued still predates the fix. **Neither is a defect and neither needs a change.** What makes it expensive is reading a run list and inferring one cause from four reds. Read the failing STEP first: "Refuse to deploy a commit main has moved past" needs nothing, and a verification failure needs the raw body.

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

- **A PASSING FIXTURE MUST BE SHOWN TO PASS FOR ITS STATED REASON. Minimal-mutation proof.** Remove or alter **only the element under test** and confirm the pass disappears. If it does not, the fixture is passing on something else and the assertion is decoration.

  The instance: `"reminding you again"` was the fixture for `no-nagging`'s `reminding` inflection, and it passed. It fired on **`again`**. `reminding` alone did not fire at all, and the gap sat under a green assertion.

  **The planted-failure rule does not catch this.** Planting proves a test can go red when the CODE breaks. This proves a test goes green for the reason it claims. A fixture containing two triggers tests whichever one fires first, and says nothing about the other.

  Third order of the same idea, and the three are worth reading together: **planting** proves the test can fail, **doctrine's own sentence** proves it is aimed at the right failure, and **minimal mutation** proves the pass is earned rather than incidental.

- **A GUARD'S EVIDENCE CANNOT COME FROM THE CODE UNDER TEST. Instrument outside the mechanism, always.**

  A fixture guard exists to prove the test exercised the thing it claims. When the guard reads state the mechanism itself maintains, **the mutation that breaks the mechanism also erases the proof the fixture was exercised**, and the run reports a degenerate fixture instead of a broken control.

  The instance, 19 Aug 2026. The chain lock's guard counted **waiters**, a number the lock keeps. Planting removed the lock, so nothing ever waited, and the failure read *"the collision never formed: nothing measured"* when the collision had formed and the lock was gone. It counts **arrivals** now, incremented outside the lock, where no mutation to the lock can reach them.

  **The damage is the message, not the red.** Both versions fail. One says "your fixture was degenerate, re-run", and the other says "the thing you are guarding is broken". The first sends a reader to re-run, which is the habit that gets a real red ignored, and it is the same corrosion a flaky test causes.

  This is the same rule as **a check that reads its expectation from the thing it is checking**, applied one level down: not to the assertion, but to the evidence that the assertion had anything to assert about.

- **A MUTATION THAT PASSES IS A FINDING ABOUT THE TEST, NOT AN EXONERATION OF THE CODE. Default to the test being inadequate.**

  And the mutation set needs **at least one mutation that leaves the code reading correctly.** Removing an `await` proves a test exists. Moving an assignment proves it discriminates. **Coarse mutations only ever prove the first**, and a set made only of them reads as thorough while establishing the weaker claim throughout.

  Paid for twice on 19 Aug 2026, both times on the chain lock.

  **The one that mattered.** Moving `this.tail = ...` from before the `await` to after it leaves code that reads like a chain, is a chain by every description of it, and serialises nothing. **Every HTTP test passed against it.** The window is one microtask and two network arrivals are milliseconds apart, so nothing the network can deliver lands inside it.

  **"The window is too small to matter" was available, defensible, and wrong.** What killed it was asking **which arrival shapes exist** rather than which ones the test could produce: sync work is dispatched from inside the object as well as from the network, and a queue batch or alarm taking the lock per item takes it twice in one tick. That is precisely the arrival the network cannot make. Two arrival shapes, two tests.

  **The one that showed the rule's other half.** Testing chain poisoning, the first mutation passed and the second broke four tests at once by bypassing the bookkeeping entirely, which is this file's `USING (false)`: loud, red, and silent about the thing under test. Only the third, phrased as a sentence a reasonable engineer would write (*"propagate the failure to whoever is waiting behind us"*), reddened exactly one test on exactly the right assertion.

- **A PLANTED MUTATION MAKES THE CODE PLAUSIBLE AND WRONG, NEVER OBVIOUSLY BROKEN.** The general rule behind every mutation in the register, stated once now that the pattern is consistent enough to name.

  An obviously broken mutation proves a test **exists**. A plausible one proves it **discriminates**, and only the second is worth having, because nobody was ever going to write the obvious break. The question is not "does this break something" but "**is this what somebody would actually write**".

  The pairs, each rejected version reddening the test just as reliably:

  | Rejected, obviously broken | Kept, plausible and wrong |
  |---|---|
  | `USING (false)` on the policy | `AND is_primary`, narrowing to one member |
  | delete the session lookup | **spread the caller's body** over the derived value |
  | disable `household_isolation` | set the GUC to the **legitimate** household, so the write succeeds |
  | remove the DO | remove the **chain await**, leaving the object |
  | move the tail assignment (loud) | move it **after the await**, still reading as a chain |
  | set `workers_dev: true` | **omit the line**, which is how it actually was |

  The last is the purest: nobody writes `true`, and the failure mode is that nobody writes anything.

- **A CONTROL THAT WORKS CORRECTLY AGAINST AN IMPOSSIBLE RISK, AND CHARGES FOR IT.** Its own species, and the closest relative of the control pointed at a shape that does not occur. The difference is that this one is not merely useless: **it has a running cost, paid by whoever needs the thing it withholds.**

  `PlaidError.toJSON()` enumerates what may be published, because a raw error must never be returned: the REQUEST carries the token, so anything serialising what we sent is the real exposure. That reasoning is correct and the enumeration stays.

  **It withheld `error_message`**, guarding against an error body echoing a credential. **The seven-class capture had already shown that does not occur** — an identical seven-key envelope, no nesting, no request echo, and no credential even in the error whose entire subject is a bad secret.

  **The cost landed on the first real diagnosis.** Plaid's `INVALID_FIELD` names the offending field in `error_message` and nowhere else. The first production link-token failure reported `INVALID_FIELD` with the field withheld, and the only way forward was to reproduce the call outside the system.

  **THE TELL IS THAT THE STUDY EXISTED AND THE CONTROL PREDATED IT** (Guy, 20 Aug 2026). Nobody revisited the guard after the evidence arrived, because **a guard that costs nothing until it costs a diagnosis produces no signal in between.** There is no failing test, no red, and no moment where anybody is prompted to ask whether it is still earning its place.

  So: when a study establishes that a risk does not take the shape a control assumes, **the controls written against that shape are part of what the study is about**, and revisiting them belongs to the same change. Otherwise the evidence and the guard live in the same repository disagreeing silently.

- **A CONTROL WHOSE CORRECT OPERATION BLINDS OTHER CONTROLS.** Its own species, and the eleventh entry here. Not a control that cannot observe, and not one that depends on a vulnerability: **this one works exactly as designed and takes the watchers down with it.**

  The near-miss, 19 Aug 2026. Gating `/debug` on `ENVIRONMENT === "production"` is the cheap obvious fix and it is correct about what it refuses. It would also have 404'd the production routes `db-identity.test.ts` and `verify-deploy.sh` depend on, **blinding five live controls** in the one environment that matters, including the check that closes the `rls-not-forced` debt by proving every Worker connects as `marginsheet_app` without `BYPASSRLS`.

  **Two tells, and both are why it would have shipped.** It reads as the cheap obvious fix, so review approves it quickly. And **the damage lands in the environment where the checks matter most**, because that is precisely where the gate is active and dev and staging keep working.

  A gate that silences the checks watching the thing it guards is not a gate. It is an outage with a rationale.

  So the question to ask of any refusal, alongside the standing one: **what else was reaching through here, and does it still get through?** Gate by credential and the probes present it; gate by environment and they cannot.

- **SHARED ENVIRONMENTS ARE REACHED THROUGH THE PIPELINE OR NOT AT ALL, AND A BYPASS IS GUY'S CALL RATHER THAN ONE MADE IN FLIGHT.** (Guy, 19 Aug 2026.)

  This is the second time durable state has outlived a hand-deploy, and **both times the reasoning was sound in the moment**, which is why the rule is about the route rather than about care.

  - 16 Aug: `AUTH_ADAPTER_TEST_MAY_ROTATE_ROLE` was set by hand against shared dev, and dev's Workers lost their database until the secret was reissued.
  - 19 Aug: the chain lock was deployed to dev and staging from a feature branch to close a live exposure quickly. That registered a `HouseholdSync` **Durable Object namespace** on both, and **a DO namespace outlives the deploy that made it.** Every later deploy from main was then refused with `10064`, because main does not export the class. A redeploy cannot undo it; only a migration can.

  **The damage is not the mistake, it is the residue.** A bad deploy that only serves bad code is fixed by the next deploy. A deploy that creates a namespace, a role password, or any other durable object leaves something the pipeline cannot reach, and the fix costs a migration and a ruling instead of a revert.

  If an exposure is urgent enough to justify bypassing the pipeline, that urgency is **a decision, not an inference**, and it is made by Guy before the bypass rather than justified after it.

- **A `try` THAT SWALLOWS THROWS TURNS A SCHEMA ERROR INTO A PASSING TEST.** Its own line in the record, because it is the ninth finding in the most deceptive form yet: **it appeared in a test written specifically to prove the property it failed to prove.**

  `cross-household-upsert.test.ts` attempts a forbidden write inside `try { } catch { }`, then asserts the victim's row survived. Correct in shape. But its insert omitted `financial_accounts.plaid_item_id`, which is `NOT NULL`, **so the statement would have thrown for a SCHEMA reason before reaching any policy.** The catch swallows it, the victim's row survives trivially, the assertions pass, and the test proves nothing whatever about isolation.

  **Found by reading the schema, not by the red.** The test was green on that half.

  The general form: **when a test tolerates an exception, the exception is part of the fixture and has to be identified.** A swallowed throw is an unasserted branch, and an unasserted branch is where a fixture stops being able to tell a pass from a failure. If a `catch` is load-bearing, assert **which** error arrived.

- **CAPTURE THE BASELINE BEFORE THE PROBE, NOT AFTER.** A probe's result is a DIFFERENCE, and a difference needs two measurements. Running the probe first and comparing against a baseline you assume is clean measures nothing.

  Paid for on 18 Aug 2026: a probe on the herald subset reported six typecheck errors, which looked like the probe biting. They were pre-existing, they were mine, and I had reported a clean typecheck minutes earlier. **The probe caught the prober.** The finding was still correct, and it was correct by luck rather than by method.

  So: record the before state, run the probe, compare. It costs one command and it is the difference between evidence and a coincidence.

- **WHERE THE TYPE SYSTEM CAN CARRY AN OBLIGATION, IT SHOULD.** Preferred above a runtime check, which is preferred above a comment. A type **cannot be forgotten, cannot drift, and needs no test to remember it**, and it fails at the moment the mistake is written rather than when a suite next runs.

  `FraudReply.boundary_line` is typed as the literal `true`, so the flag can never be absent or false, and nothing has to enforce that. `_HeraldKeysAreCloseKeys` is the same idea applied to a claim that had been false since M2: the interfaces were unrelated and "BY CONSTRUCTION" described nothing, and a conditional type now makes adding an unmatched herald key fail to compile.

  The ladder is worth stating because the bottom rung is where the 126 came from: **a comment is the weakest form of a rule and the easiest one to write.**

- **PROBE, DO NOT READ. Reading a pattern tells you what its author meant. Probing tells you what it does.** The standing method for auditing any rule expressed as a pattern.

  Eleven inflection gaps sat under a green suite since M0 and were found in one run by testing the rules against inflected strings rather than by reading the regexes. **Reading them had not found the gaps, and the regexes were in front of everyone the whole time**, because a pattern reads as its intent: `\bafford(s|ed|ability)?\b` looks like it covers the inflections until you hand it `affording`.

  Same instinct as **verify against the database, never against reports**, applied to source: the pattern is the report and the probe is the database.

- **THE OMISSION FAILURE: a sentence where every word is permitted, every rule is satisfied, and it still misleads by what is missing.** Named 18 Aug 2026, because it is a different kind of failure from everything the advice gate was designed for and no vocabulary layer will ever reach it.

  The example that named it: **"This costs $104 a month."** True. Complete-sounding. Contains no banned word. And the category canon's own description of it is *"the cleanest lie by omission"*, because $104 looks like nothing and 24 months of a decision you no longer get to make is the actual price.

  **The advice gate as designed checks what is SAID. This is a failure of what is NOT said.** So the gate needs two layers rather than one:

  - **The vocabulary layer.** Deterministic, `packages/lint`, and it bans words. It cannot reach an omission by construction, because there is nothing there to match.
  - **The completeness layer.** Enforced by **required-field presence in the fact package**, not by the judge. The composer cannot state what it cannot cite, so a field that must be present is a sentence that must be written.

  **Completeness is a contract property rather than a judgement**, which is why it does not belong to M11's model. A judge asked "is anything missing" is guessing; a contract asked "is this field populated" is not.

  **THE FORCING FIELD IS THE MECHANISM, and the codebase already has three of them, none enforced.** The shape is a flag plus a nullable that the flag obligates:

  | Class | Flag | Obligates | State |
  |---|---|---|---|
  | `ScenarioAnswer` | `ledgers_diverge: true` | `cash_ledger` non-null | comment says "true FORCES the two-ledger answer shape". Nothing checks it. |
  | `PreferenceConfirm` | `honored_fully: false` | `not_honored_part` non-null | a confirmation that omits what was NOT honored reads as full agreement |
  | `ScenarioAnswer` | `tender: installment` | term and total | **the fields do not exist**, so the financing verdict is uncomposable |

  M2 named the first without enforcing it, which is the safe direction to be wrong in and is still short of a control. `NULL_BEHAVIOR` is a completeness mechanism **pointed the other way**: it governs what a null composes, and says nothing about what a populated flag obligates. The two are duals and only one has a mechanism.

  **Consequence recorded now so M11 does not rediscover it:** the adversarial set for omission failures cannot be tested until the forcing fields exist and are checked, which makes the owed `tender` and term fields a prerequisite for testing the class at all rather than a nicety.

  **And the sweep is not finished.** Three were found by reading every boolean in the contract. `Correction.verdict_changed`, `Correction.band_demoted` and `Alert.first_flag` all carry compose obligations in their own comments and none is enforced either.

- **When a fact needs provenance, add a VALUE, never a flag beside it.** A contract design rule, recorded because it will come up the next time someone reaches for a boolean.

  The instance: `tender` needs to carry how we know it, because *"you said debit"* and *"assuming debit"* are two different sentences and the reply has to tell them apart. The tempting shape is `tender` plus `assumed: boolean`. **A boolean sitting beside a field reads as a modifier of it**, and invites composing one sentence from the other. `household_stated` and `system_assumed` as separate values make them two distinct facts with **no third state to invent.**

  Same reasoning that makes `unspecified` a value rather than a null: **a shape that cannot express the ambiguity forces the composer to resolve it, and resolving it is guessing.** The general form is that a contract should make the illegal state unrepresentable rather than merely discouraged, and a flag beside a field is a suggestion where a union is a constraint.

- **State the positive fact and let the absence follow.** Absence assertions are usually a positive fact written backwards, and **the rewrite is almost always cheaper than the field.**

  Canonical exchange #7b said *"the cash leaves when the statement is paid on September 15"* and then *"Checking is not touched this month."* The second restates the first in negative form, and **the negative form is the one nothing traces to**: there is no fact for the absence of an event. Cutting the line cost no field and left the exchange correct.

  So when a claim resists tracing, check first whether it is a positive fact inverted. Adding a field to carry an absence is the expensive answer to a question that usually has a free one.

- **A banned-word rule bans a PROHIBITION, not a spelling, and its fixture is the sentence doctrine names.** Two rules from one failure, both paid for on 18 Aug 2026.

  `no-burden-verbs` was written from the canon's literal list, which says `tied up`. **It shipped passing "this TIES up your Margin for two years", which is the exact sentence the canon quotes as the thing the ban exists to stop.**

  The audit that followed found **eleven gaps across six of the seven advice rules**, every one in place since M0: `should` permitted `shouldn't`; `need to` permitted `needs to` and `needed to`; `afford` permitted `affording`; `recommend` permitted `recommending` and `recommendations`; `cut back` permitted `cuts back`; `delta` permitted `deltas`; `reminder` permitted `reminding`. **One gap was masked**, because "reminding you again" fired on `again` and looked like coverage.

  So: **banned-word patterns are written inflected**, and **where doctrine supplies its own example of the failure, that example IS the fixture.** A synthetic string built from the banned list tests the list. The doctrine's own sentence tests the ban, and it is the one the rule shipped passing.

  This is the second-order version of the planted-failure rule: planting proves a test can fail, and this proves the test is aimed at the failure the doctrine actually named.

- **THE PLANTED FAILURE COMES WITH THE TEST, NOT AFTER THE MODULE.** Planting is not a verification step performed at the end. It is the thing that establishes whether a fixture is real, and **a test that has never been planted against is an assertion nobody has confirmed can fail.**

  Four fixture failures in one week, every one caught by planting, **none by review**, and every one written by someone who had just been thinking about that exact failure mode:

  - the base64 helper that appended a literal `==`, where one of the two cases passed only because a Plaid token's length happened to need exactly two
  - the reconnect stub that modelled only `where id`, so a mutation keying on `household_id` reddened the repaired row instead of the orphaned one
  - the assertion labelled as the important one, where the other Item started HEALTHY and was asserted still healthy, so the expected value and the wrong value were the same string
  - the set-once test returning a flat empty result, which would have passed whether or not the `WHERE` clause existed

  **Knowing the trap does not prevent it**, which is what makes this a rule rather than a lapse. Each of those was written while the author was actively holding the fixture rule in mind. Review did not catch any of them, because a fixture that cannot fail reads exactly like one that can: the assertion is right, the expectation is right, and the only thing wrong is that the data can never make it false.

  Practically: a control's register entry and its planted failure are written **in the same change as the test**, and a test whose mutation has never been run is not finished. Collecting mutations at the end produces them from reconstruction, and **the direction of the break is the part that needs the context**, which the author still has and a later reader does not.

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

- **A MERGE THAT TREATS ABSENCE AS ADDITION UNDOES REMOVALS, AND REMOVALS LEAVE NOTHING TO CONFLICT AGAINST.**

  Reconciling two versions of a keyed list by id looks safe and is not. **Absent from main means EITHER new on this branch OR deleted on main, and a union by id cannot tell them apart**, so it silently reverses every deletion the other side made.

  On 19 Aug 2026 a union of `docs/open-items.json` across a long-lived branch resurrected two rows deleted hours earlier: one whose owner was a status rather than a person, and one that had been split into three so that one party owed one thing. **Both decisions were reversed by a merge that reported no conflict**, because a deletion and an absence are the same shape in the data.

  **This is why a deletion is the dangerous direction in any long-lived branch.** An edit conflicts. An addition conflicts. A removal leaves nothing behind for the merge to notice, so the older side simply wins by still having the row.

  So: after any union of a keyed list, **run whatever check validates that list** rather than reading the merge. The open-items check caught both in a second; reading the diff would not have, because a resurrected row looks exactly like a row that was always there. Where the list has no check, diff the ID SETS in both directions and account for every id present on one side only.

- **ROUTE AND GATE ARE DIFFERENT PROPERTIES, AND ADJACENCY READS AS ONE CLAIM.**

  *"All changes reach production through version control and automated deployment"* says nothing about approval. *"Every production deployment requires explicit human approval"* says nothing about which changes. **Neither is wrong. Together they imply something stronger than either states, and nobody wrote the stronger claim.**

  **The tell is that the combined claim has no author, so nothing can be checked against it.** This is the drift rule with a new mechanism: not two statements of one fact disagreeing, but two true statements of different facts merging into a third nobody made. Review does not catch it because each sentence is defensible on its own, and the defect exists only in the reading.

  Found 19 Aug 2026 in the Information Security Program, where the pair sat adjacent and a reader could take them as gating the whole pipeline. In fact `dev` and `staging` deploy automatically on merge and only `production` carries a reviewer. The fix is to state the scope in the sentence that makes the claim, and to add the consequence that carries the weight: **a bad deploy is caught in dev before staging runs, and in staging before production is offered for approval at all.**

  It generalises past compliance documents. Anywhere two true sentences about a system sit together, ask what a reader would take from the pair, and whether anybody would defend that.

- **TWO LISTS OF THE SAME THING DO NOT MERELY DRIFT. THEY DRIFT INDEPENDENTLY, SO NEITHER SIDE'S GREEN MEANS ANYTHING ABOUT THE OTHER'S COVERAGE.**

  On 19 Aug 2026 CI's test job ran `api, conversation, fact-packages, sync` and the deploy gate ran `api, conversation, lint, shared, fact-packages`. **`packages/shared` was tested at deploy and not in CI; `services/sync` in CI and not at deploy.** A change to `shared` passed every pull request check and broke main's deploy on merge, and the reverse hole was open at the same time.

  **"Shared wasn't in CI" describes a gap. "Neither list was a subset of the other" describes why no side could be trusted** (Guy). A single missing entry is a hole somebody can reason about; two lists each missing what the other has means there is no side whose green tells you anything.

  The fix is the one already recorded for `worker-secrets.json` against `REQUIRED_SECRETS`: **derive rather than restate.** Both now run `pnpm -r test`, which covers every package that has a test script, so a new package is covered the day it exists rather than the day somebody remembers two files.

- **WHEN A CONTROL GUARDS DATABASE STATE, THE MUTATION MUST BE DATABASE STATE.** A source mutation on an applied migration proves the file changed and nothing else.

  **A migration is applied ONCE, when the CI branch is created, and the harness runs afterwards.** Rewriting an already-applied `.sql` changes no database anywhere, so the harness edits the file, proves the FILE changed, runs the test against an unchanged schema, and reports the control as insensitive.

  **Three of four new controls got this wrong in one sitting**, which is what makes it a rule rather than a lapse. All three guarded RLS policies and planted `kind: "source"` against the migration text; the harness reported `broke it yes, went red NO` three times, correctly. That is its recorded limitation working: it proves a mutation changed the FILE, never that it changed BEHAVIOUR.

  The test is the standing question one level down: **where does the thing this control guards actually live?** A predicate inside a statement lives in source. A policy, a grant, a constraint or an index lives in the database, so only `kind: "sql"` reaches it, with a `proof` query that reads the state back and refuses to run the test if the mutation did not land.

- **A FIX APPLIED WHERE A DEFECT WAS NOTICED IS NOT A FIX APPLIED WHERE THE DEFECT EXISTS. Sweep for the pattern, not the incident.**

  On 19 Aug 2026 `|| true` was removed from `neon-pr-cleanup`, where a leaked Neon branch had just been traced to it. **The identical defect sat in two other files and stayed there**, silently swallowing failed scratch-branch deletions, which is one of the things that filled the project in the first place. Both were found hours later by a sweep that grepped for `|| true` rather than by anyone thinking about branch cleanup again.

  **The tell is that the fix was written while looking at the incident.** An incident hands you a file, a line and a cause, and the cause is general while the file is not. Fixing what is on screen feels complete because the reproduction stops reproducing.

  So a fix for a class-shaped defect is not finished until the class has been searched. **The search is usually one grep**, it usually takes a minute, and on this occasion it was the difference between one fix and three.

  **Its companion: the audit is worth more than the fix.** The same sweep found sixteen sites and one defect. The fifteen correct suppressions were written down with the reason each is right, in `docs/silencing-operators.md`, because **a list of examined suppressions is a stronger artifact than zero hits would have been**: the next reader can tell a deliberate suppression from an unexamined one without re-deriving all of them. A clean sweep that leaves no record makes the next sweep start from scratch (Guy, 19 Aug 2026).

- **WHEN A CONTROL GUARDS DATABASE STATE, THE MUTATION MUST BE DATABASE STATE.** A source mutation on an applied migration proves the file changed and nothing else.

  **A migration is applied ONCE, when the CI branch is created, and the harness runs afterwards.** Rewriting an already-applied `.sql` changes no database anywhere. So the harness edits the file, proves the FILE changed, runs the test against an unchanged schema, and reports the control as insensitive.

  **Three of four new controls got this wrong in one sitting** on 19 Aug 2026, which is what makes it a rule rather than a lapse. All three guarded RLS policies from migration 0026 and all three planted `kind: "source"` against the migration text. The harness reported `broke it yes, went red NO` three times, correctly.

  It is the harness's own recorded limitation doing its job: **it proves a mutation changed the FILE, never that it changed BEHAVIOUR**, and it erred toward alarm rather than false comfort, which is the direction this file already prefers. It still cost a cycle.

  The test is the same question asked one level down: **where does the thing this control guards actually live?** A predicate inside a statement lives in source, so a source mutation is right. A policy, a grant, a constraint or an index lives in the database, so only `kind: "sql"` can reach it, with a `proof` query that reads the state back and refuses to run the test if the mutation did not land.

  **Audited the register when this was found** rather than trusting memory: no other `source` mutation points at a migration, and the ones that guard behaviour implemented in application code are correctly `source`. The three were the only ones, and they were new.

- **Register mutations are reviewed as code, not as data.** The harness proves a mutation changed the FILE, never that it changed BEHAVIOUR, and proving the second is undecidable in general. A mutation that alters a line without altering what runs makes the harness report an insensitive control when the control was fine.

  **That failure leans toward alarm rather than false comfort, which is the safer direction**, and it still costs somebody an afternoon rewriting a test that was never broken. That direction is now a stated preference rather than a happy accident, because it has come up twice: **when a verifier must err, it errs toward refusing to proceed.** The took-effect check was too strict and aborted a run it could have completed. The sync-role boundary harness turned real refusals into red by wrapping each attempt in a transaction. Both cost an afternoon. The mirror images do not cost an afternoon: a took-effect check that is too loose reports every control as correctly red while mutating nothing, and a boundary harness that turned real reads into green would ship a role that can read every household's conversation **while reporting a boundary**. A verifier that fails open is worse than no verifier, because it also carries authority.

- **A check that reads its expectation from the thing it is checking cannot disagree with it.** Independent expectation, or no check. This is the general form of several findings rather than a new one, which is why it is worth stating once instead of being rediscovered per instance.

  Three, all found the same way:

  - **The isolation suite derived its own connection string** from `neonctl` and then validated it, so it proved a credential no Worker uses. The expectation and the subject came from the same place. `/debug/db-identity` fixed it by asking the deployed Worker what it actually authenticates as.
  - **The boundary report** would have been worthless generated from the prose it might restate. It is built from the register and `docs/open-items.json` instead, so it cannot drift into optimism by quoting the optimism.
  - **`sync-db-url.mts` keeps its nine-table list as a literal** rather than parsing migration 0023. Reading the expectation out of the migration would make the check agree with whatever the migration says, including a tenth table somebody added without thinking. Two independent statements of what the role may reach is the entire point; one statement read twice is not a check.

  The tell is that the check would still pass if the subject were wrong, **because the wrongness is in both halves.** A test can only distinguish a pass from a failure if its expectation was written down somewhere the failure could not reach.

- **When a contract needs defending, defend it from the boundary rather than from correctness.** A correctness argument can be defeated by finding a case where the correctness does not bind, and **that case eventually exists.** A boundary argument cannot, because it is not a claim about any particular case.

  The instance, 18 Aug 2026. `household-state-changed` carries no financial data, for two reasons. The correctness one: the watcher needs CURRENT state, so a payload carrying a delta makes it reason from the change about a state it should read. True, and defeasible: someone will find a rule where the delta genuinely suffices, and they will be right about that rule.

  The boundary one: **a payload carrying household figures puts them outside the RLS boundary.** Every column privilege, every policy, the sync role narrowed to nine tables, `household_isolation` itself: **none of it travels with a message.** That argument does not care which rule is being optimised, because it is about where the data is rather than what anyone needs from it.

  The general shape: an argument from what a component NEEDS is negotiable by changing the component. An argument from where a guarantee STOPS is not, because a guarantee's edge does not move when requirements do. So a contract's reasoning is recorded in boundary terms, and the correctness reason is supporting rather than load-bearing.

- **A correct classification with a wrong priority, because the remedy was familiar and the consequence was never examined.** A different shape from everything above. Every finding in the list is a control that could not observe something. This one observed correctly, wrote the finding down accurately, gave it an owner, and filed it two module boundaries away from where it belonged.

  On 18 Aug 2026 `secret-inventory` was found to verify that a secret's NAME exists and nothing more, because `wrangler secret list` returns no value. The fix landed for `marginsheet-sync`. The same gap on `api` was logged as "the same shape sync already carries", owner build, triggered before M7 or M13.

  **An empty `TOKEN_ENCRYPTION_KEY` means Plaid tokens cannot be read. An empty `BETTER_AUTH_SECRET` means sessions can be forged.** Identical remedy, and not remotely the same failure. The second was live in production, and every check in this repository reported green while it was true.

  **The tell is the phrase itself: "same shape as X" answers how to fix something and says nothing whatever about what happens if it is not fixed.** It is a statement about the remedy borrowed as though it were a statement about the risk, and it is persuasive precisely because it is true. Severity is a property of the consequence, never of the fix.

  So a finding gets **two** sentences before it gets a trigger: what it is, and what happens if nobody does anything. If the second sentence describes something already true in production, the trigger is not a module boundary.

  **And the trigger itself has a validity rule, which cost three corrections in one day to learn.** A module completing is a statement about **our work**, and says nothing about whether the thing it gates can happen. So **a module number is only a valid trigger for something we control.** Anything gated on a third party, a queue, a clearance or a person outside the project needs a trigger tied to **that thing clearing**.

  The instance that made it obvious: `recovery-twilio-credentials` was triggered on "3.3". 3.3 shipped, so the item read as resolved. It was not: 3.3 built a path that has never run and cannot until A2P 10DLC clears, which is a date nobody here sets. **A module number reading as a date is how a blocked thing looks finished**, and the reader has no way to tell the difference, because the trigger looks satisfied.

  The other two the same day: the canon revision was triggered on a module and belongs to the design track completing, and the service-spec revision was triggered on "before M10" and belongs to M9 finishing. Three in one day is a rule rather than three fixes.

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
- **NOTHING MERGES WITH A RED REQUIRED CHECK, AND `--admin` IS NOT AVAILABLE AS A CONVENIENCE.** If a check is red and the fix is obvious, the fix goes in a commit and the check goes green. If a check is red and wrong, that is a finding and it gets diagnosed before anything merges. There is no third case.

  **Branch protection is the control that makes every other control binding.** Every rule in this file is enforced by something that can be overridden at the moment of merge, so the override is not one control among many: it is the one holding the rest up.

  **An override used once for a good reason is an override that is available**, and every one of the twelve findings above is a control that was available to bypass and eventually was. The reason at the time is always good. That is what makes the rule about the mechanism rather than about judgement.

  Paid for on 18 Aug 2026: `--admin` merged a pull request whose `control-register` job was red. The red was real. It was hiding a harness that had never executed four registered controls, reporting them as verified because a test that cannot run exits non-zero and non-zero reads as the mutation working. **The override did not cause that defect, it deferred finding it**, which is the whole of what an override ever does.

- **A COUNT THAT LIVES IN A CONVERSATION DRIFTS FROM THE COUNT IN THE CONFIG, AND ONLY A CHECK RECONCILES THEM.**

  On 19 Aug 2026 the workers.dev retraction was discussed as **"all four"** for its entire life, from the original finding through the merge sequencing, by both of us. `config/public-surface.json` declared sync and conversation private in **three** environments each, and the probe list was `["", "-staging", "-dev"]`. **The real number was six.**

  Nothing was ever written down wrongly. "All four" was accurate when first said, about production and staging, and it survived as a phrase long after the config had grown a third environment behind it. **Neither statement was edited into being wrong. They were just two**, which is the drift rule already recorded here about `worker-secrets.json` and `REQUIRED_SECRETS`, arriving in a form neither of us watched for: **one of the two copies was a phrase in conversation rather than a line in a file.**

  What makes it worth its own entry: a phrase has no owner, no diff, and no review. **The only thing that reconciled them was the check**, which was going to fail on the two dev hosts and report exactly which. A count repeated in prose is a claim nothing verifies, and it is most dangerous when it is repeated often enough to sound settled.

  So: **when a number describes a set the repo defines, read it from the repo before acting on it**, and treat an agreed figure that nobody has re-derived as a quotation rather than a fact.

- **A WRITE KEYED ON A PROVIDER-SUPPLIED VALUE MUST NAME THE HOUSEHOLD. A write keyed on our own primary key is scoped by the key itself.**

  **The provider's namespace is shared across every household and none of it is ours.** Plaid issues one `item_id` per Item, one `plaid_account_id` per account, one `plaid_transaction_id` per transaction, and two households linking the same bank login see **the same values**. Our own `uuidv7` primary keys cannot collide across households, because we mint them.

  **All four cross-household findings of 19 August 2026 were reachable through the first case, and none through the second.** `plaid_items.item_id`, `financial_accounts.plaid_account_id`, `transactions.plaid_transaction_id`, and `applyRemoved`'s `where plaid_transaction_id = any(...)`. Meanwhile `outbox.markEnqueued` on `signal_id` and `reconnect` on `id` were audited in the same pass and left alone, deliberately, because the key already scopes them.

  **THE CHECK IS ONE QUESTION AND IT IS CHEAP: whose namespace does this key belong to?** If the answer is **Plaid, Stripe, Twilio or Postmark**, the statement names the household or it is a finding waiting to happen. If the answer is ours, the key is the scope.

  This is why 4e fixed one statement and stopped rather than adding predicates everywhere on principle. **Adding them everywhere would have obscured why `applyRemoved` was different**, and a rule applied uniformly to cases that differ teaches nobody which case mattered.

  **It does not depend on RLS being right, which is the point.** It was written because RLS was wrong: `sync_worker_access` is `USING (true)` for `marginsheet_sync`, so on that path the household GUC constrains nothing. **A statement should be correct even when the policy is wrong.**

- **RETURN WHAT HAPPENED, NOT WHAT WAS ASKED FOR.** `applyRemoved` returned `plaidTransactionIds.length`, the count of ids it was handed. It now returns the rows actually updated.

  **Those two numbers differ exactly when an id belongs to somebody else**, which is the case the function exists to get right. Returning the input length **reports success for work that did not happen**, and that is the shape of a control that cannot fail: no input produces a discrepancy, so no caller can ever detect one.

- **AN EMPTY LIST IS A STATEMENT; SILENCE IS AN INHERITANCE.** Recorded as one rule rather than three incidents, because it produced three in a single day, two of them in the same file, and every one resolved to something other than what its absence suggested.

  | Key | What absence looked like | What absence meant |
  |---|---|---|
  | `workers_dev` | not published | **published**, and the test read `undefined` as safe |
  | `preview_urls` | not published | **follows `workers_dev`**, so a wildcard over every version ever deployed |
  | `migrations` on a named env | scoped to the environments that declare it | **inherits the top level**, so production received a delete-class it was deliberately left out of |

  The third is the sharpest, because the omission was a **deliberate scoping decision**. Production genuinely had no orphaned Durable Object namespace and genuinely should not have received the migration, and leaving it out looked like exactly how you express that. It was never scoped; it only looked scoped, and the deploy failed with `Cannot apply delete-class migration to class 'HouseholdSync' which was not exported in the previous version of the script`.

  **A default is not always "off". It is whatever the tool decides**, and for a nested config the answer is frequently "whatever the parent said." So a setting that matters is **declared at the level it applies to**, and an empty list, an explicit `false`, or an explicit override is the only way to say "none" out loud.

  **The sweep this implies** (Guy, 19 Aug 2026, not this chain): any per-environment setting we believe is scoped by omission is probably inherited instead. Declare or verify per environment rather than trusting the shape of the file.

- **A DURABLE OBJECT MIGRATION TAG IS APPLIED ONCE, SO REUSING ONE IS SILENTLY SKIPPED.** Same family as append-only, different mechanism, and the failure is quieter.

  Cloudflare records which tags a script has applied. A tag already recorded is **not re-run**, whatever its new contents say. So a `deleted_classes` migration written as `v1` against a script whose `v1` was `new_sqlite_classes` does nothing at all: the deploy fails **with the original error**, and nothing anywhere says a migration was ignored. The reader sees an unchanged symptom and concludes the fix did not work, rather than that it never ran.

  Paid for on 19 Aug 2026, and the aggravating detail is that **the comment warning about it was in the file being edited** and had been written minutes earlier in the same change. Knowing the rule did not prevent reusing the tag; the second deploy attempt did.

  So: a corrective migration takes the **next** tag, and the tags a given environment carries are a property of that environment's history rather than of the file. **Divergent tag lists across environments are the honest state.** Making them uniform claims a migration ran somewhere it did not, which is the same lie as an edited migration.

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

## THE CATEGORY (locked 18 August 2026, canon v3.1)

**MarginSheet is a Money Intelligence Platform. MyKeeper is your Personal Money Intelligence Analyst.** Money Intelligence is capitalised as a category noun, always.

Your money → MarginSheet → Money Intelligence → MyKeeper → You

**Data is what exists. Intelligence is what it means.** A balance is data. A balance read against what is committed before the next deposit is intelligence. The claim is **context, not prediction, and never advice.**

The competitive line: *budgeting apps track, dashboards organize, AI assistants answer, Money Intelligence understands.*

### Analyst, never agent, and this is a constraint rather than a disclaimer

**An analyst produces the assessment. The decision-maker decides.** MyKeeper never holds authority to act on a household's money and the vocabulary must never imply it. **"Agent" is banned everywhere, including internal docs and prompt files.**

Two sentences carry it. *"MarginSheet understands your money. MyKeeper puts that intelligence to work for you."* And **required wherever the Analyst is introduced**: *"MyKeeper does the work. You make the decisions."*

Enforced as `no-agent-descriptor` in `packages/lint`, which bans the **descriptor** rather than the word: `user_agent` runs through M3's session-privacy work, and a rule that reddens the network-identity doctrine's own implementation is a rule people learn to suppress.

### Margin is the vital sign

Money Intelligence is the system. **Margin is the vital sign it produces:** one number, read at a glance, that tells you the state of your money's health.

**A blood pressure reading is not a diagnosis and it is not a prescription.** It is a fact about you that took instruments and training to produce and now takes 3 seconds to read. That frame explains three existing rules at once, which is why it is recorded rather than treated as an analogy: **why one number is enough** (nobody wants a dashboard of their vitals), **why Margin is never celebrated** (nobody congratulates a blood pressure reading), and **why the system never prescribes** (the instrument reports, the person decides).

Income − Spending = Kept ($) / Margin (%), unchanged. Causal chain control → opportunity → wealth, and only control is promised.

### What sits at spec level rather than here

The canon's operational rules amend named specs and **landed 19 August 2026 as amendments 11 to 13 plus canonical exchange #7**: the two-ledger rule and the tender beat and the financing verdict (`mycfo-mykeeper-conversational-spec.md`), spending recognition by instrument (`ledger-spec.md`), and the owed `tender` and term fields on `ScenarioAnswer` (M2).

**Three corrections separate the final from the draft**, and each is a rule elsewhere in this file doing work. **Tender is echoed into the answer**, because the composer cites answer fields and a field living only on the request cannot be cited, so *"assuming debit"* would be an uncited assertion; it carries tender and how we know it as **two values rather than a flag**. **7b's absence claim was cut rather than given a field.** And **amendment 13 asks for a discriminated union on tender**, so the installment variant carries its term fields as required and every other variant has none to omit: *"installment obligates term"* becomes structural rather than checked, which is `boundary_line`'s pattern applied to the forcing-field class. Order of preference: **type, then runtime check, then comment.**

**7c is canon before it is capability.** No field carries a term, so MyKeeper cannot state $2,496 today, and that is recorded in the fixture's status rather than left for whoever wires the endpoint to discover.

**They are deliberately not restated here.** Two hand-written statements of one requirement drift by default, and the rule against that was recorded the same day. This section carries the category and the constraint; the specs carry the behaviour.

**Not in that draft and owed its own ruling:** Margin integrity, the requirement that Margin holds itself back while an unconnected spending account or material uncategorized inflow is open. It touches `app-ui-spec.md` and `projection-spec.md` and needs a rendering decision.

## Vocabulary and format (locked; lint-enforced)

- Dollar result = **Kept** (negative = **Overspent**). Percentage = **Margin**, always the % symbol.
- Negative Margin in parentheses: (6%). Positive figures never take parentheses. Overspent renders as a positive figure and is never behavioral commentary.
- **No em dashes anywhere**, in any output, code comments included.
- "budgeting app" and "budgeting apps" always in quotation marks. "Commandments" banned. Numerals for day counts ("the first 14 days").
- **"financial" and its variants are banned in any string a household reads.** Use "money". Scoped to household-facing text by the canon's own wording, and enforced that way: `no-financial-in-household-copy` binds to `household_copy` and `composed_artifact`, not universally. Seven internal comments in this repo say "financial data" correctly, describing what the system protects, and a rule firing on them would be wrong by the text that authorises it.
- **Banned category terms:** "personal finance", "financial management", "financial wellness", "financial health". **Banned category language:** "AI-powered", "AI assistant", and "AI" appended to either mark.
- **Banned burden verbs**, in anything a household reads: tied up, locked in, working to pay, eaten by, stuck with, on the hook, saddled with, weighed down. **State the term and the total. Never judge the tender.** This is the surface where the true statement and the lecture are one word apart: *"this commits $2,496 through August 2028"* is a fact and *"this ties up your Margin for two years"* is a verdict on the household's choice.
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
