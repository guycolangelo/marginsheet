# Imperative claims: triage
## 18 August 2026. A routing document. No work was done from it.

Splits the survey in `docs/imperative-inventory.md` by **module built or unbuilt**, so the backlog becomes a short now-list plus acceptance criteria that land where they are cheapest.

---

## 0. The axis: can this be checked today, yes or no

**Not built module versus unbuilt module.** That was a proxy for the real question and it fails on the file that matters most: `packages/fact-packages/src/classes.ts` is built, and what it describes is composed by M10 to M13, which do not exist. Triaging by file path put 119 of 126 in "built" and answered the wrong question.

**The axis is the SUBJECT of the claim, not its location.**

| Answer | Action |
|---|---|
| **Yes, checkable today** | check it now: enforce, or downgrade to description |
| **No** | it becomes an acceptance criterion for whichever module makes it checkable |

**Default to closing. Defer only when the thing genuinely does not exist yet.** Of the seven claims about unbuilt behaviour, three were closed on 18 Aug rather than deferred: two because the enforcement already existed, one because a type could carry it. Deferring those would have been filing work that was already possible.

### What the two populations are, and why they must not merge

| | Population | Filter | Purpose |
|---|---|---|---|
| **The survey** | 126 | broad | measured by the random sample of twenty |
| **The ratchet** | 12 | strict | cleaned by hand; may only shrink |

**Two numbers, two purposes.** The random twenty measures the survey. Hand-checks clean the baseline. Conflating them produces a third number that means nothing.

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

## 2. Checkable today: the now-list, and it is 12 not 119

The survey's 119 in built modules is **not a work list**. Most of it is explanation, which the inventory says plainly and which is why the ratchet uses a stricter filter.

The actionable set is `config/mechanism-claim-baseline.json`, now at **12**.

**It was 16. The prediction that four were false positives was tested and was exactly right.** All four were SQL comments sitting directly above the DDL that enforces them: 0022 argues for a constraint and the `CHECK` is sixteen lines below, already carried in the control register. The detector was reading the comment and stopping at the blank line.

**The detector was fixed rather than the comments.** Requiring "Enforced by the `CHECK` constraint below" would ask an author to describe what is visible one line down, which is the ceremony that makes a rule feel like an obstacle.

| File | Count |
|---|---|
| `services/api/src/{tokens,phone-change,sensitive-actions,invitation-routes}.ts` | 4 |
| `services/sync/src/{outbox,reconnect,sync-state}.ts` | 3 |
| `packages/fact-packages/src/{classes,internal}.ts` | 4 |
| `services/api/vitest.config.ts` | 1 |

## 3. What this document deliberately does not do

**It does not rank by severity.** Severity is a property of consequence, and the consequence of most of these is nothing, because the claim is true and merely unproven. The two that were false were found by hand, not by ranking.

**It does not schedule the 119.** They are a survey result, not a backlog. The population is useful for sampling and the sample is next session's job.

**It assumes the rate is unknown.** Two-for-two on suspected cases is not a rate. Until the random sample of twenty is drawn, **nothing here should be read as an estimate of how much is decoration.**
