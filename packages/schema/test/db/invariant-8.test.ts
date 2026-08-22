// INVARIANT 8: one transaction. Answer, correction minted, queue cleared,
// dispatch resolved. No partial states under crash.
//
// This is the invariant that killed D1. The failure was never "Postgres
// forgot to roll back" -- it was that conversation state lived in D1 and
// books lived in Postgres, so NO SINGLE TRANSACTION SPANNING THEM EXISTED. A
// crash between writes left a dispatch answered with no correction minted,
// or a correction minted against a transaction still sitting in the queue.
//
// So the risk this file guards is not Postgres's ACID guarantees, which are
// not in doubt. It is whether the application put all four writes in ONE
// transaction. A test that begins a transaction, writes, crashes, and finds
// nothing would pass forever, including on the day someone splits the four
// writes apart.
//
// Hence the NEGATIVE CONTROL below. It performs the same four writes in
// autocommit and crashes at the same point, and it REQUIRES partial state to
// appear. If it cannot produce a partial state, the harness cannot observe
// the thing it exists to detect, and the positive result means nothing.
//
// The positive test proves the invariant holds. The negative control proves
// the test is capable of noticing when it does not.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
const sql = postgres(DATABASE_URL ?? "", { max: 1 });

const uuid = () => crypto.randomUUID();

beforeAll(() => {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is required for introspection tests");
});
afterAll(async () => {
  await sql.end();
});

interface Fixture {
  household: string;
  accountId: string;
  transactionId: string;
  dispatchId: string;
  merchantKey: string;
}

/** A household with one queued transaction and one pending dispatch about it. */
async function seed(): Promise<Fixture> {
  const household = uuid();
  const merchantKey = `probe ${uuid().slice(0, 8)}`;

  const [item] = await sql<{ id: string }[]>`
    insert into plaid_items (household_id, item_id) values (${household}, ${"i_" + uuid()})
    returning id
  `;
  const [account] = await sql<{ id: string }[]>`
    insert into financial_accounts (household_id, plaid_item_id, plaid_account_id)
    values (${household}, ${item.id}, ${"a_" + uuid()}) returning id
  `;
  const [txn] = await sql<{ id: string }[]>`
    insert into transactions
      (household_id, account_id, date, amount, flow, normalized_merchant_key,
       review_state, queue_reason)
    values
      (${household}, ${account.id}, '2026-08-15', 200.00, 'inflow', ${merchantKey},
       'needs_review', 'unclassified_inflow')
    returning id
  `;
  const [dispatch] = await sql<{ id: string }[]>`
    insert into question_dispatches (household_id, question_text, state)
    values (${household}, 'Who was the $200 deposit from?', 'pending')
    returning id
  `;

  return {
    household,
    accountId: account.id,
    transactionId: txn.id,
    dispatchId: dispatch.id,
    merchantKey,
  };
}

async function cleanup(f: Fixture) {
  await sql`delete from question_dispatches where household_id = ${f.household}`;
  await sql`delete from merchant_corrections where household_id = ${f.household}`;
  await sql`delete from transactions where household_id = ${f.household}`;
  await sql`delete from financial_accounts where household_id = ${f.household}`;
  await sql`delete from plaid_items where household_id = ${f.household}`;
}

/** What an observer sees after the crash. Each field is a partial state. */
async function observe(f: Fixture) {
  const [dispatch] = await sql<{ state: string }[]>`
    select state from question_dispatches where id = ${f.dispatchId}
  `;
  const [correction] = await sql<{ n: number }[]>`
    select count(*)::int as n from merchant_corrections
    where household_id = ${f.household} and normalized_merchant_key = ${f.merchantKey}
  `;
  const [txn] = await sql<{ review_state: string }[]>`
    select review_state from transactions where id = ${f.transactionId}
  `;
  return {
    dispatchAnswered: dispatch.state === "answered",
    correctionMinted: correction.n > 0,
    transactionReviewed: txn.review_state === "user_reviewed",
  };
}

/**
 * Kill a backend the way a crashed worker dies: pg_terminate_backend from a
 * second connection, while the victim sits mid-work with writes outstanding.
 * Not a clean ROLLBACK, and not an exception the code could have caught.
 */
async function crash(victimPid: number): Promise<void> {
  const killer = postgres(DATABASE_URL!, { max: 1 });
  try {
    await killer`select pg_terminate_backend(${victimPid})`;
  } finally {
    await killer.end();
  }
}

