# M4 Task 4.3, Link and Exchange
## Drafted for Guy's approval, 18 August 2026. Nothing executes until approved.
## Governing doc: `plaid-pipeline-spec.md` §2. Custody from M4 §2a and §4a.

---

## 0. The failure mode this task is really about

§2 lists three things to port: the accordion, the exchange, and zombie prevention. The first is UI. **The other two share a failure mode that is not an error, and that is what makes them dangerous.**

**A duplicate Item does not throw.** A re-fired exchange succeeds. A reconnect that creates a new Item instead of reusing the old one succeeds. Both households end up connected, both see their accounts, nothing anywhere goes red. What happens instead is that Plaid bills us twice for one bank, transactions arrive on two cursors, and reconciliation compares a balance against half a ledger.

**Duplicates are billable** (Guy, 18 Aug 2026). That is the sentence that decides how these get tested.

---

## 1. Test by attempting the duplication, and assert on what PLAID holds

**Ruled 18 Aug 2026, and both halves matter.**

**Attempt the violation, never assert the guard exists.** A test that checks idempotency logic was called proves the call happened. The test that means something re-fires the exchange with the same public token and requires that no second Item exists. Same for reconnect: run it against a household that already has an Item for that institution and require the Item count not to move.

**Assert on what Plaid holds, not on what we recorded.** This is the independent-expectation rule reaching a third party. Our `plaid_items` table is written by the code under test, so a bug that creates a duplicate at Plaid while writing one row locally passes an assertion against our own table perfectly. **The billable object is Plaid's, so Plaid is what gets asked**: `/item/get` on each token, and the Item ids compared.

The tell, as always: the assertion would still pass if the subject were wrong, because the wrongness is in both halves.

### The three attempts

| Attempt | Requirement | Asked of |
|---|---|---|
| Exchange the same public token twice | one Item at Plaid, one row locally | `/item/get`, then our table |
| Reconnect an institution the household already has | Item id UNCHANGED, `needs_reauth` cleared | `/item/get` |
| Exchange concurrently, same public token, two requests at once | one Item | `/item/get` |

The third is not in the spec and I am proposing it. Link's accordion connects institutions in sequence and a household on a slow connection can double-submit. It is the same shape as invariant 1's webhook race, and the DO lock from 4.5 is the likely answer, which is a sequencing note rather than a blocker.

---

## 2. What the exchange path looks like after §4a

`api` proxies to `marginsheet-sync` over the service binding and **never sees an access token**. So:

1. Browser completes Link, posts the `public_token` to `api`.
2. `api` calls `SYNC.fetch()` with the public token and the household id.
3. `marginsheet-sync` exchanges it, encrypts the access token with the key only it holds, writes `plaid_items`, upserts `institutions`, creates `financial_accounts`, snapshots balances.
4. `api` receives a result carrying **no token**: item id, institution, account summaries.

A public token is short-lived and single-use, so `api` holding one briefly is a materially different exposure from holding an access token. Worth stating so the boundary is not misread as absolute.

---

## 3. The credential move, taken here

`plaid-credentials-still-on-api` is triggered before 4.5b and 4.3 is the natural moment, because this is the task that first makes a Plaid call.

`PLAID_CLIENT_ID` and `PLAID_SECRET` move from `api` to `marginsheet-sync` in dev and staging, are declared in `config/worker-secrets.json`, and are **removed from api**. Same shape as 4.2.4: the removal is proven separately from the setting, one environment at a time, because a credential present in both places is not a boundary and nothing fails while it is wrong.

Production Plaid credentials are Guy's paste session at 4.5b and land on **sync only**.

---

## 4. Sub-tasks

- **4.3.1** The credential move, with the inventory declaring sync before anything is pasted.
- **4.3.2** The exchange over the service binding, `api` never holding an access token.
- **4.3.3** Zombie prevention: idempotent per Item, proven by attempting a re-fire.
- **4.3.4** Reconnect in update mode, reusing the Item, `needs_reauth` cleared on success.
- **4.3.5** Institution upsert and account creation, with the Capital One parameter note carried from the port.
- **4.3.6** Register entries and planted failures.

---

## 5. Register entries this task will add

| Entry | Mutation | Must go red |
|---|---|---|
| `exchange-idempotent` | drop the existing-Item check so a re-fire creates a second | the re-fire attempt, asserted at Plaid |
| `reconnect-reuses-item` | make reconnect take the create path rather than update mode | the reconnect attempt, asserted at Plaid |
| `api-never-holds-access-token` | return the access token in the binding's response | a test asserting the response carries no token-shaped value |

The third is worth its own entry because it is the §4a boundary and nothing else would notice: a token in that response breaks nothing, and every other test passes.

---

## 6. What 4.3 will not cover

- **No production Plaid credential is used.** Sandbox only; the real connection is 4.5b.
- **The accordion is UI and belongs to M8.** 4.3 delivers the endpoints it calls.
- **No syncing.** `/transactions/sync` is 4.4.
- **Invariant 6, item removal**, is 4.8.

---

## 7. The open question I need ruled

**Does a household reconnecting a DIFFERENT institution that reports the same `institution_id` count as a reconnect or a new Item?** Plaid's update mode is per Item, so the answer follows from which Item we hand it, and the ambiguous case is a household with two logins at one bank. My reading is that these are two Items and always were, and that reconnect must be keyed on the Item rather than on the institution. I would rather have that confirmed than infer it, because getting it wrong creates exactly the duplicate this task exists to prevent.
