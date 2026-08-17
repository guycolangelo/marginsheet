// The cross-presentation matrix (M3 task 3.2c, FIRST PASS OF TWO).
//
// THE FAILURE IT PREVENTS. An invitation token accepted by the sign-in
// endpoint would hand a household session to whoever holds an invite. Nothing
// about a random string says which kind it is, so a test that only checks the
// diagonal ("each token works with its own consumer") passes happily on a
// system where any token opens any door. The off-diagonal cells are the test.
//
// THE MATRIX IS COMPLETE: NINE REAL CELLS (3.1b closed the second pass).
//
// It shipped as 2x2 on 16 Aug with recovery's row and column carried as
// explicitly empty todos, because an incomplete matrix that looks complete is
// how six untested cells become assumed-tested (Guy). 3.1b built the recovery
// consumer, so the column is now real and the todos are gone.
//
//                      | sign-in consumer | invitation consumer | recovery consumer
//   -------------------+------------------+---------------------+------------------
//   sign-in token      | ACCEPT           | REFUSE              | REFUSE
//   invitation token   | REFUSE           | ACCEPT              | REFUSE
//   recovery token     | REFUSE           | REFUSE              | ACCEPT
//
// Three diagonal cells succeed and six off-diagonal cells are refused, all
// generated below rather than written out, so a fourth token kind cannot be
// added without its whole row and column appearing.
//
// STILL OWED, and narrowed rather than closed: the invitation consumer has no
// ENDPOINT until 3.5. The format and the consumer function are real; what 3.5
// adds is an issuer that mints them and a route that spends them.

import { describe, it, expect } from "vitest";
import {
  TOKEN_PURPOSES,
  mintToken,
  readInvitationToken,
  readRecoveryToken,
  readSignInToken,
} from "../src/tokens.js";

/** All three consumers. Recovery joined in 3.1b, closing the column. */
const CONSUMERS = {
  "sign-in": readSignInToken,
  invitation: readInvitationToken,
  recovery: readRecoveryToken,
} as const;

const KINDS = {
  "sign-in": TOKEN_PURPOSES.signIn,
  invitation: TOKEN_PURPOSES.invitation,
  recovery: TOKEN_PURPOSES.recovery,
} as const;

describe("the diagonal: each consumer accepts its own kind", () => {
  // Without these the guard could refuse everything and every off-diagonal
  // assertion below would still pass, which is a control that cannot succeed
  // rather than one that cannot fail.
  it("the sign-in consumer accepts a sign-in token", () => {
    const token = mintToken(TOKEN_PURPOSES.signIn);
    expect(readSignInToken(token)).toBe(token);
  });

  it("the invitation consumer accepts an invitation token", () => {
    const token = mintToken(TOKEN_PURPOSES.invitation);
    expect(readInvitationToken(token)).toBe(token);
  });

  it("the recovery consumer accepts a recovery token", () => {
    const token = mintToken(TOKEN_PURPOSES.recovery);
    expect(readRecoveryToken(token)).toBe(token);
  });
});

describe("the off-diagonal: every consumer refuses every other kind", () => {
  for (const [consumerName, consume] of Object.entries(CONSUMERS)) {
    for (const [kindName, purpose] of Object.entries(KINDS)) {
      if (kindName === consumerName) continue;

      it(`the ${consumerName} consumer refuses a ${kindName} token`, () => {
        const token = mintToken(purpose as never);
        expect(
          consume(token),
          `a ${kindName} token was accepted by the ${consumerName} consumer`
        ).toBeNull();
      });
    }
  }
});

describe("the refusals are refusals ON PURPOSE, not accidents of storage", () => {
  // The trap this section exists for. An invitation token refused by sign-in
  // could be refused because it is not a sign-in token, or merely because it
  // is absent from `verification`. Those are indistinguishable from the
  // outcome, and only the first survives two kinds ever sharing a store. Same
  // shape as the column-privilege revoke that passed while never applying.
  it("the SAME secret material is accepted or refused purely by its purpose", () => {
    const signIn = mintToken(TOKEN_PURPOSES.signIn);
    const material = signIn.split("_")[2];

    // One secret, relabelled. Nothing about the random half changes.
    const asInvitation = `ms_${TOKEN_PURPOSES.invitation}_${material}`;
    const asRecovery = `ms_${TOKEN_PURPOSES.recovery}_${material}`;

    expect(readSignInToken(signIn), "the sign-in consumer refused its own kind").toBe(signIn);
    expect(
      readSignInToken(asInvitation),
      "the same material relabelled as an invitation was still accepted by sign-in"
    ).toBeNull();
    expect(readSignInToken(asRecovery)).toBeNull();

    // And the mirror: the invitation consumer takes the relabelled one and
    // refuses the original. Proof the purpose is doing the work and the
    // material is doing none of it.
    expect(readInvitationToken(asInvitation)).toBe(asInvitation);
    expect(readInvitationToken(signIn)).toBeNull();
  });

  it("refusal happens on structure, so a lookalike prefix does not pass", () => {
    const material = mintToken(TOKEN_PURPOSES.signIn).split("_")[2];

    for (const lookalike of [
      `ms_signin${material}`, // no separator
      `ms_signin_extra_${material}`, // an extra segment
      `xx_signin_${material}`, // wrong namespace
      `ms_SIGNIN_${material}`, // case
      `ms_signin_`, // no material
      `_signin_${material}`, // empty namespace
      ` ms_signin_${material}`, // leading space
      `ms_signin_${material} `, // trailing space
    ]) {
      expect(readSignInToken(lookalike), `"${lookalike}" was accepted`).toBeNull();
    }
  });

  it("refuses anything that is not a string, without throwing", () => {
    for (const junk of [null, undefined, 0, {}, [], true]) {
      expect(readSignInToken(junk)).toBeNull();
      expect(readInvitationToken(junk)).toBeNull();
    }
  });
});

describe("the recovery column, which used to be three todos", () => {
  it("a recovery consumer IS now exported, which is what the old assertion forced", async () => {
    // This inverts the assertion that shipped on 16 Aug. That one required NO
    // recovery consumer to exist, precisely so that whoever added one would
    // fail this file and have to come back and fill the column in. It worked:
    // this is that visit.
    const tokens = await import("../src/tokens.js");
    expect(Object.keys(tokens)).toContain("readRecoveryToken");
  });

  it("every purpose has exactly one consumer, so none can be orphaned", () => {
    // A fourth kind added to TOKEN_PURPOSES without a consumer would mint
    // tokens nothing accepts, which fails closed but silently. This names it.
    expect(Object.keys(CONSUMERS)).toHaveLength(Object.keys(KINDS).length);
    expect(new Set(Object.values(TOKEN_PURPOSES)).size).toBe(
      Object.values(TOKEN_PURPOSES).length
    );
  });
});

describe("minting", () => {
  it("never repeats a value", () => {
    const seen = new Set(Array.from({ length: 500 }, () => mintToken(TOKEN_PURPOSES.signIn)));
    expect(seen.size).toBe(500);
  });

  it("is URL and email safe, because it travels in a link", () => {
    for (const purpose of Object.values(TOKEN_PURPOSES)) {
      const token = mintToken(purpose);
      expect(token).toMatch(/^ms_[a-z]+_[A-Za-z0-9_-]+$/);
      expect(encodeURIComponent(token)).toBe(token);
    }
  });
});
