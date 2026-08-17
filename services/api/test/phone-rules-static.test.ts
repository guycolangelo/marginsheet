// The three phone rules, enforced STATICALLY over the source (M3 task 3.3).
//
// WHY A STATIC TEST AT ALL, when everything else in this repo attempts the
// forbidden operation. Two of the three rules are claims about the SHAPE of the
// codebase rather than about behaviour, and behaviour tests cannot see them:
//
//   Rule 1 is "there is ONE write path". A behaviour test can prove the path it
//   knows about is careful. It cannot notice a second path added in M13 by
//   somebody who never read migration 0001, which is precisely what that
//   comment warns about.
//
//   Rule 3 is "every send path checks phone_verified_at, NOT the presence of a
//   phone number". Checking for a number passes every functional test, because
//   a member with an unverified number does have a number. This is the failure
//   mode that ships: plausible and wrong.
//
// So these read the source. They are deliberately narrow and deliberately
// noisy: a false positive costs somebody a comment, and a false negative costs
// the SIM-swap defence.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dirname, "..", "src");

function sources(): { file: string; text: string }[] {
  return readdirSync(SRC)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => ({ file: f, text: readFileSync(join(SRC, f), "utf8") }));
}

/** Strips comments, so prose about a rule is never mistaken for breaking it. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
}

describe("RULE 1: there is exactly one write path to members.phone", () => {
  it("only the phone-change handler and verification start write the column", () => {
    // Two writers, and both are named. The verification flow writes the number
    // while leaving it unverified; the change endpoint writes it behind the §1
    // credential-class check. Anything else is a channel write path.
    const ALLOWED = new Set(["phone-change.ts", "phone-verify.ts"]);

    const writers = sources()
      .filter(({ text }) => /update\s+members[\s\S]{0,400}?\bset\b[\s\S]{0,200}?\bphone\s*=/i.test(code(text)))
      .map(({ file }) => file)
      .sort();

    expect(
      writers.filter((f) => !ALLOWED.has(f)),
      "a new write path to members.phone exists. Migration 0001 rule 1: phone changes are in-app only, and anyone adding a write path outside that flow is removing the SIM-swap defence."
    ).toEqual([]);

    // And the allowed writers still exist, so this cannot pass by the column
    // having no writers at all.
    expect(writers.length, "no module writes members.phone, so rule 1 is vacuous").toBeGreaterThan(0);
  });

  it("nothing writes phone_verified_at except verification and the change that clears it", () => {
    const ALLOWED = new Set(["phone-verify.ts", "phone-change.ts"]);

    const writers = sources()
      .filter(({ text }) => /\bphone_verified_at\s*=/i.test(code(text)))
      .map(({ file }) => file)
      .sort();

    expect(
      writers.filter((f) => !ALLOWED.has(f)),
      "something other than verification writes phone_verified_at. That column is the gate on every household-facing channel message, and a second writer can open it without anybody proving they hold the number."
    ).toEqual([]);
    expect(writers.length).toBeGreaterThan(0);
  });
});

describe("RULE 3: the gate is the column, never the number", () => {
  it("the gate function reads phone_verified_at and does not return the number", () => {
    const gate = readFileSync(join(SRC, "channel-gate.ts"), "utf8");
    expect(code(gate)).toContain("phone_verified_at");
    // A gate that hands back the thing it guards invites a caller to keep the
    // number and skip the gate next time.
    expect(
      /return[^;]*\bphone\b(?!_verified)/.test(code(gate)),
      "the gate returns the phone number, which lets a caller keep it and skip the gate"
    ).toBe(false);
  });

  it("no module gates a send on the PRESENCE of a phone number", () => {
    // The plausible-and-wrong check. `if (member.phone)` before a send reads
    // correctly and is the exact bug rule 3 exists to prevent.
    const offenders: string[] = [];

    for (const { file, text } of sources()) {
      if (file === "channel-gate.ts") continue;
      const body = code(text);

      // A truthiness check on a phone field, not on the verified column.
      const suspicious = [
        /if\s*\(\s*!?\s*\w+\.phone\s*\)/,
        /if\s*\(\s*!?\s*phone\s*\)\s*\{?\s*(?!.*phone_verified_at)/,
        /\w+\.phone\s*\?\?/,
        /\w+\.phone\s*&&/,
      ].some((re) => re.test(body));

      // Only an offence in a module that can actually SEND something.
      const sends = /OtpSender|EmailSender|mail\.send|otp\.send/.test(body);

      if (suspicious && sends && !body.includes("phone_verified_at")) {
        offenders.push(file);
      }
    }

    expect(
      offenders,
      "a send path gates on whether a phone number EXISTS rather than on phone_verified_at. A member with an unverified number does have a number, so that check passes every functional test while the gate is absent."
    ).toEqual([]);
  });

  it("the negative control: this test can actually detect the wrong check", () => {
    // Without this, "no offenders" is indistinguishable from a broken scan.
    const wrong = `
      import type { OtpSender } from "./otp.js";
      export async function send(member: { phone: string | null }, otp: OtpSender) {
        if (member.phone) await otp.send(member.phone);
      }
    `;
    const suspicious = /if\s*\(\s*!?\s*\w+\.phone\s*\)/.test(code(wrong));
    const sends = /OtpSender|otp\.send/.test(code(wrong));
    expect(
      suspicious && sends && !wrong.includes("phone_verified_at"),
      "the scan cannot detect the wrong check, so its silence means nothing"
    ).toBe(true);
  });
});

describe("RULE 2: the collision refusal is not a 500", () => {
  it("verification refuses a number verified elsewhere, in code rather than by exception", () => {
    // 0001 says "rejected with support routing, never silently reassigned". A
    // Postgres unique violation is neither: it reaches the household as a 500.
    const verify = code(readFileSync(join(SRC, "phone-verify.ts"), "utf8"));
    expect(verify).toContain("already_verified_elsewhere");
    expect(verify).toContain("phone_verified_at is not null");
    // And it checks for verification by ANOTHER member rather than for any
    // duplicate, because unverified duplicates are permitted on purpose.
    expect(verify).toMatch(/id\s*<>\s*\$\{memberId\}|id <> /);
  });
});

describe("rule 1's second half is now WIRED, which inverts an earlier assertion", () => {
  it("withinRecentAuthWindow HAS a caller, and it is the phone-change handler", () => {
    // This test previously asserted the OPPOSITE: that the function had no
    // callers, precisely so 3.4 would fail here and have to come back and say
    // so. That is this visit.
    //
    // The reason it was written that way: a control that exists and is not
    // called must not be mistaken for a control that is enforced. It happened
    // twice this week, with mayChangePhone() and then with this function, and
    // both were found by trying to use them rather than by reading them.
    //
    // Enforcement is now proven behaviourally in recent-auth-wired.test.ts,
    // including against a 29-day-old rolling-refreshed session. This assertion
    // is only the wiring claim.
    const callers = sources()
      .filter(({ file }) => file !== "recent-auth.ts")
      .filter(({ text }) => code(text).includes("withinRecentAuthWindow"))
      .map(({ file }) => file);

    expect(
      callers,
      "recent-auth is no longer wired to the phone-change handler, so rule 1 is back to being half a rule"
    ).toContain("phone-change.ts");
  });
});
