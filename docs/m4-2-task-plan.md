# M4 Task 4.2, Token Custody
## APPROVED as drafted, 17 August 2026. Both open questions ruled.
## Governing docs: `plaid-pipeline-spec.md` §1 and invariant 7, `data-model-spec` §2 and invariant 2, M4 §2a (the third Worker).

---

## 0. What this task is actually about

The spec sentence is short: *"`access_token_ciphertext`, app-layer AES-GCM, key in Wrangler secrets, decrypted only inside the sync worker."* Three of those five clauses are already true. **The one that is not is the one the whole ruling rests on: there is no sync worker, and the key is on `api`.**

4.1 narrowed the role and built its credential path. 4.2 moves the key to match, and the move is the task.

---

## 1. The removal is a separate deliverable from the setting, and it gets its own proof

**Ruled 17 Aug 2026 (Guy), and it is the spine of this task.**

> A key present on the sync Worker and also still on `api` is not a boundary, and "we set it over there" is the sentence that hides it.

A move is two operations and only one of them is satisfying to do. Setting the key on `marginsheet-sync` makes the sync path work, and every test of the sync path then passes. **Nothing anywhere fails if `api` keeps its copy.** The narrowed role, the third Worker, the no-public-routes argument: all of it is undone by one secret nobody deleted, and the system reports itself healthy throughout.

This is the same shape as a grant that is re-issued elsewhere rather than revoked, and it gets the same treatment: **prove the absence, not the presence.**

### How the absence is proven

The check must answer "does `api` hold `TOKEN_ENCRYPTION_KEY` right now", against the deployed reality, not against a script that was run once.

**Recommended: a `secret-inventory` CI job**, the same shape as `edge-rules`. A declared inventory in the repo, `config/worker-secrets.json`, naming which secrets each Worker in each environment is permitted to hold. The job lists the live secret names per Worker (`wrangler secret list` returns names, never values) and fails on any difference in either direction:

- a secret present that the inventory does not name (this catches the un-removed key)
- a secret the inventory names that is absent (this catches the empty-store class from 15 Aug)
- **and it keeps "differs" distinct from "could not read"**, failing on both, because a check that cannot reach the API and reports nothing is the `if: success()` failure again

Asked the standing question: **if `api` still held the key, would this go red?** Yes, and it is the only proposed control that would. A test of the sync path would not. A code scan for the binding would not, because the secret can exist in the store with no code reading it, which is exactly the state we are trying to detect.

**Rejected: a `/debug/secret-inventory` endpoint on each Worker.** It would prove the same thing from inside the running Worker, which is stronger in principle. It also publishes the list of secret names each Worker holds, and `/debug/db-identity` is already public. The name list is a map of what to attack. Not worth it for a check CI can make with a token it already has.

**Rejected: trusting the runbook.** 15 Aug already established that a document asserting a practice is not evidence of the practice.

### The second half of the same question

`api` also holds `PLAID_CLIENT_ID` and `PLAID_SECRET`, per the custody ledger. Those move too, and the same removal proof covers them, because the inventory is a whole-Worker statement rather than a per-secret one.

---

## 2. Sub-tasks

- **4.2.1** `marginsheet-sync` exists as a deployable: `wrangler.toml`, three environments, no public routes, `/health` only. Its `NEON_DATABASE_URL` comes from `scripts/sync-db-url.mts`, which refuses to mint a credential for an over-broad role.
- **4.2.2** The AES-GCM encrypt and decrypt, in one module that only the sync Worker imports. Round-trip tested, and tested against a wrong key expecting failure rather than silence.
- **4.2.3** `config/worker-secrets.json` and the `secret-inventory` CI job. **Lands BEFORE the move**, so it is red on the un-removed key rather than written afterwards to agree with whatever was done.
- **4.2.4** The move itself: set on sync, then remove from `api`, with 4.2.3 going green only after the removal.
- **4.2.5** Invariant 7, both halves. The static scan for the token in any log line, plus a behavioural probe that a Plaid error object carrying a token in a nested field does not reach Sentry with it intact.
- **4.2.6** Register entries and planted failures.

**4.2.3 landing before 4.2.4 is deliberate, and it is what makes it a proof rather than a description** (Guy, 17 Aug 2026). A check written after the change it is meant to verify **agrees with whatever was done**, which is the same reasoning as the planted failures: a control nobody has watched fail is a control nobody should trust. Written first, it is red on the un-removed key, and the move is what makes it pass.

---

## 3. The controls, and what each planted failure breaks

| Control | Planted failure | Must go red |
|---|---|---|
| `secret-inventory` | add `TOKEN_ENCRYPTION_KEY` back to `api` in the declared inventory | the job, because live and declared now agree on a state that is forbidden rather than merely different |
| The key's absence from `api` | set the secret on `api` | the job, on a difference it must not tolerate |
| Encrypt/decrypt round trip | flip one byte of the key at decrypt | the round-trip test, on an authentication tag failure rather than on garbage output |
| Invariant 7 static scan | add a log line carrying the plaintext token | the scan |
| Invariant 7 behavioural | remove the Sentry scrubber for nested provider fields | the probe |

**The first two are different controls and both are needed.** The second catches the state we are trying to prevent. The first catches somebody making the state legal by editing the declaration, which is how a drift check quietly stops meaning anything.

---

## 4. Both questions ruled, 17 August 2026

### 4a. The exchange goes over a service binding (RULED)

`api` proxies the token exchange to `marginsheet-sync` and **never sees an access token**. The alternative, a browser talking to a sync route, makes "no public routes" false on day one, and **the third-Worker ruling would then have bought nothing.**

Guy's addition, which is the part worth carrying into the threat model: **this also narrows what an `api` compromise yields.** The public surface can request an exchange and cannot read its result. A compromised `api` can cause a token to be created and cannot obtain one, which is a materially different blast radius from a compromised `api` that holds the key and the ciphertext together.

### 4b. The key is rotated as part of the move (RULED)

Rotated **because it sat on the wrong Worker, not because anything indicated compromise.** That distinction is recorded in the custody doc for the benefit of whoever reads the log later trying to work out whether there was an incident: there was not.

The deciding argument is the cost curve. Nothing suggests exposure, and *"nothing suggests exposure"* is the sentence that precedes carrying a known-weakened credential for a year. Today the key protects zero Plaid Items, so rotation means nothing at all. After 4.5b connects real institutions, rotation means re-linking them. **This is the cheapest hour it will ever be and the price only rises.**

## 4c. A note on `migrate`, so nobody spends an afternoon on it

The `migrate` CI job takes between **1m and 7m on identical work**, observed across more than ten runs. It is variance in Neon branch provisioning, not drift, and it has not failed for this reason. Recorded here so a long run is recognised rather than investigated.

**If it ever FAILS rather than merely running long, that is a different signal** and worth following.

---

## 5. What 4.2 will not cover

- **The sync Worker does no syncing.** 4.2 gives it existence, a database identity, and the key. `/transactions/sync` is 4.4.
- **No Plaid credential is used.** Production Plaid lands at 4.5b per the resequencing.
- **Deploy verification for a third Worker** is a change to the deploy workflow, and it is in scope only far enough to prove the new Worker deploys and reports its migration count.
