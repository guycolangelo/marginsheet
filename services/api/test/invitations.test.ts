// Member invitations, as a path (M3 task 3.5, §7).
//
// THE TWO-MEMBER ASSERTION IS THE ONE TO JUDGE THIS BY.
//
// `household_isolation` filters on household_id. Two members of the same
// household should see each other; members of different households should not.
// Only the second half has ever been tested, because until 3.5 no household had
// two members. IF THE POLICY WERE ACCIDENTALLY PER-MEMBER RATHER THAN
// PER-HOUSEHOLD, EVERY ISOLATION TEST WRITTEN SINCE M1 WOULD STILL PASS.
//
// Every other control here fails when the code is wrong. That one fails when an
// assumption nobody ever stated has been wrong for two weeks.
//
// The path closes the way recovery does: not "a member row exists" but a member
// who CAN SIGN IN and CAN BE REACHED on a verified phone. A member who cannot
// sign in has not joined, and one whose phone is unverified is a member in name
// only, because nothing about the household's money can reach them.
//
// Rotation-guarded and serialised with the other role-rotating files.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { canRotate, rotateAppRole, assertNotSkippedInCI } from "./helpers/app-role.js";
import { realSignIn } from "./helpers/real-sign-in.js";
import { createAuth, type AuthEnv } from "../src/auth.js";
import { RecordingSender } from "../src/email.js";
import { RecordingOtpSender } from "../src/otp.js";
import {
  INVITATION_DAYS,
  NO_SECRETS_STATEMENT,
  createInvitation,
  redeemInvitation,
} from "../src/invitations.js";
import { mayReachMember } from "../src/channel-gate.js";
import { confirmPhoneVerification, startPhoneVerification } from "../src/phone-verify.js";
import { TOKEN_PURPOSES, mintToken } from "../src/tokens.js";

const OWNER_URL = process.env.DATABASE_URL;
const configured = canRotate();
const ORIGIN = "http://localhost:8787";

let env: AuthEnv;
let owner: ReturnType<typeof postgres>;
let app: ReturnType<typeof postgres>;

beforeAll(async () => {
  if (!configured) return;
  owner = postgres(OWNER_URL!, { max: 1 });
  const appUrl = await rotateAppRole(owner, OWNER_URL!, "invite");
  env = {
    NEON_DATABASE_URL: appUrl,
    ENVIRONMENT: "dev",
    BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long!",
    BETTER_AUTH_URL: ORIGIN,
  };
  app = postgres(appUrl, { max: 1 });
});

afterAll(async () => {
  if (owner) await owner.end();
  if (app) await app.end();
});

