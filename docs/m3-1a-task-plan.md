# M3 Task 3.1a, Passkey Registration and Login
## Drafted for Guy's approval, 17 August 2026. Nothing executes until approved.
## Governing docs: CLAUDE.md, identity-onboarding-spec §1, docs/m3-1-task-plan.md, amendments 9 and 10.

---

## 0. The question you asked, answered by measurement

**Does a real signed cookie from a real magic-link sign-in actually exercise the WebAuthn path end to end?**

**Yes. Verified tonight against a real database, the real plugin and the real verifier, before this plan was written.** It is not sufficient on its own, and the two things it needs are behaviours a browser performs, not stubs and not workarounds.

### The evidence chain, in the order it was found

| What the caller supplied | What happened |
|---|---|
| A cookie hand-built from `internalAdapter.createSession` (the abandoned WIP) | `APIError: Unauthorized`. Never reached any WebAuthn code |
| A real `realSignIn()` cookie | `Failed to verify registration`. **Past the session gate and inside WebAuthn** |
| Same, plus an `Origin` header | `Challenge not found`. Past attestation verification |
| Same, plus the challenge cookie the options call sets | **REGISTRATION VERIFIED**, passkey row written, **LOGIN VERIFIED** with a session issued, forged signature **REFUSED** |

Each step moved the failure strictly deeper. That progression is the proof: the session cookie is doing real work, because nothing downstream of it could be reached without it.

### The two browser behaviours the harness must reproduce

**1. The `Origin` header.** `@better-auth/passkey` derives its expected origin from the request:

```js
const origin = options?.origin || ctx.headers?.get("origin") || "";
```

With no `Origin` header it compares the attestation's origin against the empty string and fails with `Failed to verify registration`, which reads like a broken authenticator and is not one. Every browser sends this header on a WebAuthn call.

**2. The signed challenge cookie.** `generatePasskeyRegistrationOptions` mints a verification token, sets it as a **signed cookie** on its response, and stores the challenge in `verification` keyed by that token. `verifyPasskeyRegistration` reads the cookie back to find the challenge. A browser stores and returns it automatically; the harness must carry it from the options response into the verify request. Without it: `Challenge not found`.

Neither is a concession. A test that omitted them would be testing something no browser does.

### The correction this turned up

The abandoned WIP commit states: *"The WebAuthn half is solved and is NOT a mock."* **That claim could not have been observed when it was written**, because every test in that commit failed at `Unauthorized` before reaching a line of WebAuthn code. It happens to be **true**, which I confirmed by calling `@simplewebauthn/server`'s `verifyRegistrationResponse` directly with the authenticator's output: `verified: true`, under both `requireUserVerification` settings. But it was asserted on inspection rather than execution, which is the shape this build keeps finding. Recorded so the claim now rests on a run instead of a reading.

### Conclusion

**No gap, and no manual verification is owed.** The risk flagged when the authenticator was built resolves in your favour: the authenticator is real, the verification is real, and the session that unlocks it is one the product actually issues.

---

## 1. Scope

Passkey registration, login, list and revoke, against a session produced by `realSignIn()`.

**Out:** the recovery path (3.1b), the layer 1 proof (already landed in 3.2d), phone rules (3.3), recent-auth (3.4), invitations (3.5). Screens are M8. The label detection and placement rulings recorded as amendments 9 and 10 are **M8's to build**; this task ships the endpoints they call.

---

## 2. The harness contract, written once

The three requirements above are easy to get right once and then forget, and a later test that omits the `Origin` header would fail with a message pointing at WebAuthn. So they live in one helper, `test/helpers/webauthn-client.ts`, which models **what a browser does**:

- carries the session cookie from `realSignIn()`
- sends `Origin` on every WebAuthn call
- captures `Set-Cookie` from an options call and returns it on the matching verify call

`realSignIn()` stays the only source of a session. The passkey helper consumes it and adds nothing that mints one.

**The helper carries its own reasoning, because the failure mode is subtle.** Dropping either the `Origin` header or the challenge cookie makes a test FAIL, not pass, and the failure reads like a broken authenticator. The danger is the fix somebody reaches for next: the plugin checks `options?.origin` **before** the request header, so configuring `origin` in the plugin options makes the header irrelevant and turns the suite green while nothing ever checks that the browser's origin matched. That is the version that passes while testing something no browser does, and the helper names it so the next author meets the warning before the temptation.

