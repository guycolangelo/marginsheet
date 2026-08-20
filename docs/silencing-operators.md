# Silencing operators: the audited baseline

**Swept 19 August 2026.** Four operators that can turn a control into
documentation, across every file in `.github/` and `scripts/`.

**Why this file exists rather than only a report.** The sweep found sixteen sites
and one defect. The other fifteen are correct, and **a list of correct
suppressions with their reasons is a stronger artifact than zero hits would have
been**: the next person running this sweep starts from a known baseline instead
of sixteen unknowns, and can tell a deliberate suppression from an unexamined one
without re-deriving all of them (Guy, 19 Aug 2026).

**The question for every site is the same one this codebase asks of every
control:** if the thing this guards failed, would anything go red?

---

## The patterns

| Operator | What it hides |
|---|---|
| `\|\| true` | A non-zero exit, entirely |
| `2>/dev/null` | The error text, leaving only the status |
| `set +e`, or `set -e` absent | Every failure after that point |
| A report chained after a fallible operation with `;` | The failure, behind a success message |
| A parser reading a failed command's output | The failure, behind a value |

**The fourth's tell is the hardest to grep for and the easiest to miss reading:
the success message is a separate statement from the thing it describes.** A
fifth relative, added the same day: **a command whose scope is wider than the
intent, with nothing narrating the difference.** `git checkout -- <file>` reverts
everything uncommitted in that file, not the one edit in mind, and succeeds
silently either way.

---

## The finding

**`ci.yml:392` and `planted-failures.yml:78`**, scratch branch deletion, fixed in
this change.

```yaml
run: scripts/neon-pr-branch.sh delete 98${{ github.run_number }} || true
```

`neon-pr-branch.sh` **already tolerates an absent branch internally**, with its
own guarded delete and a comment saying so. The outer `|| true` was therefore
absorbing only UNEXPECTED failures, which are the only kind that matters. A
failed delete is a leak, and a leak that reports success is how the Neon branch
ceiling arrived unannounced on 19 August with nothing red anywhere.

**It is also a meta-finding.** When `neon-pr-cleanup`'s `|| true` was removed
earlier the same day, the fix landed where the defect was NOTICED and left the
identical defect in two other places. See the rule in CLAUDE.md.

---

## A fifth pattern, added 20 August 2026: a failed command's output parsed as data

**This is past the report-after-a-fallible-operation shape.** Nothing claimed
success. The reader simply never asked whether the command ran.

The instance: a loop passed `--env production` to `scripts/wrangler` as a single
quoted argument, so wrangler answered `Unknown argument: env production` and
exited non-zero. The output was piped into a parser that could not read it, and
the parser printed **`unparsed`** and carried on. Read literally, the result was
"production holds no Plaid secrets and dev holds a pair" — which would have been
reported as credentials written to the wrong environment, from a command that
never executed.

**The tell is in the parser rather than in the command.** A parser that handles
unexpected output by DESCRIBING it, with a label like `unparsed` or `unknown` or
an empty default, converts a failure into a value. Nothing is silenced and
nothing lies; the failure simply arrives in the shape of an answer, and every
check downstream treats it as one.

**What to look for:** any place that parses the output of a command whose exit
status it did not check. The question is not "does this handle bad input" but
**"can this tell a failed command from an empty result?"** If the answer is no,
the parser will eventually report an absence that is really an error, and an
absence is exactly the shape that reads as a finding.

**The remedy is not a better parser.** It is checking the exit status before
parsing at all, and treating a non-zero exit as a refusal to answer rather than
as an answer of "nothing".

---

## The audited baseline: fifteen sites that are correct

Each is listed with the reason it is right, so a future sweep can skip it or
challenge it deliberately.

### `|| true`

| Site | Why it is correct |
|---|---|
| `scripts/neon-pr-branch.sh:36` | Deleting a branch that does not exist is the expected case, on the create path, and the comment above it says so |
| `check-migrations-append-only.sh:25` | `git fetch` failing offline is expected; the check proceeds against the refs it already has |
| `check-migrations-append-only.sh:57` | `grep` returning non-zero **is the answer**: zero `.sql` files matched |
| `check-migrations-append-only.sh:74` | Same, for the count |
| `ci.yml:321` | `comm` exits non-zero on an empty intersection, which is the ordinary "no registered tests touched" case |
| `verify-decoupling-probe.sh:83` | Suppresses a parse failure on a body the script then reports as unparseable |

### `2>/dev/null`

| Site | Why it is correct |
|---|---|
| `check-migrations-append-only.sh:38` | `git cat-file -e` returning non-zero means the file has no base version, which is a new migration and the answer rather than an error |
| `verify-deploy.sh:78` | Falls back to `""`, and the caller **asserts on the result** |
| `verify-deploy.sh:119` | Falls back to `UNREADABLE`, which is printed and asserted on |
| `verify-deploy.sh:197` | Same |
| `ci.yml:336` | Explicitly guarded with `if`, carrying a comment recording that this exact line once took the whole step down under `set -e` |

### `set -e`

| Site | Why it is correct |
|---|---|
| `wrangler`, `put-app-db-url.sh`, `check-migrations-append-only.sh`, `verify-deploy.sh`, `neon-pr-branch.sh` | `set -eu` or `set -euo pipefail` present |
| `verify-decoupling-probe.sh` | `set -uo pipefail` **without `-e`, deliberately.** Every result is checked explicitly with `\|\| fail "…"`, and each message states whether an SMS was sent. Explicit checking is stronger than `-e`, not weaker, and this script sends real messages with live production credentials |

### Reports chained after fallible operations

**None in the repository.** Both instances found on 19 August were in interactive
shell commands rather than committed scripts.

---

## Re-running this

```
git grep -n "|| true" -- .github scripts
git grep -n "2>/dev/null\|2> /dev/null" -- .github scripts
git grep -n "set +e\|^set -" -- .github scripts
```

The fourth pattern has no reliable grep. It is found by reading a step and asking
whether its success message could print when the operation before it failed.


## `catch(() => ({}))` on a response body, 20 Aug 2026

**Not a suppression that was examined and kept. A defect, found by using it.**

`services/api/src/connect-page.ts` read every response with
`await res.json().catch(() => ({}))`. When a body was not JSON, the page
substituted an empty object and printed it.

**The readout has no code path that returns an empty object.** It returns
`{ours, plaid}` or `{error, detail}`, and a household with no data yields empty
ARRAYS. So an empty object on screen could only mean "the body was not JSON",
while looking exactly like "the call succeeded and there was nothing to say".
The page that says EVERY FAILURE IS SHOWN in its own header could not show this
one.

**It sat on four call sites**, not one: the readout, the sync trigger, the link
token and the exchange. Found on the readout and swept across all four, which
is the rule about fixing the class rather than the incident.

The replacement never substitutes. On a parse failure it reports the status,
the content type and the first 2000 characters of the body, because that is
what tells a person a 404 from a 500 from an HTML error page.

**The general form, worth keeping when this page is deleted:** a fallback value
that is indistinguishable from a legitimate result is not a fallback, it is a
second meaning silently assigned to an existing value. Ask of any default:
could the real answer have looked like this?
