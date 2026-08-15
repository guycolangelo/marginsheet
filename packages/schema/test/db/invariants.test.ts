// THE INVARIANT MANIFEST (data-model-spec §10).
//
// One place where all ten are named, each pointing at the test that proves
// it. The manifest FAILS if a named test file or test name is missing, so
// deleting a proof breaks the suite rather than quietly reducing coverage.
//
// PARTIALS ARE CARRIED AS OPEN ITEMS WITH AN OWNER (ruled 15 Aug 2026).
// Three invariants are proven at the schema layer and owed an application
// layer. Each names the module that owes it, the same way M2 inherited the
// composable-view test from 1.5b. An invariant that is half-proven with no
// owner is one that stays half-proven.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DB_TESTS = join(import.meta.dirname);

interface Proof {
  /** Test file that proves it. */
  file: string;
  /** A distinctive substring of the test name inside that file. */
  test: string;
}

interface OpenItem {
  /** The module that owes the remaining half. */
  owner: string;
  /** What is still unproven, in one line. */
  owed: string;
}

interface Invariant {
  n: number;
  statement: string;
  proofs: Proof[];
  /** Present when the schema layer is proven and an application layer is owed. */
  open?: OpenItem;
}

const INVARIANTS: Invariant[] = [
  {
    n: 1,
    statement:
      "A transaction's household, account's household, and item's household always agree.",
    proofs: [
      { file: "ledger.test.ts", test: "refuses a transaction whose household differs" },
      { file: "ledger.test.ts", test: "refuses an account placed under another household" },
    ],
  },
  {
    n: 2,
    statement:
      "access_token_ciphertext is unreadable by any RLS role; only the sync worker decrypts.",
    proofs: [
      { file: "banking.test.ts", test: "cannot select the ciphertext" },
      { file: "rls.test.ts", test: "still cannot read the Plaid token" },
    ],
  },
  {
    n: 3,
    statement:
      "known_context has no confidence column and no code path can add one to a fact package.",
    proofs: [
      { file: "context.test.ts", test: "no column resembling a confidence score" },
    ],
    open: {
      owner: "M2 (fact packages)",
      owed:
        "The type-level half: no fact-package type may carry a confidence field, enforced in the typed definitions rather than by schema absence.",
    },
  },
  {
    n: 4,
    statement: "A deleted known_context entry never appears in any fact-package query.",
    proofs: [
      { file: "context.test.ts", test: "present, then deleted, then absent" },
    ],
    open: {
      owner: "M2 (fact packages)",
      owed:
        "The assembler half: a test asserting no fact-package query path reads known_context directly rather than through known_context_composable. Recorded on the view's own comment.",
    },
  },
  {
    n: 5,
    statement:
      "provider_events uniqueness makes every webhook handler idempotent by construction.",
    proofs: [
      { file: "banking.test.ts", test: "rejects the same (source, event_id) twice" },
    ],
    open: {
      owner: "M4 (Plaid pipeline) and M7 (billing)",
      owed:
        "The handler half: every webhook handler for all four providers must check-and-insert here FIRST, before any processing. The constraint cannot enforce call order.",
    },
  },
  {
    n: 6,
    statement:
      "global_merchant_facts physically cannot store amounts, dates, or account details.",
    proofs: [
      { file: "artifacts.test.ts", test: "no household-identifying reference" },
      { file: "artifacts.test.ts", test: "no column that could carry an amount" },
      { file: "artifacts.test.ts", test: "no date column" },
    ],
  },
  {
    n: 7,
    statement: "messages.gate_result is non-null on every sent outbound row.",
    proofs: [
      { file: "conversation.test.ts", test: "refuses a sent message with no gate result" },
    ],
  },
  {
    n: 8,
    statement:
      "One transaction: answer, correction minted, queue cleared, dispatch resolved. No partial states under crash.",
    proofs: [
      { file: "invariant-8.test.ts", test: "POSITIVE: a crash mid-transaction" },
      { file: "invariant-8.test.ts", test: "NEGATIVE CONTROL" },
    ],
  },
  {
    n: 9,
    statement: "transactions.direction never holds unclassified.",
    proofs: [
      { file: "ledger.test.ts", test: "rejects unclassified outright" },
    ],
  },
  {
    n: 10,
    statement:
      "Unique constraints: every collision is an upsert, never a duplicate.",
    proofs: [
      { file: "banking.test.ts", test: "refuses a second snapshot for the same account" },
      { file: "ledger.test.ts", test: "refuses a duplicate plaid_transaction_id" },
      { file: "projections.test.ts", test: "refuses a second commitment for the same stream" },
      { file: "conversation.test.ts", test: "refuses a duplicate provider_message_id" },
      { file: "artifacts.test.ts", test: "refuses a duplicate llm_cache pattern" },
      { file: "context.test.ts", test: "refuses a second row for the same household, rule, and subject" },
    ],
  },
];

const files = new Map<string, string>();
for (const name of readdirSync(DB_TESTS).filter((f) => f.endsWith(".test.ts"))) {
  files.set(name, readFileSync(join(DB_TESTS, name), "utf8"));
}

describe("the invariant manifest", () => {
  it("names all ten", () => {
    expect(INVARIANTS.map((i) => i.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  for (const inv of INVARIANTS) {
    describe(`invariant ${inv.n}: ${inv.statement}`, () => {
      for (const proof of inv.proofs) {
        it(`is proven in ${proof.file}: "${proof.test}"`, () => {
          const contents = files.get(proof.file);
          expect(contents, `${proof.file} is missing from test/db`).toBeTruthy();
          expect(
            contents!.includes(proof.test),
            `${proof.file} no longer contains a test matching "${proof.test}". ` +
              `Invariant ${inv.n} lost a proof: restore the test or update the manifest deliberately.`
          ).toBe(true);
        });
      }
    });
  }
});

describe("open items: invariants proven at the schema layer and owed an application layer", () => {
  const partials = INVARIANTS.filter((i) => i.open);

  it("there are exactly three, and each names its owner", () => {
    expect(partials.map((i) => i.n)).toEqual([3, 4, 5]);
    for (const inv of partials) {
      expect(inv.open!.owner, `invariant ${inv.n} has no owner`).toBeTruthy();
      expect(inv.open!.owed.length, `invariant ${inv.n} has no description`).toBeGreaterThan(20);
    }
  });

  for (const inv of partials) {
    it(`invariant ${inv.n} is owed by ${inv.open!.owner}`, () => {
      // This test does not verify the application half; it exists so the
      // debt is visible in the suite output every time it runs, rather than
      // living in a document nobody opens.
      expect(inv.open!.owed).toBeTruthy();
    });
  }

  it("prints the open items so they are visible in every run", () => {
    const lines = partials.map(
      (i) => `  invariant ${i.n} -> ${i.open!.owner}: ${i.open!.owed}`
    );
    console.log("\nINVARIANT OPEN ITEMS (schema half proven, application half owed):\n" + lines.join("\n") + "\n");
    expect(lines).toHaveLength(3);
  });
});
