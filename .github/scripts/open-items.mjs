// Prints the open items, and fails when one is not accountable.
//
// CLAUDE.md has said since M0 that "open items travel with named owners and
// print in CI". Nothing implemented it. On 16 Aug 2026 an open item needed
// recording "like the others" and there were no others: the practice was
// documented and unenforced, which is the same shape as the ci.yml comment
// warning against rotating the role on a long-lived branch, and the workflow
// header that described a required reviewer which did not exist.
//
// WHAT THIS FAILS ON, and what it deliberately does not. It does NOT fail
// because open items exist; they are legitimate and hiding them would be the
// point of the exercise inverted. It fails when an item has no owner, no thing
// it is owed to, or no date, because an item nobody owns is not tracked, it is
// merely written down. That is the difference this job exists to enforce.
//
// The output goes to the job summary so it is read without opening logs.

import { readFileSync, appendFileSync, existsSync } from "node:fs";

const PATH = "docs/open-items.json";
const REQUIRED = ["id", "item", "owner", "owed_to", "raised", "trigger_kind"];

/** TWO KINDS OF TRIGGER, ONE LIST, AND ONLY ONE OF THEM CAN BE ENFORCED
 *  (Guy, 21 Aug 2026).
 *
 *  THE VALUE IS THE SPLIT RATHER THAN THE AUTOMATION. An item whose trigger
 *  cannot be evaluated should SAY SO, so a reader knows which half of this list
 *  is watching itself and which half is waiting on a person. Left ambiguous,
 *  every trigger reads as an obligation and none of them is one.
 *
 *  WHY IT WAS BUILT. The operation deadline's trigger said "BEFORE 4.5b,
 *  because production credentials are the moment the risk becomes real". It was
 *  correct, precisely worded, named a condition rather than a module, and was
 *  printed in CI on every run. 4.5b shipped, credentials went live, five real
 *  syncs ran, and nobody re-read it. The item was right and still did not reach
 *  anyone.
 *
 *  A FUTURE MILESTONE READS AS A SCHEDULE AND A CONDITION READS AS AN
 *  OBLIGATION, AND PROSE ACCEPTS BOTH IDENTICALLY. That is why the enforceable
 *  half has to stop being prose.
 *
 *  "condition" means the repository can evaluate it, and this check FAILS when
 *  such a trigger has FIRED and the item is still open. "prose" means it is
 *  gated on Guy, on a third party, or on a ruling, and no mechanism can know:
 *  those are marked rather than left to look like the others. */
const TRIGGER_KINDS = ["condition", "prose"];

/** TWO DESIGN CHOICES, RECORDED BECAUSE THEY ARE THE MECHANISM RATHER THAN
 *  DETAILS OF IT (Guy, 21 Aug 2026).
 *
 *  PROSE IS THE DEFAULT, AND THE ASYMMETRY IS THE REASON. A prose item that
 *  should have been a condition costs a reader some knowledge: they think
 *  nothing is watching when something could have been. A condition that should
 *  have been prose costs A CHECK THAT CANNOT FIRE, which reads as watched and
 *  is not. Those are not the same mistake, so the default falls toward the
 *  cheaper one.
 *
 *  condition_why IS MANDATORY BECAUSE A TRIGGER THAT FIRES WITHOUT SAYING WHAT
 *  TO DO IS AN ALARM RATHER THAN AN OBLIGATION. "Something changed" sends the
 *  next reader to work out what they are supposed to have done; the reason
 *  tells them.
 *
 *  THREE CONDITION KINDS IS RESTRAINT, NOT A GAP. A fourth waits until an item
 *  genuinely needs one: a vocabulary that grows to fit each case stops being a
 *  vocabulary and becomes a list of special cases with a shared prefix.
 *
 *  AND TWO CONDITIONS OUT OF SIXTY-EIGHT IS THE HONEST NUMBER RATHER THAN A
 *  DISAPPOINTING ONE. Most of that list genuinely waits on Guy, on a third
 *  party, or on a ruling, and now it says so. THE VALUE WAS NEVER CONVERTING
 *  THE LIST. It was knowing which half is watching itself. */


/** WHAT THE TWO CONDITIONS IN THIS LIST ACTUALLY ARE, said precisely, because
 *  the next person writing one will otherwise copy the shape and mean something
 *  else by it.
 *
 *  Both are REGRESSION GUARDS ON A PROPERTY THAT IS ALREADY TRUE, not triggers
 *  for pending work. One item is a closed negative result and its condition
 *  fires if the property that closed it goes away. The other is open for a
 *  DIFFERENT half than its condition watches, and the condition guards the half
 *  already closed.
 *
 *  A CONDITION CAN LEGITIMATELY MEAN EITHER, and both fail the check the same
 *  way, so the distinction lives in condition_why rather than in a fourth
 *  field. What matters is that the reason says which: "this reopened" and "the
 *  thing you were waiting for has happened" send a reader to different actions.
 *
 *  The conditions a trigger may express. Deliberately few.
 *
 *  Each returns true when the trigger has FIRED, meaning the thing the item was
 *  waiting for has happened and the item should have been closed or acted on. */
