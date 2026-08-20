// The household's sync Durable Object (M4 task 4.5).
//
// A DURABLE OBJECT IS NOT A LOCK, AND THE LOCK HERE IS EXPLICIT.
//
// plaid-pipeline-spec §3 originally read "the household's Durable Object owns
// sync execution... (replaces Base44's optimistic status checks with an actual
// lock)", and implemented as written that is false. Spike 1b measured three
// concurrent requests to one object id:
//
//   { "naive": 3, "blocking": 1, "chained": 1 }
//
// A DO gives single-threaded execution, not mutual exclusion. One object runs
// on one thread in one place, and a plain `fetch` handler still YIELDS AT EVERY
// AWAIT, so another request enters there. A sync awaits on every Plaid page and
// every database write, which means a naive handler is interleaved at every
// step: the DO would have reproduced Base44's race with more machinery, and the
// failure would have looked exactly like the thing it replaced.
//
// WHY THE CHAIN AND NOT blockConcurrencyWhile. Both serialise. The latter holds
// the whole object, including status reads, and is documented for
// initialisation; a Plaid sync held under it makes the object unresponsive for
// the length of the sync. The chain serialises the WORK while leaving other
// paths answerable.
//
// The DO is the right HOME for the lock. It is not itself one, and anyone
// reading "the DO owns sync execution" should not infer otherwise.

export interface SyncEnv {
  ENVIRONMENT: string;
}

/** What a caller learns about a sync it asked for.
 *
 *  DELIBERATELY NOT A QUEUE DEPTH. The first version returned `queuedBehind`,
 *  read inside the lock, and it was 0 for both requests of a colliding pair:
 *  the first because nobody had arrived yet, the second because nobody was
 *  behind it. Both correct, and a reader would have taken the pair of zeroes
 *  as evidence there was no collision when there had been one. Evidence of
 *  exclusion comes from /observe, which watches from outside. */
export interface SyncOutcome {
  ran: boolean;
}

export class HouseholdSync {
  /** THE LOCK. Every unit of work awaits the previous one's settlement before
   *  starting its own, so two arrivals cannot be inside the critical section
   *  at once however many times the work awaits internally.
   *
   *  Settled, not resolved: a rejected predecessor must not wedge the chain,
   *  so the tail is always caught. A lock that a single failure jams shut is
   *  worse than no lock, because it fails closed on everything forever. */
  private tail: Promise<unknown> = Promise.resolve();

  /** ARRIVAL COUNTERS, DELIBERATELY OUTSIDE THE LOCK. `arrived - departed` is
   *  how many requests are in this object at all, counted before the chain is
   *  touched and after it is released, so REMOVING THE LOCK CANNOT CHANGE THEM.
   *
   *  The first version had the test's fixture guard read a `waiting` count
   *  maintained by the lock itself. Planting against it went red for the wrong
   *  reason: with no lock nothing ever waits, so the guard reported "the
   *  collision never formed" when the collision had formed and the lock was
   *  gone. That message tells a reader to re-run, which is the habit that gets
   *  a real red ignored. A fixture guard must not be able to be silenced by
   *  the thing it is proving the fixture exercised. */
  private arrived = 0;
  private departed = 0;

