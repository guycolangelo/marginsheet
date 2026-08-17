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

`test/helpers/authenticator.ts` is restored from the abandoned branch unchanged. It generates a real P-256 keypair, encodes a real COSE key, hand-writes CBOR, and signs real ECDSA assertions. It is built on `Uint8Array` and `DataView` rather than `Buffer` because `@cloudflare/workers-types` shadows both the global and the module and its `toString()` takes no encoding argument.

---

## 3. Sub-tasks

- **3.1a.1** Registration: options, verification, the passkey row, and the `auth_method` the resulting session carries.
- **3.1a.2** Login: options, assertion, session issued, `auth_method` = `passkey`.
- **3.1a.3** List and revoke, which 3.1b's recovery and 3.2b's phone-change tightening both depend on.
- **3.1a.4** The endpoints mounted in the Worker, behind the send limiter where they send nothing but behind the same routing discipline.

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