/** These three open their OWN connection to a remote Neon branch, read a
 *  backend pid, and kill it mid-transaction. That is four or more round trips
 *  each before an assertion runs, and vitest's default is 5000ms.
 *
 *  ONE OF THEM TIMED OUT ON 22 AUG 2026 AT 5005ms while its siblings took
 *  4629ms and 2334ms. Nothing about the test changed: the database suite grew
 *  through the day and these were always marginal by design.
 *
 *  RAISED RATHER THAN RE-RUN, because a fixture that reddens on latency when
 *  the code is correct teaches people to re-run, and that habit is how a real
 *  red gets ignored. The number is not masking slowness in the subject: the
 *  cost is the round trips, which are what the test is FOR. */
const CRASH_TEST_TIMEOUT_MS = 20_000;

describe("invariant 8: the four writes are one transaction", () => {
  it("POSITIVE: a crash mid-transaction leaves no partial state", async () => {
    const f = await seed();
    const victim = postgres(DATABASE_URL!, { max: 1 });

    try {
      const [{ pid }] = await victim<{ pid: number }[]>`select pg_backend_pid() as pid`;

      await victim.unsafe("BEGIN");
      // Write 1: resolve the dispatch.
      await victim`
        update question_dispatches set state = 'answered', resolved_at = now()
        where id = ${f.dispatchId} and state = 'pending'
      `;
      // Write 2: mint the learned record.
      await victim`
        insert into merchant_corrections (household_id, normalized_merchant_key, direction, source)
        values (${f.household}, ${f.merchantKey}, 'income', 'user')
      `;
      // Crash before writes 3 and 4. A worker dying here is the D1 failure.
      await crash(pid);
    } finally {
      await victim.end({ timeout: 1 }).catch(() => {});
    }

    const seen = await observe(f);

    // None of the three partial states may be observable.
    expect(seen.dispatchAnswered, "dispatch answered with no correction").toBe(false);
    expect(seen.correctionMinted, "correction minted against a queued transaction").toBe(false);
    expect(seen.transactionReviewed, "transaction reviewed with a pending dispatch").toBe(false);

    await cleanup(f);
  }, CRASH_TEST_TIMEOUT_MS);

  it("NEGATIVE CONTROL: the same writes in autocommit DO leave partial state", async () => {
    // This test exists to prove the positive test above is capable of
    // failing. If this control cannot produce a partial state, the harness
    // cannot observe the thing invariant 8 is about, and the positive result
    // is meaningless.
    const f = await seed();
    const victim = postgres(DATABASE_URL!, { max: 1 });

    try {
      const [{ pid }] = await victim<{ pid: number }[]>`select pg_backend_pid() as pid`;

      // No BEGIN. Each statement commits on its own, which is exactly the
      // shape of a two-store write path.
      await victim`
        update question_dispatches set state = 'answered', resolved_at = now()
        where id = ${f.dispatchId} and state = 'pending'
      `;
      await victim`
        insert into merchant_corrections (household_id, normalized_merchant_key, direction, source)
        values (${f.household}, ${f.merchantKey}, 'income', 'user')
      `;
      await crash(pid);
    } finally {
      await victim.end({ timeout: 1 }).catch(() => {});
    }

    const seen = await observe(f);

    // The partial state MUST be visible here. These assertions failing means
    // the harness is blind, not that the system is safe.
    expect(seen.dispatchAnswered, "control failed to produce a partial state").toBe(true);
    expect(seen.correctionMinted, "control failed to produce a partial state").toBe(true);
    // And the write that never happened is still undone, which is what makes
    // it PARTIAL rather than complete.
    expect(seen.transactionReviewed).toBe(false);

    await cleanup(f);
  }, CRASH_TEST_TIMEOUT_MS);

  it("the complete transaction commits all four writes together", async () => {
    const f = await seed();

    await sql.begin(async (tx) => {
      await tx`
        update question_dispatches set state = 'answered', resolved_at = now()
        where id = ${f.dispatchId} and state = 'pending'
      `;
      await tx`
        insert into merchant_corrections (household_id, normalized_merchant_key, direction, source)
        values (${f.household}, ${f.merchantKey}, 'income', 'user')
      `;
      await tx`
        update transactions
           set review_state = 'user_reviewed', queue_reason = null
         where id = ${f.transactionId}
      `;
    });

    const seen = await observe(f);
    expect(seen.dispatchAnswered).toBe(true);
    expect(seen.correctionMinted).toBe(true);
    expect(seen.transactionReviewed).toBe(true);

    await cleanup(f);
  }, CRASH_TEST_TIMEOUT_MS);
});
