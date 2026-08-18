# M4 Task 4.3, Link and Exchange
## APPROVED as drafted, 18 August 2026. The open question is ruled.
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
| Exchange concurrently, same public token, two requests at once (after 4.5) | one Item | `/item/get` |
| Connect TWO logins at one institution | both survive, two Item ids, two cursors | `/item/get` on both |
| Reconnect one of two Items at one institution | the OTHER Item untouched | `/item/get` on both |

The third is not in the spec and was proposed here. **Approved 18 Aug 2026, sequenced AFTER 4.5 rather than blocking it**: the DO lock is the right answer and it does not exist until then. Link's accordion connects institutions in sequence and a household on a slow connection can double-submit, which is invariant 1's webhook race wearing different clothes.

**The test CONSTRUCTS the race rather than hoping for one**, the same requirement invariant 1 carries: two exchanges fired at genuinely the same moment against one public token, asserting one Item at Plaid. Fired in sequence it passes against a completely unlocked handler, which is a fixture that cannot express its own failure.

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

  **WHAT A GREEN 4.3.2 DOES NOT MEAN, stated before it is built rather than after it passes.** Sandbox mints a `public_token` through `/sandbox/public_token/create` with no browser involved, so the handler path is fully testable in CI. **Link itself is not.** The test follows the artifact as far as the token, which is where the household's journey reaches our code, and **Link's own behaviour is unproven until M8**: the accordion, the sequencing of institutions, the Capital One parameter handling, what a household actually sees when a bank is slow or refuses.

  A green 4.3.2 means the exchange works when handed a valid public token. It does not mean the connect flow works end to end, and it must not be read that way in any status report. This is the journey rule at its boundary: a journey test starts where the household starts, and the household starts in Link, which does not exist yet.
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
| `reconnect-keys-on-item` | key reconnect lookup on `institution_id` instead of the Item id | the two-logins case, because the OTHER Item gets orphaned while the reconnected one looks perfect |
| `api-never-holds-access-token` | return the access token in the binding's response | a test asserting the response carries no token-shaped value |

The third is worth its own entry because it is the §4a boundary and nothing else would notice: a token in that response breaks nothing, and every other test passes.

---

## 6. What 4.3 will not cover

- **No production Plaid credential is used.** Sandbox only; the real connection is 4.5b.
- **The accordion is UI and belongs to M8.** 4.3 delivers the endpoints it calls.
- **No syncing.** `/transactions/sync` is 4.4.
- **Invariant 6, item removal**, is 4.8.

---

## 7. RULED: two Items, and reconnect keys on the Item

**An Item is a LOGIN, not an institution** (Guy, 18 Aug 2026).

A household with a personal and a business login at the same bank has **two credential sets, two authorizations, and Plaid bills for two.** They are two Items and always were.

**Recorded because the institution feels like the natural key and someone will reach for it.** `institution_id` is the field that looks like identity: it is stable, it is human-meaningful, it is what the UI groups by, and one row per bank is what a household would draw on a whiteboard. It is the wrong key. **Keying reconnect on the institution finds the wrong Item, updates it, and orphans the other**: the business login silently stops syncing, its cursor stops advancing, and the household sees stale figures on an account that still appears connected. No error, which is this task's whole theme.

### It gets a test, not a note

**A guard written against duplicates could reasonably treat two logins at one bank as one**, which is why the case is exercised rather than mentioned:

- connect two Items at the same `institution_id`
- assert **both survive independently**: two Item ids at Plaid, two rows, two cursors
- reconnect one and assert the other's Item id and `needs_reauth` are untouched

That last line is the one that catches the orphaning, because the duplicate-prevention bug and the wrong-key bug look identical from the reconnected Item's side. Only the other Item shows the difference.
