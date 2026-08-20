# 4.5b prime: connect real institutions, and get a ledger from them

**DRAFT FOR GUY'S APPROVAL. Nothing here is built.**

Ruled 19 August 2026: build a minimal connect surface, not the designed one, so
real institutions can be connected before M5, M6 and M8. M8 builds the real
surface with the accordion and the account picker.

---

## 1. The scope is larger than a page, and the reason is in the sync engine

The ruling scoped four things: a link token endpoint, a page, a sync trigger, and
a connected-accounts list. Three of those are small. **The sync trigger is not a
trigger, because there is nothing to trigger.**

**`runTransactionsSync` counts rows and discards them.** It pages through
`/transactions/sync`, accumulates `page.added.length`, `page.modified.length` and
`page.removed.length`, persists the cursor after every page, and returns the
counts. **The rows themselves are never handed to anything.**

And `apply-streams.ts` holds `applyRemoved`, `markFirstSyncCompleted` and
`didChange`. **There is no `applyAdded` and no `applyModified`.** Nothing in the
repository writes a row into `transactions`.

So the honest statement of what exists after 4.4: a paginator that is correct
about cursors, a removed-stream flagger, a coordination state machine, and an
outbox. **What does not exist is the thing that turns a Plaid page into a
household's ledger.**

**This was understated in the earlier scoping.** It was described as
`persistInFlight` having no caller, which is true and is the smaller half. The
larger half is that even with a caller, a sync would write nothing.

---

## 2. What 4.5b prime actually needs

| # | Piece | Size | Throwaway? |
|---|---|---|---|
| 1 | `POST /plaid/link-token`, new-connection mode | small | no, M8 keeps it |
| 2 | The connect page | small | **yes** |
| 3 | **`applyAdded` and `applyModified`: the transaction writer** | **the real work** | **no** |
| 4 | **The sync runner: the caller that owns a transaction** | **the real work** | **no** |
| 5 | `GET /plaid/accounts`, what is already connected | small | mostly |
| 6 | A way to run a sync by hand | small | yes |

**Only items 2 and 6 are throwaway.** Items 3 and 4 are M4 work that 4.5b prime
forces early, and M8 keeps 1 and 5. That is worth stating plainly because "a
minimal connect page" sounds like an afternoon and the ledger writer is not.

### The link token (1)

`reconnect.ts` already calls `/link/token/create` in **update** mode. New
connection is the identical call minus `access_token`, plus `redirect_uri` for
OAuth institutions. Same credentials, same client, same error shaping.

**`redirect_uri` is `https://api.marginsheet.com/plaid/oauth-return`**, registered
in the Plaid dashboard on 19 Aug 2026. It must match exactly: HTTPS, no `#`, no
query string, no wildcard.

**No `webhook` field** (Guy, 19 Aug 2026). The receiver is 4.5's other half and
does not exist, so setting one means Plaid retries into nothing and we generate
failures we cannot see. **Recorded as a stated limitation rather than left to be
discovered: syncs are manual until the `provider_events` path lands.**

### The transaction writer (3)

Per `categorization-spec` and `ledger-spec`, and this is where the care goes:

- **added**: insert, with `pending` from Plaid's flag
- **modified**: update in place, which is how a pending row becomes posted
- **removed**: `applyRemoved` already exists and flags rather than deletes
**THE PROVIDER-KEY RULE IS APPLIED AT THE POINT OF WRITING, NOT AFTER** (Guy,
19 Aug 2026). `applyAdded` and `applyModified` are NEW write paths on
`transactions`, which is the table where the ledger lives and where the worst of
the four cross-household findings landed. `plaid_transaction_id` is Plaid's
namespace, shared across every household, so **both statements name the household
in the statement itself** rather than relying on migration 0026's policy.

Both must hold independently, which is the reason 4e landed before 4c: a
predicate somebody forgets is a hole, a policy somebody forgets is a refusal.
Writing these without the predicate and adding it later would reproduce exactly
the defect that took a day to find, in the same table, weeks after the lesson.
- **`(household_id, plaid_transaction_id)` is the conflict target** once migration
  0026's sibling constraint work lands, and the global unique index is the open
  finding until then

**The pending-to-posted transition is the reason this exists**, and it is the one
thing Sandbox could never construct.

### The sync runner (4)

One function that owns a transaction for one household and one Item:

1. open a transaction, `set_config` the household (required by migration 0026)
2. read both cursors from `plaid_items`
3. decrypt the access token
4. `runTransactionsSync`, with `persistInFlight` writing to `plaid_items`
5. apply added, modified and removed
6. `onSyncComplete`, `markFirstSyncCompleted`, and the outbox signal if
   `didChange`

**Everything in that list already exists except steps 4's persistence, 5, and the
function itself.**

---

## 3. The gate

**No new mechanism.** `/plaid/exchange` requires a session since #112, and auth is
production-only by the 19 Aug ruling, so the page works only in production, signed
in as Guy. **Two gates where one is real is how a gate stops being read**, so no
debug token here.

**Prerequisite:** Guy's auth user needs a `members` row, or `auth_household_id`
returns null and the endpoint answers 403 `no_household`, which reads as a broken
gate rather than a missing row.

---

## 4. The account list, and what it deliberately is not

`GET /plaid/accounts` returns what is already connected for the session's
household: institution, name, mask, type. **The list, not the heuristic**
(Guy, 19 Aug 2026).

**Mask-plus-type-plus-institution matching stays owed to M8.** A throwaway page
implementing it badly is worse than one that shows the list and lets a person
decide, and case 2's rule is that it TELLS rather than drops.

---

## 5. Acceptance criteria, and one of them is not a code change

- a real institution connects end to end, from the page, with a real access token
  encrypted at rest
- a sync writes real transactions into `transactions`
- **A PENDING TRANSACTION IS OBSERVED SETTLING TO POSTED IN REAL DATA.** Not
  inferred from a successful connect. Plaid publishes no institution-level
  capability field, and **Capital One and USAA do not provide pending data at
  all**, so at least one connected institution must be neither.
- **the observed backfill depth is recorded per institution**, because the specs
  assume a uniform 24 months and Capital One provides 90 days. The engines'
  response to that is a separate ruling and this task only produces the numbers.

---

## 6. What this plan does not do

- **No webhook receiver.** 4.5's other half, and syncs are manual until it lands.
- **No categorization.** M5's, and this produces the rows it will read.
- **No accordion, no progressive rendering, no reauth surface.** M8's.
- **No scheduling.** Cron and queue wiring are later M4; a hand-run sync is
  sufficient to produce a ledger and is honest about being temporary.
