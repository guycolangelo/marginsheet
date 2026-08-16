// The cross-presentation matrix (M3 task 3.2c, FIRST PASS OF TWO).
//
// THE FAILURE IT PREVENTS. An invitation token accepted by the sign-in
// endpoint would hand a household session to whoever holds an invite. Nothing
// about a random string says which kind it is, so a test that only checks the
// diagonal ("each token works with its own consumer") passes happily on a
// system where any token opens any door. The off-diagonal cells are the test.
//
// !!! THIS MATRIX IS INCOMPLETE, DELIBERATELY AND VISIBLY. !!!
//
// Three kinds were specified: sign-in, invitation, recovery. Recovery has no
// table, no issuer and no consumer, because the recovery path is task 3.1b.
// Its row and column are present below as explicitly empty cells with reasons
// rather than being quietly omitted, because AN INCOMPLETE MATRIX THAT LOOKS
// COMPLETE IS HOW SIX UNTESTED CELLS BECOME ASSUMED-TESTED (Guy, 16 Aug 2026).
//
// Second pass owed to 3.1b (recovery consumer) and 3.5 (invitation consumer).
// Tracked in docs/open-items.json and printed by the open-items CI job.
//
//                      | sign-in consumer | invitation consumer | recovery consumer
//   -------------------+------------------+---------------------+------------------
//   sign-in token      | ACCEPT (tested)  | REFUSE (tested)     | owed to 3.1b
//   invitation token   | REFUSE (tested)  | ACCEPT (tested)     | owed to 3.1b
//   recovery token     | REFUSE (tested)  | REFUSE (tested)     | owed to 3.1b
//
// The recovery TOKEN row is testable today even though the recovery CONSUMER
// is not: the purpose string is reserved in tokens.ts, so a recovery-purpose
// token can be minted and presented to the two consumers that do exist. What
// cannot be tested is anything in the recovery consumer column.

import { describe, it, expect } from "vitest";
import {
  TOKEN_PURPOSES,
  mintToken,
  readInvitationToken,
  readSignInToken,
} from "../src/tokens.js";

/** The consumers that exist. Recovery is absent from this list on purpose. */
const CONSUMERS = {
  "sign-in": readSignInToken,
  invitation: readInvitationToken,
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

describe("the empty cells, named rather than omitted", () => {
  // These do not assert behaviour. They exist so the recovery consumer column
  // is visible in the test output as owed rather than absent, and so a reader
  // counting green ticks cannot mistake this matrix for a complete one.
  it.todo("the recovery consumer accepts a recovery token (owed to 3.1b)");
  it.todo("the recovery consumer refuses a sign-in token (owed to 3.1b)");
  it.todo("the recovery consumer refuses an invitation token (owed to 3.1b)");

  it("no recovery consumer is exported, so nothing can accidentally use one", async () => {
    // If 3.1b adds one, this fails and whoever adds it has to come here and
    // fill in the three todos above rather than leaving them.
    const tokens = await import("../src/tokens.js");
    expect(
      Object.keys(tokens).filter((k) => /recovery/i.test(k) && k.startsWith("read")),
      "a recovery consumer now exists; fill in the recovery column of this matrix"
    ).toEqual([]);
  });

  it("the recovery purpose is reserved, so 3.1b inherits the namespace", () => {
    // Reserving the string is not the same as building the consumer. This
    // stops 3.1b inventing a colliding or unprefixed format later.
    expect(TOKEN_PURPOSES.recovery).toBe("recover");
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
