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
  readonly errorMessage: string | null;
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
    // THE FIELD THAT NAMES THE PROBLEM. INVALID_FIELD reports which field is
    // wrong here and nowhere else, so withholding it turns a precise error into
    // a guessing exercise.
    this.errorMessage = typeof body.error_message === "string" ? body.error_message : null;
    this.requestId = typeof body.request_id === "string" ? body.request_id : null;
  }

  /** What may be logged or sent to Sentry. Enumerated, never the whole object.
   *
   * Enumerating is the same shape as the column grants in 0002 and the table
   * grants in 0023: naming what may be included fails closed on a field
   * somebody adds later, where redacting known-sensitive keys fails open on
   * everything nobody thought of. */
  /** What may be published. ENUMERATED RATHER THAN SPREAD, because a raw error
   *  must never be returned: the REQUEST is what carries the token, so anything
   *  of ours that serialises what we sent is the real exposure.
   *
   *  errorMessage IS INCLUDED, AND ITS ABSENCE WAS A FINDING. This enumeration
   *  withheld it, guarding against an error body echoing a credential. The
   *  seven-class capture from Sandbox had already shown that does not occur:
   *  an identical seven-key envelope, no nesting, no request echo, and NO
   *  CREDENTIAL EVEN IN THE ERROR WHOSE ENTIRE SUBJECT IS A BAD SECRET.
   *
   *  THE COST LANDED ON THE FIRST REAL DIAGNOSIS. Plaid's INVALID_FIELD names
   *  the offending field in error_message and nowhere else, so the first
   *  production link token failure on 20 Aug 2026 reported INVALID_FIELD with
   *  the field withheld, and the only way forward was to reproduce the call
   *  outside the system.
   *
   *  A guard aimed at a shape that does not occur costs nothing until it costs
   *  a diagnosis, and produces no signal in between. That is why the study
   *  existing did not cause anybody to revisit this. */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      endpoint: this.endpoint,
      status: this.status,
      errorType: this.errorType,
      errorCode: this.errorCode,
      errorMessage: this.errorMessage,
      requestId: this.requestId,
    };
  }
}

export interface PlaidCredentials {
  clientId: string;
  secret: string;
  /** Defaults to Sandbox. THE DEFAULT LIVES HERE, not in the Worker entry
   *  point, because plaid-call-sites.test.ts requires exactly one module to
   *  look like a Plaid call site. Naming the host anywhere else makes that
   *  enumeration fire, and it fired: the first version of 4.3.2 put this
   *  default in index.ts. The control was right and the code moved. */
  baseUrl?: string;
}

const DEFAULT_BASE_URL = "https://sandbox.plaid.com";

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

  let response: Response;
  try {
    response = await fetch(`${credentials.baseUrl ?? DEFAULT_BASE_URL}${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
  } catch (cause) {
    // A TRANSPORT FAILURE IS THE DANGEROUS ONE. fetch rejects with an error
    // whose shape we do not control, and attaching `cause` here would hand a
    // caller whatever the runtime chose to put in it. It is deliberately
    // dropped and replaced with a message naming only the endpoint.
    throw new PlaidError(endpoint, 0, {
      error_code: "NETWORK_ERROR",
      error_message: "the request did not complete",
    });
  }

  const parsed = (await response.json()) as Record<string, unknown>;
  if (response.status >= 400) throw new PlaidError(endpoint, response.status, parsed);
  return parsed as T;
}
