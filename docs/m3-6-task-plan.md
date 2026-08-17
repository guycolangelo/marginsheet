# M3 Task 3.6, The Consolidated Suite
## Drafted for Guy's approval, 17 August 2026. Nothing executes until approved.
## Governing docs: CLAUDE.md's verification rules, the M0 plan's task 0.4 planted-failure proof.

---

## 0. What this is not

**A suite that re-runs everything green proves nothing M3 has not already proven thirteen times.** Every module's tests already run on every pull request. Adding a job that runs them again in one file would be a ceremony, and this module has spent a week finding controls that were ceremonies.

So 3.6 answers a different question. Not *does M3 pass*, but **would M3 notice**.

---

## 1. The control register, and the standing question answered per control

Every control M3 ships is named in one place, and each entry answers the question this constitution asks of everything: **if the thing this guards were completely broken, would this go red?**

Answered by naming **the test that would fail**, not by asserting that one exists.

| Control | Guards | The test that goes red |
|---|---|---|
| `disableIpTracking` + 0012 trigger | no network identity in `session` | `no-network-identity`, layer 1 proof with the trigger disabled |
| `auth_method` provenance | the §1 tightening cannot be claimed by a client | `auth-method`, `passkey` provenance assertion |
| `readSignInToken` and siblings | one token kind cannot open another door | `token-matrix`, nine cells |
| `invitations_token_purpose_prefix` | an issuer cannot mint an unprefixed token | `invitations`, the CHECK attempt |
| `auth_household_id()` | the RLS hole is exactly one id wide | `rls-resolver`, four constraints |
| `household_isolation` | the household is the unit | `invitations`, the two-member assertion |
| `mayReachMember` | no money message reaches an unverified phone | `phone-rules` and the static send-path scan |
| `members_verified_phone_unique` | one verified phone globally | `phone-rules`, the confirm-time collision |
| `withinRecentAuthWindow` | sensitive actions need fresh auth | `recent-auth-wired`, the rolling-refresh control |
| `SENSITIVE_ACTIONS` | a sensitive route cannot ship unguarded | `sensitive-actions`, both directions |
| Send limits | one address cannot be bombed; spend has a ceiling | `send-limits`, proven by exceeding |
| Recovery halves | neither factor alone recovers an account | `recovery`, the cross-account case |
| `rotateAppRole` guard | a destructive op cannot hit a long-lived branch | `app-role-guard`, 12 refused targets issuing no SQL |

The register lives in code, so a control added without an entry is visible, and an entry naming a test that no longer exists fails.

---

## 2. Planted failures: break it and watch the right thing go red

Task 0.4's proof, applied to M3. **A control nobody has watched fail is a control nobody should trust**, and thirteen of them have never been watched failing.

For each entry, the harness:

1. applies a **specific breakage**
2. runs **only the named test**
3. requires it to **fail**
4. restores, and requires the test to **pass** again

Step 4 matters as much as step 3. A test that fails after a mutation and also fails after restoration is broken, not sensitive.

### The planted failures

| Breakage | Must go red |
|---|---|
| `GRANT EXECUTE ON auth_household_id TO marginsheet_sync` | `rls-resolver`, constraint 3 |
| Widen the resolver to return the member row | `rls-resolver`, constraint 1 |
| `DROP CONSTRAINT invitations_token_purpose_prefix` | `invitations`, the CHECK attempt |
| Drop the `signin` prefix check from `readSignInToken` | `token-matrix`, off-diagonal |
| Change `mayReachMember` to read `phone` instead of `phone_verified_at` | `phone-rules` **and** the static scan |
| `DROP TRIGGER session_no_network_identity` with `disableIpTracking` removed | `no-network-identity` |
| Remove the recent-auth call from the phone-change handler | `recent-auth-wired` **and** `phone-rules-static`'s wiring assertion |
| Mark an unbuilt sensitive action `built: true` | `sensitive-actions`, direction 2 |
| Make `recordSendIfPermitted` fail open on error | `send-limits`, the unreachable-ledger case |
| Accept a recovery grant with one half met | `recovery`, both single-half cases |

Source mutations are applied to a **copy of the file**, restored in `finally`, with a git-clean assertion at the end of the run. A harness that can leave the tree modified is a harness that will.

Schema mutations run against the ephemeral PR branch, which is destroyed regardless.

**This is the expensive part of 3.6 and the only part that produces new information.**

---

## 3. The honest boundary: what M3 does not cover

A green summary that omits its own limits is the report equivalent of a control that cannot fail. So the suite prints what it does **not** prove:

- **Three sensitive actions do not exist.** Cancellation (M7), member removal (3.5's endpoint was never built, only invitations were), export (M8). Recent-auth is proven on the one that exists.
- **Two live sends are still owed.** Postmark to a non-`@marginsheet.com` address once test mode clears, and Twilio to a non-allowlisted number. Both error paths are built and tested against fakes; neither has met the real provider's real error body.
- **Recovery cannot run without Twilio credentials.** It fails closed, which is correct, and it means the path has never completed end to end outside the test harness.
- **Fixtures express one household or two, never many.** Which is the ninth finding: coverage that looks complete because the failure case cannot be constructed. Three-plus member households, and a member in two households, are unexercised shapes.
- **Everything is tested against Postgres and workerd-shaped code, not against a deployed Worker**, except `db-identity` and deploy verification, which ask the live edge.

That list is generated from the register and `docs/open-items.json` rather than typed, so it cannot drift into optimism.

---

## 4. Sub-tasks

- **3.6.1** The control register, with the test that would fail named per control.
- **3.6.2** The planted-failure harness: mutate, run one test, require red, restore, require green.
- **3.6.3** The boundary report, generated rather than written.
- **3.6.4** A CI job that runs the register check and the boundary report on every PR, and the planted failures on a schedule rather than per-PR, because mutating source thirteen times is minutes rather than seconds.

The scheduling split is worth your ruling: per-PR is stronger and slower. My recommendation is per-PR for the register and boundary, nightly for the planted failures, because the mutations test the tests rather than the code, and the tests change less often than the code does.

## 5. The verification test, applied to 3.6 itself

The harness is a control, so it gets the same question. **If the planted-failure harness silently stopped mutating anything, would it go red?** It would report every control as "correctly went red" while having done nothing.

So each planted failure asserts the mutation **took effect** before running the test: the SQL is read back, the file contents are compared. A harness that cannot prove it broke something cannot prove the test noticed.
