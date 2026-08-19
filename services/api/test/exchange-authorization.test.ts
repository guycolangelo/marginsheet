// /plaid/exchange derives the household from the SESSION, never from the body.
//
// WHAT THIS GUARDS, AND WHY IT IS DIFFERENT FROM EVERY OTHER FINDING THIS WEEK.
// The others were controls that guarded nothing. This was an authorization
// boundary POINTED AT THE ATTACKER: the handler read `householdId` out of the
// request body and exchange.ts did set_config('marginsheet.household_id',
// <that value>). Every RLS policy then enforced isolation faithfully, for
// whichever household the caller named. RLS cannot help when the household id
// is the INPUT to the GUC rather than a constraint on it.
//
// Probed against production on 19 Aug 2026: an unauthenticated POST answered
// 400, not 401, which is the handler rejecting the body SHAPE after reaching
// it.
//
// THE RULE: an authorization input never comes from the request body. It is
// derived from the session, with no parameter offering it and nothing to
// override. So householdId is not validated, it does not exist as a field.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { canRotate, rotateAppRole, assertNotSkippedInCI } from "./helpers/app-role.js";
import { realSignIn } from "./helpers/real-sign-in.js";
import { createAuth, type AuthEnv } from "../src/auth.js";
import { router, type Env as WorkerEnv } from "../src/index.js";

const OWNER_URL = process.env.DATABASE_URL;
const configured = canRotate();
const ORIGIN = "http://localhost:8787";

let env: AuthEnv;
let workerEnv: WorkerEnv;
let owner: ReturnType<typeof postgres>;

/** Captures what api forwards to sync, so the test can read the household id
 *  api CHOSE rather than infer it from an outcome. The real binding would
 *  reach Plaid; nothing here needs to. */
type Forwarded = { publicToken?: unknown; householdId?: unknown };
let forwarded: Forwarded | null = null;
const recordingSync = {
  async fetch(request: Request): Promise<Response> {
    forwarded = (await request.json()) as Forwarded;
    return Response.json({ itemId: "item-stub", accounts: [] });
  },
};

beforeAll(async () => {
  if (!configured) return;
  owner = postgres(OWNER_URL!, { max: 1 });
  const appUrl = await rotateAppRole(owner, OWNER_URL!, "exchangeauth");
  env = {
    NEON_DATABASE_URL: appUrl,
    ENVIRONMENT: "dev",
    BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long!",
    BETTER_AUTH_URL: ORIGIN,
  };
  workerEnv = { ...env, SYNC: recordingSync } as WorkerEnv;
});

afterAll(async () => {
  if (owner) await owner.end();
});

const phoneFor = () => `+1555${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;

/** A signed-in member of a real household. */
async function signedInMember() {
  const signedIn = await realSignIn(env);
  const auth = createAuth(env);
  const ctx = await auth.$context;
  const userId = (await ctx.internalAdapter.findUserByEmail(signedIn.email))!.user.id;
  const [household] = await owner<{ id: string }[]>`
    insert into households (name) values ('Exchange Auth') returning id
  `;
  await owner`
    insert into members (household_id, first_name, role, auth_user_id, phone, phone_verified_at, is_primary)
    values (${household.id}, 'Primary', 'full_member', ${userId}, ${phoneFor()}, now(), true)
  `;
  return { household: household.id, cookie: signedIn.cookie };
}

const exchange = (body: unknown, cookie?: string) =>
  router.fetch(
    new Request(`${ORIGIN}/plaid/exchange`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
    workerEnv
  );

describe.skipIf(!configured)("/plaid/exchange authorization", () => {
  it("refuses an unauthenticated caller with 401, not 400", async () => {
    assertNotSkippedInCI(expect, "exchange-authorization");
    forwarded = null;
    const response = await exchange({ publicToken: "public-sandbox-x" });

    // 401 SPECIFICALLY. The defect answered 400, because the body was checked
    // and the caller never was, and a 400 reads as "malformed" rather than as
    // "who are you". The status is the finding.
    expect(response.status).toBe(401);
    expect(forwarded, "an unauthenticated request reached sync").toBeNull();
  });

  it("ignores a householdId in the body and uses the session's household", async () => {
    const { household, cookie } = await signedInMember();
    const someoneElse = crypto.randomUUID();
    forwarded = null;

    const response = await exchange(
      { publicToken: "public-sandbox-x", householdId: someoneElse },
      cookie
    );
    expect(response.status).toBe(200);

    // FIXTURE GUARD: the two values must differ, or this proves nothing. A run
    // where the attacker's id happened to equal the session's would pass while
    // testing nothing, which is the degenerate-fixture shape.
    expect(someoneElse).not.toBe(household);

    expect((forwarded as Forwarded | null)?.householdId, "the body's householdId was honored").toBe(household);
  });

  it("forwards a body it rebuilt, carrying no other caller-supplied keys", async () => {
    const { cookie } = await signedInMember();
    forwarded = null;

    await exchange(
      { publicToken: "public-sandbox-x", householdId: crypto.randomUUID(), extra: "smuggled" },
      cookie
    );

    // Rebuilt rather than spread. A spread would let householdId ride along and
    // win by key order, which is the same defect with an extra step.
    expect(Object.keys(forwarded ?? {}).sort()).toEqual(["householdId", "publicToken"]);
  });
});
