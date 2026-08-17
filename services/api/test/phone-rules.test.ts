// The three phone rules, each proven by attempting the violation (3.3).
//
// Migration 0001's column comment says of the rules: "They are enforced in
// application code; this comment exists so no one reconstructs the column
// without them." A rule enforced in application code that nothing attempts to
// violate is a rule enforced nowhere.
//
// The shape claims (one write path, the gate is the column) are in
// phone-rules-static.test.ts, because behaviour tests cannot see them.
//
// Rotation-guarded and serialised with the other role-rotating files.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { canRotate, rotateAppRole, assertNotSkippedInCI } from "./helpers/app-role.js";
import { mayReachMember } from "../src/channel-gate.js";
import { RECENT_AUTH_MINUTES, withinRecentAuthWindow } from "../src/recent-auth.js";
import { confirmPhoneVerification, startPhoneVerification } from "../src/phone-verify.js";
import { RecordingOtpSender, type OtpSender } from "../src/otp.js";

const OWNER_URL = process.env.DATABASE_URL;
const configured = canRotate();

let owner: ReturnType<typeof postgres>;
let app: ReturnType<typeof postgres>;

beforeAll(async () => {
  if (!configured) return;
  owner = postgres(OWNER_URL!, { max: 1 });
  app = postgres(await rotateAppRole(owner, OWNER_URL!, "phonerules"), { max: 1 });
});

afterAll(async () => {
  if (owner) await owner.end();
  if (app) await app.end();
});

