# M3 Task 3.4, Recent-Auth Re-Challenge
## Drafted for Guy's approval, 17 August 2026. Nothing executes until approved.
## Governing docs: CLAUDE.md, identity-onboarding-spec §1 (sessions) and §1's 15 Aug tightening, migration 0001's `members.phone` rule 1.

---

## 0. The mechanism, verified before it was designed around

§1: *"Sensitive actions (phone change, cancellation, member removal, export) require recent-auth re-challenge (10-minute window)."*

`withinRecentAuthWindow()` already exists from 3.3, tested and wired to nothing. This task wires it. Two things had to be true first, and both were checked rather than assumed.

### `session.created_at` survives the rolling refresh

The session is 30-day rolling with `updateAge` of one day, so a household who visits weekly has a session that keeps extending. **If the refresh reset `created_at`, recent-auth would be permanently satisfied for every active session and the control would be decorative.** That is the exact failure shape of this week, so I read the source rather than trusting the field name.

`better-auth/dist/api/routes/session.mjs` refreshes with:

```js
await ctx.context.internalAdapter.updateSession(session.session.token, {
  expiresAt: getDate(...),
  updatedAt: new Date(),
});
```

`createdAt` is not in that object, and no new row is created. So `created_at` is a stable record of **when authentication happened**, which is what recent-auth needs, and `updated_at` records activity, which is not.

**It still gets a test.** A source read is evidence about today's version; a test is evidence about the version that ships. The headline control below is a session that has been rolling-refreshed for 29 days and must still be **stale**.

### Re-authentication means a new session, so no new column

3.1a proved a passkey login issues a fresh session with `auth_method = passkey`. So the re-challenge is an ordinary sign-in, and its freshness is the new session's `created_at`. No `last_authenticated_at` field, no second timestamp to keep honest, and nothing that has to be updated by every future auth path.

---

## 1. The two conditions, kept separate

A phone change must satisfy **both**, and they are different questions:

| Condition | Source | Question |
|---|---|---|
| Fresh | `session.created_at` | *when* did they authenticate |
| Right credential class | `session.auth_method` | *how* did they authenticate |

3.2b built the second. This builds the first. **They are not combined into one predicate**, because a single "is this session good enough" function would make the two reasons indistinguishable in a refusal, and the household needs to know which one to fix: re-authenticate, or register a passkey. Those are different actions.

The refusal carries a machine-readable reason so M8 can prompt correctly. `stale` means "sign in again"; `passkey_required` means "you need a passkey for this". A single 403 with one message would tell a household to do the wrong thing half the time.

---

## 2. Enforcement is an enumeration, not a habit

The spec names **four** sensitive actions. Only one exists:

| Action | Exists today | Guarded by this task |
|---|---|---|
| Phone change | yes, `POST /auth/phone` | yes |
| Cancellation | no, M7 | listed and owed |
| Member removal | no, 3.5 or M8 | listed and owed |
| Export | no, M8 | listed and owed |

**The list lives in code, not in a comment.** `SENSITIVE_ACTIONS` enumerates all four with their route and their built/unbuilt state, and a static test asserts:

- every action marked built has the guard on its route
- an action marked unbuilt has **no** route, so it cannot ship unguarded while still reading as owed
- no route matching a sensitive path exists outside the list

That third assertion is the one that matters in six months. This week produced two instances of the same failure: a control with no caller, and a control whose caller was never built. The list is what makes "sensitive action added without recent-auth" a red build instead of a discovery.

The three unbuilt entries follow the token matrix's pattern: **explicitly empty with a reason, never absent.** An enumeration that silently omits what has not been built is how three unguarded endpoints arrive later.

---

## 3. The controls, each attempting the violation

| Attempt | Required result |
|---|---|
| Phone change on a session older than 10 minutes | refused, reason `stale`, **row unchanged** |
| Phone change on a session created a minute ago | succeeds |
| **A 29-day-old session that Better Auth has rolling-refreshed** | **refused.** The headline control: if the refresh freshened `created_at`, this passes and recent-auth is decorative |
| A session whose `created_at` is in the future | refused. Clock skew or a forged value must not read as "just now" |
| A session with no readable `created_at` | refused. Unknown resolves downward, same rule as `auth_method` |
| Stale session **and** wrong credential class | refused, and the reason names one of them rather than a generic failure |
| Fresh session, no passkey registered, magic link | **succeeds.** The case you named as the one that matters, still true after this task |
| Re-authenticate, then retry the same change | succeeds, proving the re-challenge is a way through rather than a wall |
| **Static: a sensitive route without the guard** | the test names the file and fails |

The eighth row is what makes this a re-challenge rather than a lockout. A control that refuses correctly and offers no path forward is a household who cannot change their phone number, ever.

---

## 4. What this closes and what it opens

**Closes:**
- `recent-auth-unwired`, the open item raised in 3.3 with 3.4 as owner.
- Rule 1 of migration 0001, fully. Both halves enforced: the credential class since 3.2b, the window here. The column comment's "PARTIALLY ENFORCED as of 0020" note becomes wrong and is corrected by a new migration, append-only.

**Opens nothing new**, deliberately. The three unbuilt sensitive actions are recorded in the enumeration and on the open-items list with their owning module, so they arrive guarded or they do not arrive.

---

## 5. Sub-tasks

- **3.4.1** Wire `withinRecentAuthWindow()` to the phone-change endpoint, reading `session.created_at`.
- **3.4.2** `SENSITIVE_ACTIONS` and the static test over routes.
- **3.4.3** The refusal reasons, kept distinct so M8 can prompt correctly.
- **3.4.4** The rolling-refresh control, which is the one this task exists to be trusted on.
- **3.4.5** Migration correcting rule 1's "partially enforced" note.

## 6. The verification test, applied

The rolling-refresh control is the one to judge this by. Every other assertion here fails when the code is wrong. That one fails when the code is right and the *framework* changed underneath it, which is the only way this control dies quietly.