  /** Proves mutual exclusion: how many are inside the critical section now.
   *  Maintained inside the lock, which is correct here, because this is the
   *  assertion rather than the guard. */
  private inside = 0;
  private maxObserved = 0;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: SyncEnv
  ) {}

  /** Runs `work` with the household's sync lock held. */
  async withLock<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    // The next arrival waits on THIS promise, so the chain is extended before
    // any awaiting happens. Extending it after the await is the bug that turns
    // a chain into no lock at all.
    this.tail = new Promise<void>((resolve) => { release = resolve; });

    // A predecessor that threw must not stop the chain moving.
    await previous.catch(() => undefined);

    this.inside += 1;
    this.maxObserved = Math.max(this.maxObserved, this.inside);
    try {
      return await work();
    } finally {
      // RELEASE IN `finally`, AND THAT IS THE WHOLE ANSWER TO CHAIN POISONING.
      // The tail is a fresh promise this resolves, never `previous.then(work)`,
      // so a task that REJECTS still settles the tail and the next caller runs.
      // Chained with `then`, one failed sync would leave every later caller for
      // that household inheriting a rejected promise: the household is locked
      // out until the object restarts, and it reads as a sync problem rather
      // than a lock problem.
      //
      // The caller still sees the rejection, because `await work()` throws
      // before this block runs. Failing loudly to the caller and releasing the
      // lock are not in tension; chaining is what puts them in tension.
      //
      // Enforced by household-sync-lock.test.ts, "a failed sync does not lock
      // the household out". Construction is not the control: this is one moved
      // line away from poisoning, and nothing but a test notices.
      this.inside -= 1;
      release();
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // GET /observe: what the lock has seen. Exists so a test can ASSERT
    // mutual exclusion rather than infer it from timing, which is the
    // difference between a constructed race and a hoped-for one.
    if (url.pathname === "/observe") {
      return Response.json({
        inside: this.inside,
        concurrent: this.arrived - this.departed,
        maxObserved: this.maxObserved,
      });
    }

    // POST /sync: the serialised path. The body's `holdMs` exists only so a
    // test can hold the lock long enough for a second request to arrive; real
    // callers omit it and the work is the sync itself.
    if (url.pathname === "/sync" && request.method === "POST") {
      const { holdMs = 0, fail = false } = (await request.json().catch(() => ({}))) as {
        holdMs?: number;
        fail?: boolean;
      };
      this.arrived += 1;
      try {
      const outcome = await this.withLock(async () => {
        if (holdMs > 0) await new Promise((r) => setTimeout(r, holdMs));
        // `fail` exists so a test can put a REJECTING task through the lock.
        // Real callers omit it and the work is the sync itself.
        if (fail) throw new Error("planted sync failure");
        return { ran: true } satisfies SyncOutcome;
      });
      return Response.json(outcome);
      } catch (error) {
        // The caller sees the failure. The lock does not keep it.
        return Response.json({ ran: false, error: (error as Error).message }, { status: 500 });
      } finally { this.departed += 1; }
    }

    // POST /collide-internal: TWO UNITS OF WORK DISPATCHED IN ONE TICK.
    //
    // THIS EXISTS BECAUSE A MUTATION PASSED. Moving `this.tail = ...` to AFTER
    // `await previous` turns the chain into no chain at all, and every HTTP
    // test above stayed green: two requests arriving over the network are
    // milliseconds apart, and the window that bug opens is ONE MICROTASK, so
    // nothing the network can deliver lands inside it.
    //
    // Reasoning that the window is too small to matter was the tempting answer
    // and it is wrong, because the pipeline dispatches sync work from INSIDE
    // this object as well as from the network. A queue batch or an alarm that
    // calls withLock per item calls it twice in one tick, which is exactly the
    // arrival the network cannot produce. So the collision is constructed here
    // rather than argued about.
    if (url.pathname === "/collide-internal" && request.method === "POST") {
      const { holdMs = 0 } = (await request.json().catch(() => ({}))) as { holdMs?: number };
      const hold = async () => {
        if (holdMs > 0) await new Promise((r) => setTimeout(r, holdMs));
      };
      this.arrived += 2;
      // No await between them: this is the whole point of the endpoint.
      const first = this.withLock(hold);
      const second = this.withLock(hold);
      const concurrentAtDispatch = this.arrived - this.departed;
      await Promise.all([first, second]);
      this.departed += 2;
      return Response.json({ concurrentAtDispatch, maxObserved: this.maxObserved });
    }

    // The naive path, kept ONLY so the planted failure has somewhere to point
    // and so the spike's measurement stays reproducible. Never routed to by
    // the pipeline: see household-sync-lock.test.ts, which asserts that the
    // sync path is the locked one.
    if (url.pathname === "/sync-unlocked" && request.method === "POST") {
      const { holdMs = 0 } = (await request.json().catch(() => ({}))) as { holdMs?: number };
      this.arrived += 1;
      this.inside += 1;
      this.maxObserved = Math.max(this.maxObserved, this.inside);
      if (holdMs > 0) await new Promise((r) => setTimeout(r, holdMs));
      this.inside -= 1;
      this.departed += 1;
      return Response.json({ ran: true } satisfies SyncOutcome);
    }

    return new Response("not found", { status: 404 });
  }
}