const phoneFor = () => `+1555${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;

async function member(opts: { phone?: string; verified?: boolean } = {}) {
  const [h] = await owner<{ id: string }[]>`
    insert into households (name) values ('Phone Rules') returning id
  `;
  const [m] = await owner<{ id: string }[]>`
    insert into members (household_id, first_name, role, phone, phone_verified_at)
    values (${h.id}, 'Probe', 'full_member', ${opts.phone ?? null},
            ${opts.verified ? new Date() : null})
    returning id
  `;
  return { id: m.id, household: h.id };
}

/**
 * Puts this connection in a household's context, the way a request-scoped
 * connection is put in one before it touches policied tables.
 *
 * The gate does NOT resolve the household itself, deliberately: resolving would
 * need a second SECURITY DEFINER function, which migration 0018 makes a ruling
 * rather than a detail. It runs under whatever policy context its caller has,
 * and WITH NO CONTEXT IT SEES NOTHING AND REFUSES. That is the safe direction
 * and there is a test for it below.
 */
async function useHousehold(household: string): Promise<void> {
  await app`select set_config('marginsheet.household_id', ${household}, false)`;
}

/** Leaves the connection with no household context at all. */
async function useNoHousehold(): Promise<void> {
  await app`select set_config('marginsheet.household_id', '', false)`;
}

const verifiedAt = async (id: string) =>
  (await owner<{ v: Date | null }[]>`select phone_verified_at as v from members where id = ${id}`)[0]?.v;

const phoneOf = async (id: string) =>
  (await owner<{ p: string | null }[]>`select phone as p from members where id = ${id}`)[0]?.p;

it("is actually running, and did not skip itself in CI", () => {
  assertNotSkippedInCI(expect, "the phone-rules suite");
});

describe.skipIf(!configured)("RULE 3: phone_verified_at gates channel access", () => {
  it("REFUSES a member with an unverified number, though they HAVE a number", async () => {
    // The whole rule in one case. Checking for a number would pass here.
    const m = await member({ phone: phoneFor(), verified: false });
    await useHousehold(m.household);
    expect(await mayReachMember(app, m.id)).toEqual({
      mayReach: false,
      reason: "phone_unverified",
    });
  });

  it("ALLOWS a verified member, so the gate is not simply shut", async () => {
    const m = await member({ phone: phoneFor(), verified: true });
    await useHousehold(m.household);
    expect(await mayReachMember(app, m.id)).toEqual({
      mayReach: true,
    });
  });

  it("REFUSES a member with no number at all", async () => {
    const m = await member();
    await useHousehold(m.household);
    expect((await mayReachMember(app, m.id)).mayReach).toBe(false);
  });

  it("RE-CLOSES after a phone change, which is the case a cache breaks", async () => {
    const m = await member({ phone: phoneFor(), verified: true });
    await useHousehold(m.household);
    expect((await mayReachMember(app, m.id)).mayReach).toBe(true);

    // A change clears the column, per 0001. Until this task that behaviour was
    // accident rather than control: nothing asserted it.
    await owner`update members set phone = ${phoneFor()}, phone_verified_at = null where id = ${m.id}`;

    expect(
      await mayReachMember(app, m.id),
      "the gate stayed open after the number changed, so a new unverified number inherits the old one's trust"
    ).toEqual({ mayReach: false, reason: "phone_unverified" });
  });

  it("REFUSES with NO household context at all, which is the fail-closed case", async () => {
    // The gate runs under its caller's policy context and does not resolve one
    // itself, because that would need a second SECURITY DEFINER function and
    // 0018 makes adding one a ruling. So a caller who forgot to establish
    // context sees nothing and is refused, rather than seeing everything.
    const m = await member({ phone: phoneFor(), verified: true });
    await useHousehold(m.household);
    expect((await mayReachMember(app, m.id)).mayReach).toBe(true);

    await useNoHousehold();
    expect(
      await mayReachMember(app, m.id),
      "the gate answered without a household context, so a caller who forgot to scope gets a verdict it has no basis for"
    ).toEqual({ mayReach: false, reason: "no_member" });
  });

  it("REFUSES a removed member even when their number is verified", async () => {
    const m = await member({ phone: phoneFor(), verified: true });
    await useHousehold(m.household);
    await owner`update members set status = 'removed' where id = ${m.id}`;
    expect((await mayReachMember(app, m.id)).mayReach).toBe(false);
  });
});

describe.skipIf(!configured)("RULE 2: one verified phone, globally", () => {
  it("REFUSES a number verified in ANOTHER household, at confirm time", async () => {
    // WHERE THIS IS ENFORCED, and why it is not caught earlier.
    //
    // Rule 2 is GLOBAL, and `members` carries household_isolation, so the
    // pre-check inside startPhoneVerification runs in the newcomer's household
    // and literally cannot see the holder's row. A pre-check is blind to
    // exactly the case the rule is about.
    //
    // members_verified_phone_unique is an index and sees every household, so the
    // CONSTRAINT is the enforcement and the code supplies the honesty by
    // translating the violation. The cost, accepted: the household receives a
    // code before learning the number is taken. The alternative was a second
    // SECURITY DEFINER function, which 0018 makes a ruling, and it is not
    // needed because the constraint already sees everything.
    const shared = phoneFor();
    await member({ phone: shared, verified: true });

    const newcomer = await member();
    await useHousehold(newcomer.household);
    const otp = new RecordingOtpSender();

    // The send goes through: nothing visible from here says otherwise.
    expect((await startPhoneVerification(app, otp, newcomer.id, shared)).status).toBe("sent");

    // Confirm is where rule 2 bites, and it must be honest rather than a 500.
    const result = await confirmPhoneVerification(app, otp, newcomer.id, otp.codeFor(shared)!);

    expect(result.status).toBe("refused");
    if (result.status === "refused") {
      expect(result.reason).toBe("already_verified_elsewhere");
      expect(result.message).toMatch(/support/i);
    }
  });

  it("REFUSES at START when the holder is visible, so no code is sent", async () => {
    // The same-household case, where the pre-check CAN see the collision. Worth
    // having: it is a better experience when it applies, and it proves the
    // pre-check is not dead code.
    const shared = phoneFor();
    const holder = await member({ phone: shared, verified: true });
    const [sibling] = await owner<{ id: string }[]>`
      insert into members (household_id, first_name, role)
      values (${holder.household}, 'Sibling', 'full_member') returning id
    `;
    await useHousehold(holder.household);

    let sent = false;
    const watcher: OtpSender = {
      async send() {
        sent = true;
      },
      async check() {
        return false;
      },
    };

    const result = await startPhoneVerification(app, watcher, sibling.id, shared);
    expect(result.status).toBe("refused");
    expect(sent, "a code was sent for a number the member cannot keep").toBe(false);
  });

  it("NEVER silently reassigns the number away from the verified holder", async () => {
    // 0001: "never silently reassigned". The newcomer may hold the number
    // UNVERIFIED, which the partial index permits, but the holder's
    // verification is untouched and the newcomer never becomes verified.
    const shared = phoneFor();
    const holder = await member({ phone: shared, verified: true });

    const newcomer = await member();
    await useHousehold(newcomer.household);
    const otp = new RecordingOtpSender();
    await startPhoneVerification(app, otp, newcomer.id, shared);
    await confirmPhoneVerification(app, otp, newcomer.id, otp.codeFor(shared)!);

    expect(await phoneOf(holder.id), "the number moved").toBe(shared);
    expect(await verifiedAt(holder.id), "the holder lost their verification").toBeTruthy();
    expect(
      await verifiedAt(newcomer.id),
      "the newcomer ended up verified on somebody else's number"
    ).toBeNull();
  });

  it("ALLOWS a number another member holds UNVERIFIED, which is the typo case", async () => {
    // 0001 permits unverified duplicates on purpose. Refusing them would lock a
    // household out over somebody else's typo.
    const shared = phoneFor();
    await member({ phone: shared, verified: false });
    const newcomer = await member();
    await useHousehold(newcomer.household);

    const result = await startPhoneVerification(app, new RecordingOtpSender(), newcomer.id, shared);

    expect(
      result.status,
      "an unverified duplicate was refused, which locks a household out over a stranger's typo"
    ).toBe("sent");
  });

  it("re-checks at CONFIRM time, so uniqueness has no window", async () => {
    // Between the send and the check, somebody else may verify the number. A
    // uniqueness rule enforced only on the way in has a window.
    const shared = phoneFor();
    const racer = await member();
    await useHousehold(racer.household);
    const otp = new RecordingOtpSender();
    expect((await startPhoneVerification(app, otp, racer.id, shared)).status).toBe("sent");

    // Somebody else verifies it first.
    await member({ phone: shared, verified: true });

    const result = await confirmPhoneVerification(app, otp, racer.id, otp.codeFor(shared)!);
    expect(result.status).toBe("refused");
    expect(await verifiedAt(racer.id), "the racer was verified into a collision").toBeNull();
  });
});

describe.skipIf(!configured)("verification opens the gate, and only an approval does", () => {
  it("a correct code verifies, and the gate opens", async () => {
    const id = await member();
    await useHousehold(id.household);
    const otp = new RecordingOtpSender();
    const phone = phoneFor();

    expect((await startPhoneVerification(app, otp, id.id, phone)).status).toBe("sent");
    // Sent is not verified. The gate is still shut.
    expect((await mayReachMember(app, id.id)).mayReach).toBe(false);

    expect((await confirmPhoneVerification(app, otp, id.id, otp.codeFor(phone)!)).status).toBe(
      "verified"
    );
    expect((await mayReachMember(app, id.id)).mayReach).toBe(true);
  });

  it("a WRONG code does not verify, and the gate stays shut", async () => {
    const id = await member();
    await useHousehold(id.household);
    const otp = new RecordingOtpSender();
    await startPhoneVerification(app, otp, id.id, phoneFor());

    const result = await confirmPhoneVerification(app, otp, id.id, "000000");
    expect(result.status).toBe("refused");
    expect(await verifiedAt(id.id)).toBeNull();
    expect((await mayReachMember(app, id.id)).mayReach).toBe(false);
  });

  it("REFUSES a code when no number is pending", async () => {
    const id = await member();
    await useHousehold(id.household);
    expect((await confirmPhoneVerification(app, new RecordingOtpSender(), id.id, "123456")).status).toBe(
      "refused"
    );
  });
});

describe.skipIf(!configured)("the Twilio refusal path, which outlives the trial", () => {
  /** A sender that refuses, the way Twilio refuses a non-allowlisted number. */
  const refusing: OtpSender = {
    async send() {
      throw new Error("Twilio Verify rejected the send: HTTP 400 (code 60200)");
    },
    async check() {
      return false;
    },
  };

  /** A sender that never answers, the way a network stall never answers. */
  const hanging: OtpSender = {
    send: () => new Promise(() => {}),
    check: async () => false,
  };

  it("a refused number produces an honest message NAMING the number", async () => {
    const id = await member();
    await useHousehold(id.household);
    const result = await startPhoneVerification(app, refusing, id.id, phoneFor());

    expect(result.status).toBe("refused");
    if (result.status === "refused") {
      expect(result.reason).toBe("unreachable_number");
      // "We cannot text that number" invites correcting it. "Something went
      // wrong" invites nothing.
      expect(result.message).toMatch(/number/i);
      expect(result.message).not.toMatch(/something went wrong|unexpected error/i);
    }
  });

  it("a refused number leaves the gate shut and nothing looking verified", async () => {
    const id = await member();
    await useHousehold(id.household);
    await startPhoneVerification(app, refusing, id.id, phoneFor());
    expect(await verifiedAt(id.id)).toBeNull();
    expect((await mayReachMember(app, id.id)).mayReach).toBe(false);
  });

  it("a hanging provider TIMES OUT into a refusal rather than hanging", async () => {
    // The forbidden outcome is a request that never returns. A timeout is a
    // refusal the household can act on.
    const id = await member();
    await useHousehold(id.household);
    const started = Date.now();
    const result = await startPhoneVerification(app, hanging, id.id, phoneFor());
    const elapsed = Date.now() - started;

    expect(result.status).toBe("refused");
    if (result.status === "refused") expect(result.reason).toBe("provider_unavailable");
    expect(elapsed, "the send did not return within its own timeout").toBeLessThan(20_000);
  }, 30_000);

  it("a timeout and a bad number are DISTINGUISHABLE, because the fixes differ", async () => {
    // One is ours to chase; the other is the number. Collapsing them into one
    // message is how a household is told to fix something that is not theirs.
    const a = await startPhoneVerification(app, refusing, (await member()).id, phoneFor());
    const b = await startPhoneVerification(app, hanging, (await member()).id, phoneFor());
    expect(a.status === "refused" && b.status === "refused" && a.reason !== b.reason).toBe(true);
  }, 30_000);

  it("an invalid number is refused before any provider is called", async () => {
    let called = false;
    const watcher: OtpSender = {
      async send() {
        called = true;
      },
      async check() {
        return false;
      },
    };
    const result = await startPhoneVerification(app, watcher, (await member()).id, "not-a-number");
    expect(result.status).toBe("refused");
    expect(called, "a malformed number was sent to Twilio").toBe(false);
  });
});

describe("RULE 1's second half: the recent-auth window, tested but unwired", () => {
  // No database needed. The decision table is provable as pure logic, and this
  // suite is honest that it proves the table rather than enforcement: nothing
  // in src/ calls this yet. 3.4 wires it, and it is on the open-items list.
  const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);

  it("a session established just now is fresh", () => {
    expect(withinRecentAuthWindow({ sessionCreatedAt: at(0) })).toEqual({ fresh: true });
  });

  it(`a session older than ${RECENT_AUTH_MINUTES} minutes is stale`, () => {
    expect(withinRecentAuthWindow({ sessionCreatedAt: at(RECENT_AUTH_MINUTES + 1) })).toEqual({
      fresh: false,
      reason: "stale",
    });
  });

  it("the boundary is inclusive of the window and exclusive past it", () => {
    expect(withinRecentAuthWindow({ sessionCreatedAt: at(RECENT_AUTH_MINUTES - 0.1) }).fresh).toBe(
      true
    );
    expect(withinRecentAuthWindow({ sessionCreatedAt: at(RECENT_AUTH_MINUTES + 0.1) }).fresh).toBe(
      false
    );
  });

  it("an ABSENT timestamp is stale, never fresh", () => {
    // Unknown resolves downward, the same rule as isPasskeySession treating
    // null as the weakest class. Defaulting the other way would mean any
    // session whose provenance could not be read satisfied the window.
    expect(withinRecentAuthWindow({ sessionCreatedAt: null })).toEqual({
      fresh: false,
      reason: "no_session",
    });
    expect(withinRecentAuthWindow({ sessionCreatedAt: undefined }).fresh).toBe(false);
  });

  it("a FUTURE timestamp is stale, not fresh", () => {
    // Clock skew or a forged value. "Created in the future" must not read as
    // "created just now".
    expect(
      withinRecentAuthWindow({ sessionCreatedAt: new Date(Date.now() + 60_000) })
    ).toEqual({ fresh: false, reason: "stale" });
  });
});