const phoneFor = () => `+1555${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
const emailFor = () => `invitee-${crypto.randomUUID()}@marginsheet.test`;

/** A household with a primary who has signed in for real. */
async function householdWithPrimary(opts: { primary?: boolean } = {}) {
  const signedIn = await realSignIn(env);
  const auth = createAuth(env);
  const ctx = await auth.$context;
  const userId = (await ctx.internalAdapter.findUserByEmail(signedIn.email))!.user.id;

  const [h] = await owner<{ id: string }[]>`
    insert into households (name) values ('Invite Probe') returning id
  `;
  const [m] = await owner<{ id: string }[]>`
    insert into members (household_id, first_name, role, auth_user_id, phone, phone_verified_at, is_primary)
    values (${h.id}, 'Primary', 'full_member', ${userId}, ${phoneFor()}, now(),
            ${opts.primary ?? true})
    returning id
  `;
  await app`select set_config('marginsheet.household_id', ${h.id}, false)`;
  return { household: h.id, memberId: m.id, userId, cookie: signedIn.cookie };
}

const deps = (mail = new RecordingSender()) => ({ sql: app, mail, baseUrl: ORIGIN });

/** The link exactly as the invitee receives it. */
function tokenFromEmail(mail: RecordingSender): string {
  const link = mail.sent.at(-1)!.text.split("\n").map((l) => l.trim()).find((l) => l.startsWith("http"))!;
  return new URL(link).searchParams.get("token")!;
}

it("is actually running, and did not skip itself in CI", () => {
  assertNotSkippedInCI(expect, "the invitations suite");
});

describe.skipIf(!configured)("the invitee path, end to end", { timeout: 90_000 }, () => {
  it("joins, signs in, and can be REACHED on a verified phone", async () => {
    const home = await householdWithPrimary();
    const d = deps();
    const inviteePhone = phoneFor();

    const created = await createInvitation(d, home.memberId, {
      name: "Sam",
      phone: inviteePhone,
      email: emailFor(),
    });
    expect(created.status, JSON.stringify(created)).toBe("invited");

    // The invitee follows the link out of the delivered email.
    const token = tokenFromEmail(d.mail);

    // They establish identity. Magic link here; the passkey path is covered by
    // 3.1a and shares this endpoint entirely.
    const invitee = await realSignIn(env);
    const ctx = await createAuth(env).$context;
    const inviteeUserId = (await ctx.internalAdapter.findUserByEmail(invitee.email))!.user.id;

    const joined = await redeemInvitation(app, token, inviteeUserId);
    expect(joined.status, JSON.stringify(joined)).toBe("joined");
    const memberId = joined.status === "joined" ? joined.memberId : "";

    // They are a full_member...
    const [row] = await owner<{ role: string; household_id: string }[]>`
      select role, household_id from members where id = ${memberId}
    `;
    expect(row.role).toBe("full_member");
    expect(row.household_id).toBe(home.household);

    // ...and NOT yet reachable, because the phone is unverified. Rule 3 doing
    // its job rather than a separate rule.
    expect(
      (await mayReachMember(app, memberId)).mayReach,
      "a member was reachable before verifying their phone"
    ).toBe(false);

    // Phone OTP completes the path.
    const otp = new RecordingOtpSender();
    expect((await startPhoneVerification(app, otp, memberId, inviteePhone)).status).toBe("sent");
    expect(
      (await confirmPhoneVerification(app, otp, memberId, otp.codeFor(inviteePhone)!)).status
    ).toBe("verified");

    // The two closing assertions. They can sign in...
    const backIn = await createAuth(env).api.getSession({
      headers: new Headers({ cookie: invitee.cookie }),
    });
    expect(backIn?.session, "the joined member cannot sign in, so they have not joined").toBeTruthy();

    // ...and they can be reached.
    expect(
      (await mayReachMember(app, memberId)).mayReach,
      "the joined member cannot be reached, so they are a member in name only"
    ).toBe(true);
  });
});

describe.skipIf(!configured)(
  "THE TWO-MEMBER ASSERTION: the household is the unit",
  { timeout: 90_000 },
  () => {
    it("two members of ONE household see each other", async () => {
      // Never asserted before 3.5, because no household has ever had two
      // members. If household_isolation were accidentally per-member, every
      // isolation test since M1 would still pass and this is the only one that
      // would fail.
      const home = await householdWithPrimary();
      const d = deps();
      await createInvitation(d, home.memberId, {
        name: "Sam",
        phone: phoneFor(),
        email: emailFor(),
      });
      const token = tokenFromEmail(d.mail);

      const invitee = await realSignIn(env);
      const ctx = await createAuth(env).$context;
      const inviteeUserId = (await ctx.internalAdapter.findUserByEmail(invitee.email))!.user.id;
      const joined = await redeemInvitation(app, token, inviteeUserId);
      expect(joined.status).toBe("joined");

      // In the household's context, BOTH members are visible to a reader.
      await app`select set_config('marginsheet.household_id', ${home.household}, false)`;
      const visible = await app<{ id: string }[]>`select id from members order by created_at`;

      expect(
        visible.length,
        "a member cannot see their own household's other member, so the isolation unit is the MEMBER rather than the HOUSEHOLD"
      ).toBe(2);
    });

    it("and still cannot see another household's members", async () => {
      // The half that was already tested, re-asserted here so the pair reads
      // as one claim: the boundary is the household, in both directions.
      const ours = await householdWithPrimary();
      const theirs = await householdWithPrimary();

      await app`select set_config('marginsheet.household_id', ${ours.household}, false)`;
      const visible = await app<{ household_id: string }[]>`select household_id from members`;

      expect(visible.every((r) => r.household_id === ours.household)).toBe(true);
      expect(visible.map((r) => r.household_id)).not.toContain(theirs.household);
    });
  }
);

describe.skipIf(!configured)("the invitation email, before joining", { timeout: 60_000 }, () => {
  it("carries the no-secrets statement in the DELIVERED body", async () => {
    // §7: stated in the invite email, BEFORE joining, not after. Asserted
    // against the delivered body rather than the template function, which would
    // pass with the template unwired.
    const home = await householdWithPrimary();
    const d = deps();
    await createInvitation(d, home.memberId, {
      name: "Sam",
      phone: phoneFor(),
      email: emailFor(),
    });

    const body = d.mail.sent.at(-1)!.text;

    // The substance rather than an exact sentence, so copy can improve without
    // breaking this and the meaning cannot go missing.
    expect(body).toContain(NO_SECRETS_STATEMENT);
    expect(body.toLowerCase()).toMatch(/sees everything|visible to the other members/);

    // And it appears BEFORE the invitation expires, which is to say: in the
    // message they read while deciding, not in one sent after they join.
    expect(body.indexOf(NO_SECRETS_STATEMENT)).toBeGreaterThan(-1);
    expect(body).toContain(`${INVITATION_DAYS} days`);
  });
});

describe.skipIf(!configured)("the controls", { timeout: 90_000 }, () => {
  it("REFUSES a second redemption, and one member exists", async () => {
    const home = await householdWithPrimary();
    const d = deps();
    await createInvitation(d, home.memberId, { name: "Sam", phone: phoneFor(), email: emailFor() });
    const token = tokenFromEmail(d.mail);

    const first = await realSignIn(env);
    const ctx = await createAuth(env).$context;
    const firstId = (await ctx.internalAdapter.findUserByEmail(first.email))!.user.id;
    expect((await redeemInvitation(app, token, firstId)).status).toBe("joined");

    const second = await realSignIn(env);
    const secondId = (await ctx.internalAdapter.findUserByEmail(second.email))!.user.id;
    expect((await redeemInvitation(app, token, secondId)).status).toBe("refused");

    const [{ count }] = await owner<{ count: string }[]>`
      select count(*) as count from members where household_id = ${home.household}
    `;
    expect(Number(count), "one invitation produced two members").toBe(2);
  });

  it("REFUSES an expired invitation, proven by moving the clock", async () => {
    const home = await householdWithPrimary();
    const d = deps();
    await createInvitation(d, home.memberId, { name: "Sam", phone: phoneFor(), email: emailFor() });
    const token = tokenFromEmail(d.mail);

    await owner`
      update invitations set expires_at = now() - make_interval(days => 1) where token = ${token}
    `;

    const invitee = await realSignIn(env);
    const ctx = await createAuth(env).$context;
    const id = (await ctx.internalAdapter.findUserByEmail(invitee.email))!.user.id;
    expect((await redeemInvitation(app, token, id)).status).toBe("refused");
  });

  it("REFUSES a non-primary member creating one", async () => {
    const home = await householdWithPrimary({ primary: false });
    const result = await createInvitation(deps(), home.memberId, {
      name: "Sam",
      phone: phoneFor(),
      email: emailFor(),
    });
    expect(result).toEqual({ status: "refused", reason: "not_primary" });
  });

  it("creates NOTHING when delivery fails", async () => {
    // An invitation nobody received is a row that makes a household think they
    // invited somebody.
    const home = await householdWithPrimary();
    const failing = {
      async send() {
        throw new Error("Postmark rejected the send");
      },
    };
    const before = await owner<{ id: string }[]>`
      select id from invitations where household_id = ${home.household}
    `;

    const result = await createInvitation(
      { sql: app, mail: failing, baseUrl: ORIGIN },
      home.memberId,
      { name: "Sam", phone: phoneFor(), email: emailFor() }
    );

    expect(result).toEqual({ status: "refused", reason: "undeliverable" });
    const after = await owner<{ id: string }[]>`
      select id from invitations where household_id = ${home.household}
    `;
    expect(after.length, "an undelivered invitation was still recorded").toBe(before.length);
  });

  it("REFUSES a sign-in or recovery token at the redemption endpoint", async () => {
    // On purpose, not by absence: the purpose prefix is checked before any
    // lookup, so these are the wrong KIND rather than merely unknown values.
    const invitee = await realSignIn(env);
    const ctx = await createAuth(env).$context;
    const id = (await ctx.internalAdapter.findUserByEmail(invitee.email))!.user.id;

    expect((await redeemInvitation(app, mintToken(TOKEN_PURPOSES.signIn), id)).status).toBe(
      "refused"
    );
    expect((await redeemInvitation(app, mintToken(TOKEN_PURPOSES.recovery), id)).status).toBe(
      "refused"
    );
  });

  it("the CHECK constraint refuses an unprefixed token", async () => {
    // Owed since 16 Aug and structural from 0022. Without it, an issuer could
    // write an unprefixed token and every test would still pass: the consumer
    // would refuse the value and the failure would look like a bug in
    // redemption rather than in minting.
    const home = await householdWithPrimary();
    await expect(
      owner`
        insert into invitations (household_id, token, expires_at)
        values (${home.household}, 'not-a-prefixed-token', now() + make_interval(days => 1))
      `
    ).rejects.toThrow(/invitations_token_purpose_prefix|violates check constraint/i);
  });
});
