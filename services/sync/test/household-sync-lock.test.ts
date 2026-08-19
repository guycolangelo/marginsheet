// M4 task 4.5: the household's sync chain lock, over HTTP against wrangler dev.
//
// WHY HTTP AND NOT A UNIT TEST (Guy, approved). Calling withLock directly would
// prove the promise chain serialises, which is a fact about the chain and not
// about the deployable. The claim being made is that TWO REQUESTS FOR ONE
// HOUSEHOLD cannot sync at once, and every part of that claim lives outside the
// class: the route, idFromName, the binding, the runtime's own concurrency.
// A unit test reaches past all of it. Same rule as a journey test starting
// where the household starts.
//
// THE COLLISION IS CONSTRUCTED, NOT HOPED FOR, AND THE TEST ABORTS RATHER THAN
// PASSES IF IT DOES NOT FORM. Firing two requests and asserting they did not
// overlap is a green tick over an empty set whenever the first finished before
// the second arrived, and on a fast machine that is most of the time. So the
// second request's arrival is OBSERVED from outside, through /observe, and a
// run where nothing ever waited is reported as a failed fixture rather than a
// passing control.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { dirname, resolve } from "node:path";

const PORT = 8788;
const BASE = `http://127.0.0.1:${PORT}/internal/sync-lock`;
const HOLD_MS = 1200;

let server: ChildProcess;

interface Observation { inside: number; concurrent: number; maxObserved: number }

const observe = (household: string): Promise<Observation> =>
  fetch(`${BASE}/${household}/observe`).then((r) => r.json() as Promise<Observation>);

const sync = (household: string, path: "sync" | "sync-unlocked", holdMs: number) =>
  fetch(`${BASE}/${household}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ holdMs }),
  }).then((r) => r.json() as Promise<{ ran: boolean }>);

/** Fires two overlapping requests and WATCHES FROM OUTSIDE while they run.
 *  Returns the peaks rather than the endpoint's own account of itself. */
async function collide(household: string, path: "sync" | "sync-unlocked") {
  const both = Promise.all([sync(household, path, HOLD_MS), sync(household, path, HOLD_MS)]);
  const samples: Observation[] = [];
  for (let i = 0; i < 10; i++) {
    samples.push(await observe(household));
    await new Promise((r) => setTimeout(r, HOLD_MS / 6));
  }
  await both;
  const final = await observe(household);
  return {
    peakInside: Math.max(...samples.map((s) => s.inside)),
    peakConcurrent: Math.max(...samples.map((s) => s.concurrent)),
    maxObserved: final.maxObserved,
  };
}

beforeAll(async () => {
  const serviceDir = resolve(__dirname, "..");
  server = spawn(
    resolve(serviceDir, "node_modules/.bin/wrangler"),
    ["dev", "--port", String(PORT), "--local", "--inspector-port", "0"],
    {
      cwd: serviceDir,
      stdio: "ignore",
      // Harness shells do not carry Node on PATH; wrangler's shim needs it.
      env: { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}` },
    }
  );
  for (let i = 0; i < 120; i++) {
    try {
      await observe("boot");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`wrangler dev did not answer on ${PORT} within 60s`);
}, 90_000);

afterAll(() => { server?.kill("SIGTERM"); });

describe("the household sync lock", () => {
  it("serialises two concurrent syncs for one household", async () => {
    const { peakInside, peakConcurrent, maxObserved } = await collide("household-locked", "sync");

    // THE FIXTURE ASSERTION, AND IT COMES FIRST. If the two requests never
    // overlapped, the run measured a queue of one, and an exclusion assertion
    // over that is zero evidence wearing a green tick.
    //
    // IT COUNTS ARRIVALS, NOT WAITERS, and that distinction was paid for. The
    // first version read a queue depth the lock itself maintained, so planting
    // against the lock made this guard fail instead of the assertion below:
    // "the collision never formed" when it had formed and the lock was gone.
    // A guard that the mutation can silence sends the reader to re-run rather
    // than to look.
    expect(peakConcurrent, "the collision never formed: nothing measured").toBeGreaterThanOrEqual(2);

    expect(peakInside).toBe(1);
    expect(maxObserved).toBe(1);
  }, 60_000);

  it("shows the same harness observing two syncs at once when the lock is absent", async () => {
    // THE LIVE CONTROL. Without it the test above cannot distinguish "the lock
    // held" from "this harness cannot see overlap", and those produce the same
    // green. /sync-unlocked is the naive handler the spike measured, so an
    // observer that reports 1 here is broken rather than reassuring.
    const { peakInside, maxObserved } = await collide("household-unlocked", "sync-unlocked");
    expect(peakInside).toBe(2);
    expect(maxObserved).toBe(2);
  }, 60_000);

  it("gives each household its own object, so one household cannot block another", async () => {
    // idFromName is load-bearing. newUniqueId would hand every request its own
    // object and its own chain, serialising nothing, while every assertion
    // about a single household still passed.
    await Promise.all([sync("household-a", "sync", 0), sync("household-b", "sync", 0)]);
    const [a, b] = await Promise.all([observe("household-a"), observe("household-b")]);
    expect(a.maxObserved).toBe(1);
    expect(b.maxObserved).toBe(1);

    // And a name resolves to ONE object across requests: a fresh name has seen
    // nothing, which is what distinguishes per-name from per-request.
    expect((await observe("household-never-touched")).maxObserved).toBe(0);
  }, 60_000);
});

describe("the chain lock under a collision the network cannot produce", () => {
  it("serialises two units of work dispatched in the same tick", async () => {
    // THE MUTATION THAT PASSED. Extending the chain AFTER awaiting the
    // predecessor leaves a lock that still looks like one and serialises
    // nothing, and every HTTP test above stayed green against it: the window
    // is one microtask and two network arrivals are milliseconds apart.
    //
    // Concluding "too small to hit" would have been comfortable and wrong.
    // Sync work is dispatched from inside this object too, and a queue batch
    // calling withLock per item calls it twice in one tick.
    const r = await fetch(`${BASE}/household-internal/collide-internal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ holdMs: 300 }),
    });
    const { concurrentAtDispatch, maxObserved } = (await r.json()) as {
      concurrentAtDispatch: number;
      maxObserved: number;
    };

    // Fixture guard first, and it counts arrivals rather than the lock's own
    // state, for the reason recorded above.
    expect(concurrentAtDispatch, "both units were not in flight: nothing measured").toBe(2);
    expect(maxObserved).toBe(1);
  }, 60_000);
});
