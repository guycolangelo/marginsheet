// The Plaid call path (M4 task 4.2.5).
//
// INVARIANT 7, AS AMENDED 18 Aug 2026: the access token is in the REQUEST, not
// the response. Seven Plaid error classes captured from Sandbox return an
// identical seven-key envelope with no nesting, no request echo and no
// credential, so nothing Plaid sends back can leak a token. THE EXPOSURE IS
// ANYTHING OF OURS THAT SERIALISES WHAT WE SENT.
//
// That is not hypothetical in this codebase. On 17 Aug 2026 the postgres driver
// formatted a failed connection into an exception and printed a database
// password in full into a transcript. A library that puts what you sent into an
// error message has already happened here, once.
//
// So this module is the ONE place a Plaid request is constructed, and the error
// it throws is built by hand rather than by wrapping something that has seen
// the request body.

export class PlaidError extends Error {
  readonly status: number;
  readonly errorType: string | null;
  readonly errorCode: string | null;
  readonly requestId: string | null;
  readonly endpoint: string;

  constructor(endpoint: string, status: number, body: Record<string, unknown>) {
    // The message is composed from Plaid's OWN fields and never from the
    // request. Nothing here has access to the body we sent.
    super(
      `Plaid ${endpoint} failed: ${status} ${body.error_code ?? "unknown"} ${body.error_message ?? ""}`.trim()
    );
    this.name = "PlaidError";
    this.endpoint = endpoint;
    this.status = status;
    this.errorType = typeof body.error_type === "string" ? body.error_type : null;
    this.errorCode = typeof body.error_code === "string" ? body.error_code : null;
    this.requestId = typeof body.request_id === "string" ? body.request_id : null;
  }

  /** What may be logged or sent to Sentry. Enumerated, never the whole object.
   *
   * Enumerating is the same shape as the column grants in 0002 and the table
   * grants in 0023: naming what may be included fails closed on a field
   * somebody adds later, where redacting known-sensitive keys fails open on
   * everything nobody thought of. */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      endpoint: this.endpoint,
      status: this.status,
      errorType: this.errorType,
      errorCode: this.errorCode,
      requestId: this.requestId,
    };
  }
}

export interface PlaidCredentials {
  clientId: string;
  secret: string;
  /** Overrides the per-call deadline. Present for tests, which cannot wait 30
   *  seconds to observe a timeout, and deliberately not plumbed to any Worker:
   *  a deadline that each caller chooses is a deadline nobody owns. */
  deadlineMs?: number;
  /** Defaults to Sandbox. THE DEFAULT LIVES HERE, not in the Worker entry
   *  point, because plaid-call-sites.test.ts requires exactly one module to
   *  look like a Plaid call site. Naming the host anywhere else makes that
   *  enumeration fire, and it fired: the first version of 4.3.2 put this
   *  default in index.ts. The control was right and the code moved. */
  baseUrl?: string;
}

const DEFAULT_BASE_URL = "https://sandbox.plaid.com";

/** 30 SECONDS, PER OUTBOUND CALL (Guy, 21 Aug 2026).
 *
 *  PER CALL RATHER THAN PER PAGE OR PER SYNC, and the reason is the watchdog's
 *  lesson in a different place: THE RISK IS A HUNG CALL, AND A HUNG CALL IS A
 *  PROPERTY OF ONE REQUEST RATHER THAN OF THE BATCH IT SITS IN. A per-sync
 *  budget would kill a healthy four page backfill on a slow night, which is
 *  exactly the elapsed-versus-progress mistake: a slow sync is not a stuck
 *  sync, and the deadline should bound the thing that can hang rather than the
 *  thing that can legitimately take a while.
 *
 *  30 SECONDS BECAUSE OF WHAT WAS OBSERVED, and the figures are here so the
 *  next person raising this argues against data rather than against a number.
 *  Across five real production syncs on 20 and 21 Aug 2026, Plaid returned in
 *  well under a second every time: a single /transactions/sync page of 201
 *  transactions, a four page run of 1560, and a /transactions/get sweep of 1560
 *  across four pages of 500, all completing inside a few seconds END TO END.
 *  30 is roughly two orders of magnitude of headroom, and anything past it is
 *  not slowness. */
const DEADLINE_MS = 30_000;

/** Calls Plaid. THE ONLY PLACE A REQUEST BODY CARRYING A TOKEN IS BUILT.
 *
 * The body is constructed inside the call and is never attached to anything
 * that escapes: not to the error, not to a retry envelope, not to a return
 * value. A caller cannot obtain it, which is what makes the probe's assertion
 * possible to keep true as the pipeline grows. */
export async function callPlaid<T>(
  endpoint: string,
  credentials: PlaidCredentials,
  params: Record<string, unknown>
): Promise<T> {
  const body = JSON.stringify({
    client_id: credentials.clientId,
    secret: credentials.secret,
    ...params,
  });

  // THE DEADLINE ABORTS THE REQUEST. It does not stop waiting for it.
  //
  // Promise.race against a timer IS NOT A TIMEOUT: it stops WAITING, not
  // WORKING. The hung call keeps running, can still write, and can still hold
  // whatever it was holding, so a raced deadline is the release-the-lock horn
  // in better clothes and it reads as correct in review. That is the mutation
  // registered against this, and the control observes the OUTBOUND side,
  // because a test that only sees the caller settle cannot tell a cancelled
  // request from an abandoned one.
  //
  // AN EXPLICIT AbortController RATHER THAN AbortSignal.timeout, so the abort
  // is visible in the code as an action taken rather than a property declared.
  // The mutation removes an action; it cannot remove a property as legibly.
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), credentials.deadlineMs ?? DEADLINE_MS);

  let response: Response;
  try {
    response = await fetch(`${credentials.baseUrl ?? DEFAULT_BASE_URL}${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: controller.signal,
    });
  } catch (cause) {
    // A DEADLINE AND A NETWORK FAILURE ARE DIFFERENT FINDINGS AND MUST NOT
    // SHARE A CODE. One means the far side never answered within a bound we
    // chose; the other means the request did not leave. Collapsing them is a
    // message that cannot distinguish its causes, which this file already has
    // a rule about.
    if (controller.signal.aborted) {
      throw new PlaidError(endpoint, 0, {
        error_code: "DEADLINE_EXCEEDED",
        error_message: `no response within ${credentials.deadlineMs ?? DEADLINE_MS}ms; the request was aborted`,
      });
    }
    // A TRANSPORT FAILURE IS THE DANGEROUS ONE. fetch rejects with an error
    // whose shape we do not control, and attaching `cause` here would hand a
    // caller whatever the runtime chose to put in it. It is deliberately
    // dropped and replaced with a message naming only the endpoint.
    throw new PlaidError(endpoint, 0, {
      error_code: "NETWORK_ERROR",
      error_message: "the request did not complete",
    });
  } finally {
    // The timer is cleared on EVERY exit, including the successful one. A
    // pending timer holds the runtime alive and would abort a controller
    // nothing is listening to any more.
    clearTimeout(deadline);
  }

  const parsed = (await response.json()) as Record<string, unknown>;
  if (response.status >= 400) throw new PlaidError(endpoint, response.status, parsed);
  return parsed as T;
}
