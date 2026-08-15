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
//
// DISCIPLINE GAPS get the same treatment (ruled 15 Aug 2026). These are not
// invariants owed a second half; they are properties currently held closed by
// process rather than by structure. Each names its owner and the condition
// that would make it structural, and each prints in CI on every run until it
// does. A gap held by discipline and recorded nowhere is a gap that becomes
// invisible the moment the person holding it stops thinking about it.

import { describe, it, expect, afterAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const DB_TESTS = join(import.meta.dirname);

// The manifest is mostly file inspection, but the discipline-gap checks read
// the live catalog: a gap that claims to be open should be verifiable against
// the database rather than asserted from a list.
const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1 });
afterAll(async () => {
  await sql.end();
});

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
    // CLOSED by M2: the type-level half is proven in
    // packages/fact-packages/test/internal.test.ts. ComposerView strips every
    // internal field structurally, so a confidence band cannot reach a
    // composer, and a @ts-expect-error case fails the build if the property
    // ever becomes reachable.
  },
  {
    n: 4,
    statement: "A deleted known_context entry never appears in any fact-package query.",
    proofs: [
      { file: "context.test.ts", test: "present, then deleted, then absent" },
    ],
    // CLOSED by M2: the assembler half is proven in
    // packages/fact-packages/test/canon.test.ts, which asserts statically that
    // no assembly path names the base table, and proves the check can fail.
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

interface DisciplineGap {
  id: string;
  /** What is not structurally enforced today. */
  gap: string;
  /** What holds it closed in the meantime. */
  heldBy: string;
  /** The module that owns closing it. */
  owner: string;
  /** The condition under which it becomes structural, stated so it is checkable. */
  becomesStructuralWhen: string;
}

const DISCIPLINE_GAPS: DisciplineGap[] = [
  {
    id: "rls-not-forced",
    gap:
      "The application connects to Postgres as neondb_owner, which holds BYPASSRLS and therefore reads across households past every policy. Migration 0009 grants LOGIN to marginsheet_app and forces RLS; what actually closes this is the connection string each Worker uses, which is asserted by the isolation suite.",
    heldBy:
      "Until the isolation-suite assertion is green in every environment: nothing but deployment configuration. A spike on 15 Aug 2026 found the mitigation recorded in migration 0008 was never actually in place, since Task 0.3 issued every Worker's NEON_DATABASE_URL for neondb_owner.",
    owner: "M3 (identity and auth)",
    becomesStructuralWhen:
      "Every Worker's NEON_DATABASE_URL authenticates as marginsheet_app (or marginsheet_sync for the sync worker), and the isolation suite asserts BOTH that current_user IS marginsheet_app and that the role does NOT hold BYPASSRLS. Asserting only the absence of the owner would pass for any wrong role, including one that does not exist. When that assertion is green in dev, staging, and production, delete this entry.",
  },
  {
    id: "owner-keeps-bypassrls",
    gap:
      "neondb_owner retains the BYPASSRLS attribute, so anything holding owner credentials is exempt from household isolation regardless of FORCE.",
    heldBy:
      "The rls-not-forced check above: if no runtime component authenticates as the owner, the attribute has no runtime reach. FORCE is enabled but does not help here, because BYPASSRLS supersedes it.",
    owner: "Nobody, deliberately (ruled 15 Aug 2026)",
    becomesStructuralWhen:
      "It does not, and that is the decision rather than an omission. Revoking BYPASSRLS from neondb_owner would make isolation structural instead of configuration-dependent, but it is Neon's default posture and the migration path depends on it. That is a bet against a vendor default to close a gap the connection-string check already closes, and a verifiable check beats an unverified bet. Revisit only if Neon's defaults change or a migration path stops needing it.",
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

  it("the remaining partial is invariant 5, after M2 closed 3 and 4", () => {
    expect(partials.map((i) => i.n)).toEqual([5]);
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
    expect(lines).toHaveLength(1);
  });
});

describe("discipline gaps: held closed by process, not by structure", () => {
  it("each names an owner and a checkable condition for becoming structural", () => {
    expect(DISCIPLINE_GAPS.length).toBeGreaterThan(0);
    for (const g of DISCIPLINE_GAPS) {
      expect(g.owner, `${g.id} has no owner`).toBeTruthy();
      expect(g.heldBy.length, `${g.id} does not say what holds it closed`).toBeGreaterThan(20);
      expect(
        g.becomesStructuralWhen.length,
        `${g.id} does not say when it becomes structural`
      ).toBeGreaterThan(40);
    }
  });

  it("FORCE is all-or-nothing across policied tables", async () => {
    // Partial adoption is worse than none: it reads as done while most
    // tables remain exempt. Migration 0009 forces all of them.
    const [forced] = await sql<{ n: number }[]>`
      select count(*)::int as n
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relforcerowsecurity
    `;
    const [policied] = await sql<{ n: number }[]>`
      select count(distinct tablename)::int as n from pg_policies
      where schemaname = 'public' and policyname = 'household_isolation'
    `;
    expect(
      forced.n,
      `FORCE is set on ${forced.n} of ${policied.n} policied tables. Force all of them or none.`
    ).toBe(policied.n);
  });

  it("the app role can log in and does NOT hold BYPASSRLS", async () => {
    // The role the application authenticates as must be subject to every
    // policy. A LOGIN role that also carried BYPASSRLS would look correct in
    // a connection string and be exempt in practice.
    const [app] = await sql<{ rolcanlogin: boolean; rolbypassrls: boolean }[]>`
      select rolcanlogin, rolbypassrls from pg_roles where rolname = 'marginsheet_app'
    `;
    expect(app.rolcanlogin, "marginsheet_app cannot log in").toBe(true);
    expect(app.rolbypassrls, "marginsheet_app holds BYPASSRLS, which defeats every policy").toBe(false);
  });

  it("the owner still holds BYPASSRLS, which is the recorded decision", async () => {
    const [owner] = await sql<{ rolbypassrls: boolean }[]>`
      select rolbypassrls from pg_roles where rolname = current_user
    `;
    // If this ever flips, the owner-keeps-bypassrls entry is stale and the
    // migration path should be re-verified rather than the entry deleted.
    expect(owner.rolbypassrls).toBe(true);
  });

  it("prints the discipline gaps alongside the invariant open items", () => {
    const lines = DISCIPLINE_GAPS.map(
      (g) =>
        `  ${g.id} -> ${g.owner}\n` +
        `      gap:      ${g.gap}\n` +
        `      held by:  ${g.heldBy}\n` +
        `      closes when: ${g.becomesStructuralWhen}`
    );
    console.log(
      "\nDISCIPLINE GAPS (held closed by process, not structure):\n" + lines.join("\n") + "\n"
    );
    expect(lines.length).toBeGreaterThan(0);
  });
});
