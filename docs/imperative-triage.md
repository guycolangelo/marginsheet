# Imperative claims: triage
## 18 August 2026. A routing document. No work was done from it.

Splits the survey in `docs/imperative-inventory.md` by **module built or unbuilt**, so the backlog becomes a short now-list plus acceptance criteria that land where they are cheapest.

---

## 0. The expectation was that most dangerous claims sit in unbuilt modules. They do not.

| | Survey (126, broad filter) | Ratchet (16, precise filter) |
|---|---|---|
| **Built modules** | 119 | 13 |
| **Unbuilt modules** | 7 | 3 |

**The unbuilt population is small because unbuilt modules have almost no code to comment.** `services/conversation` is a health endpoint. `prompts/` is a `.gitkeep`. There is nothing there to over-claim about yet.

The claims that DO belong to unbuilt behaviour are concentrated in one file, `packages/fact-packages/src/classes.ts`, because M2 wrote the contract for messages M10 to M13 will compose. **That file is built; the thing it describes is not.** Triage by file path gets this wrong, which is why the seven below were classified by what the claim is ABOUT rather than where it lives.

---

## 1. Unbuilt: becomes acceptance criteria, owed to the module

Seven claims, all compose-time obligations with no composer to bind them. **Enforcing these now would be premature and would be rewritten anyway.**

| Claim | Owed to |
|---|---|
| `classes.ts:1` "if a fact is not in the block, the message cannot say it" | M10, the composer's boundary |
| `classes.ts:102` herald keys are a subset of close keys | **now carried by the type system**, closed |
| `classes.ts:176` `first_flag` false selects the follow-up register | M10 (the banned list half is already enforced by `no-nagging`) |
| `classes.ts:211` `ledgers_diverge` forces the two-ledger shape | **now enforced**, `forcing-fields.test.ts` |
| `classes.ts:229` `verdict_changed` obligates naming the flip | M13, mistake doctrine |
| `classes.ts:269` `boundary_line` forces the bank-authority sentence | M13 (the flag itself is type-carried) |
| `conversation/src/index.ts:33` health reports both halves | M10 |

**Three of the seven were closed today** rather than deferred, because the enforcement existed or the type system could carry it.

---

## 2. Built: the now-list, and it is 13 not 119

The survey's 119 in built modules is not a work list. **Most of it is explanation**, which the inventory says plainly and which is why the ratchet uses a stricter filter.

The actionable set is the ratchet's baseline, `config/mechanism-claim-baseline.json`, at **16 entries, 13 of them in built modules**:

| File | Count | Character |
|---|---|---|
| `services/api/src/{tokens,phone-change,sensitive-actions,invitation-routes}.ts` | 4 | M3 auth claims |
| `services/sync/src/{outbox,reconnect,sync-state}.ts` | 3 | M4 claims, written this week |
| `packages/schema/migrations/002{2,4}*.sql` | 4 | claims whose DDL is directly below them |
| `packages/fact-packages/src/{classes,internal}.ts` | 3 | contract claims |
| `services/api/vitest.config.ts` | 1 | the suite-duration budget |
| `packages/fact-packages/src/classes.ts` | 1 | (also in the unbuilt list) |

**The migration four are probably false positives.** A comment above a `CHECK` constraint asserting what the constraint does is backed by the constraint on the next line; the detector only reads the comment. Checking those four is the cheapest possible first pass and would likely cut the list by a quarter.

---

## 3. What this document deliberately does not do

**It does not rank by severity.** Severity is a property of consequence, and the consequence of most of these is nothing, because the claim is true and merely unproven. The two that were false were found by hand, not by ranking.

**It does not schedule the 119.** They are a survey result, not a backlog. The population is useful for sampling and the sample is next session's job.

**It assumes the rate is unknown.** Two-for-two on suspected cases is not a rate. Until the random sample of twenty is drawn, **nothing here should be read as an estimate of how much is decoration.**