`test/helpers/authenticator.ts` is restored from the abandoned branch unchanged. It generates a real P-256 keypair, encodes a real COSE key, hand-writes CBOR, and signs real ECDSA assertions. It is built on `Uint8Array` and `DataView` rather than `Buffer` because `@cloudflare/workers-types` shadows both the global and the module and its `toString()` takes no encoding argument.

---

## 2a. The §1 tightening, and the control that has never bitten

**RULED 17 Aug 2026 (Guy).** The refusal case, a member who has a passkey attempting a phone change on a magic-link session, has never been exercised. It is treated as the same class as everything else found this week: **a control that has been nominally live since 3.2b and has never actually bitten.** It is asserted by attempting the change and requiring refusal, with the success case beside it so it is not merely blocking everything.

### It is worse than "no test could create a passkey"

Checked before building rather than assumed. **The phone-change endpoint does not exist.** 3.2b shipped `src/auth-guard.ts` with `mayChangePhone()` and a pure-logic test whose own header says the endpoint-level proof "lands with the minimal phone-change endpoint". It never landed.

That contradicts a ruling already on record. From `docs/m3-2-task-plan.md` §2, 15 Aug 2026: *"Build the minimal real endpoint here, not a stand-in. Guy's reasoning: a control tested against a stand-in is a control nobody has exercised, and the endpoint is small."*

So the decision table is correct, tested, and **wired to nothing**. `mayChangePhone()` has no caller anywhere in `src/`. Asked the standing question, would this go red if the tightening were completely broken: no, because there is no path through which a phone change can be attempted at all. A function that returns the right answer to a question nobody asks is the purest form of the shape.

### What 3.1a therefore ships

The minimal real endpoint, as ruled on 15 August, plus the three cases proven **through it** rather than against the function:

| Member state | Session established by | Attempt | Required result |
|---|---|---|---|
| has a **real** registered passkey | magic link | change phone | **refused**, and the phone is unchanged in the database |
| has a real registered passkey | passkey | change phone | **succeeds** |
| no passkey | magic link | change phone | **succeeds**, the case named as the one that matters |

Row 1 is the control and could not be constructed before tonight, because no test could register a passkey. Row 2 is what stops row 1 being "refuse everything". Row 3 is what stops the tightening locking out every member who has not registered a passkey.

The assertion is on the **database row**, not on the response, so a handler that returns 403 while writing the change still fails.

**Scope boundary unchanged:** the phone-change *mechanics* (uniqueness, verification, no channel write path) remain 3.3. This is the *authorization* only, which is what §2 of the 3.2 plan ruled.

## 3. Sub-tasks

- **3.1a.1** Registration: options, verification, the passkey row, and the `auth_method` the resulting session carries.
- **3.1a.2** Login: options, assertion, session issued, `auth_method` = `passkey`.
- **3.1a.3** List and revoke, which 3.1b's recovery and 3.2b's phone-change tightening both depend on.
- **3.1a.4** The endpoints mounted in the Worker, behind the send limiter where they send nothing but behind the same routing discipline.
- **3.1a.5** The minimal phone-change endpoint owed since 15 August, and the three §1 cases proven through it against a real registered passkey.

---

## 4. The controls, each attempting the forbidden thing

| Attempt | Required result |
|---|---|
| A forged signature presented at login | refused. **Already verified: `Authentication failed`** |
| Registration with no session | refused, and no passkey row appears |
| Registration with a valid session but no challenge cookie | refused, and no row |
| A challenge replayed after use | refused |
| Registering member A's credential against member B's session | refused |
| Revoking a passkey belonging to another member | refused |
| A member with a passkey changing their phone on a magic-link session | refused, which is 3.2b's tightening proven against a **real** passkey for the first time |
| A member with **no** passkey changing their phone on a magic-link session | succeeds, the case you named as the one that matters |

The last two are why this task matters beyond passkeys: the §1 tightening has only ever been tested against a member with no passkey, because until tonight no test could create one.

---

## 5. What this closes and what it does not

**Closes:** the 3.1 plan's named risk about the software authenticator, and the resequencing debt from 15 August.

**Does not close:** 3.2c's second pass. Recovery tokens still have no consumer, and that stays owed to 3.1b. The open-items entry is unchanged.

**Owed by this task on completion:** an update to the `no recovery consumer is exported` assertion in `token-matrix.test.ts` if 3.1b lands first, and nothing else.

---

## 6. The verification test, applied

Every control above attempts the forbidden operation rather than inspecting a definition. The forged-signature control is the one that makes the rest meaningful: if the server were not really verifying, it would pass and everything else would still be green. It has already been run once, and it refused.