const CONDITIONS = {
  /** Fires when a path stops existing, or starts existing, as declared. */
  path_exists: (c) => existsSync(c.path) !== (c.expect === false),
  /** Fires when a file stops containing the text it was relied on to contain,
   *  or starts containing text it was relied on not to. */
  file_contains: (c) => {
    if (!existsSync(c.path)) return true;
    return readFileSync(c.path, "utf8").includes(c.text) !== (c.expect !== false);
  },
  /** Fires when a control is registered, for items owed a control that does not
   *  exist yet. */
  control_exists: (c) => {
    const register = JSON.parse(readFileSync("config/control-register.json", "utf8"));
    return register.controls.some((x) => x.id === c.id) !== (c.expect === false);
  },
};

/** THE ONLY TWO OWNERS. AN ENUM, NOT A PRESENCE TEST.
 *
 *  A non-empty string check passed on `owner: "closed by ruling"`, which is a
 *  STATUS in the owner field, and on `owner: "M7, 3.5 and M8 respectively"`,
 *  which is THREE obligations pretending to be one: nobody owes it, and the
 *  check could not fail on either row.
 *
 *  An item is a thing somebody owes. A module is not somebody, so modules live
 *  in the trigger where they already belonged, and a decision belongs in the
 *  decision record rather than here. Guy, 19 Aug 2026. */
const OWNERS = ["Guy", "build"];

/** Accepts "Guy", "build", and a qualified form like
 *  "build, gated on Guy's approval of the plan", which still names one party as
 *  responsible. Rejects anything whose first word is not an owner. */
function ownerIsAPerson(value) {
  const first = String(value).trim().split(/[\s,(]/)[0];
  return OWNERS.includes(first);
}

let items;
try {
  items = JSON.parse(readFileSync(PATH, "utf8"));
} catch (error) {
  console.error(`Could not read ${PATH}: ${error.message}`);
  process.exit(1);
}

if (!Array.isArray(items)) {
  console.error(`${PATH} must be an array.`);
  process.exit(1);
}

const problems = [];
const seen = new Set();

for (const [index, entry] of items.entries()) {
  const where = entry?.id ? `"${entry.id}"` : `entry ${index}`;
  for (const field of REQUIRED) {
    const value = entry?.[field];
    if (typeof value !== "string" || value.trim() === "") {
      problems.push(`${where} is missing "${field}". An item nobody owns is not tracked.`);
    }
  }
  if (typeof entry?.trigger_kind === "string" && !TRIGGER_KINDS.includes(entry.trigger_kind)) {
    problems.push(
      `${where} has trigger_kind="${entry.trigger_kind}", which is not ${TRIGGER_KINDS.join(" or ")}. ` +
        `A trigger is either something this repository can evaluate or something only a person can notice, ` +
        `and an item that does not say which leaves a reader unable to tell whether anything is watching it.`
    );
  }

  if (entry?.trigger_kind === "condition") {
    const c = entry.condition;
    if (!c || typeof c !== "object" || !CONDITIONS[c.kind]) {
      problems.push(
        `${where} declares trigger_kind="condition" and no evaluable condition. ` +
          `Known kinds: ${Object.keys(CONDITIONS).join(", ")}. A condition nothing can evaluate is prose ` +
          `wearing a mechanism's label, which is worse than prose because it reads as watched.`
      );
    } else if (typeof entry.condition_why !== "string" || entry.condition_why.trim() === "") {
      // THE CONDITION SAYS WHAT FIRES IT. IT DOES NOT SAY WHY THAT MATTERS.
      // Without the reason, a firing check tells the next reader that something
      // changed and nothing about what they are supposed to do.
      problems.push(`${where} declares a condition and no condition_why. A check that fires without a reason is an alarm nobody can act on.`);
    } else {
      let fired;
      try {
        fired = CONDITIONS[c.kind](c);
      } catch (error) {
        problems.push(`${where} could not evaluate its condition: ${error.message}`);
        fired = false;
      }
      if (fired) {
        problems.push(
          `${where} HAS FIRED AND IS STILL OPEN.\n    ${entry.condition_why}\n    ` +
            `Close the item, or change the condition if the trigger was wrong. This is the half of the ` +
            `list that watches itself; it fired so that nobody has to notice.`
        );
      }
    }
  }

  if (typeof entry?.owner === "string" && entry.owner.trim() !== "" && !ownerIsAPerson(entry.owner)) {
    problems.push(
      `${where} has owner="${entry.owner}", which is not one of ${OWNERS.join(" or ")}. ` +
        `A module is not somebody: put it in the trigger. A status is not an owner: ` +
        `put the decision in the decision record.`
    );
  }
  if (entry?.id) {
    if (seen.has(entry.id)) problems.push(`duplicate id "${entry.id}"`);
    seen.add(entry.id);
  }
  if (typeof entry?.raised === "string" && !/^\d{4}-\d{2}-\d{2}$/.test(entry.raised)) {
    problems.push(`${where} has raised="${entry.raised}", which is not YYYY-MM-DD.`);
  }
}

const lines = [
  `## Open items (${items.length})`,
  "",
  "Carried deliberately. Each names an owner and what it is owed to.",
  "",
  "| Item | Owner | Owed to | Raised |",
  "| --- | --- | --- | --- |",
  ...items.map(
    (e) =>
      `| **${e?.id ?? "?"}**<br>${String(e?.item ?? "").replace(/\|/g, "\\|")} | ${e?.owner ?? "?"} | ${e?.owed_to ?? "?"} | ${e?.raised ?? "?"} |`
  ),
];

const report = lines.join("\n");
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
}

if (problems.length > 0) {
  console.error("\nOpen items that are not accountable:\n");
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

console.log(`\nAll ${items.length} open items name an owner and what they are owed to.`);
