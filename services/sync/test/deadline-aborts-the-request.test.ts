// The deadline ABORTS the request. It does not stop waiting for it.
//
// WHY THIS FIXTURE IS THE TASK RATHER THAN THE IMPLEMENTATION. Promise.race
// against a timer produces an identical caller experience: the promise rejects,
// the error says deadline, the sync gives up, the lock releases. Everything
// visible from inside the caller is the same. THE DIFFERENCE IS ENTIRELY ON THE
// OTHER SIDE OF THE SOCKET, where a raced call is still running, can still
// write, and still holds whatever it held.
//
// So a test that only observes the caller settle CANNOT distinguish a cancelled
// request from an abandoned one, and the mutation registered against this is
// specifically the version that looks right in review. This starts a real
// server, holds the request open, and asserts the server SAW the client go
// away. That assertion is the control; the rejection is not.
//
// A LOCK TIMEOUT IS ALWAYS A LIE (Guy, 19 Aug 2026): it asserts the holder is
// dead without knowing, and if the holder is alive it hands out the exact
// concurrency the lock exists to prevent. Bounding the OPERATION means the task
// always settles, the lock releases in its existing finally with no special
// path, and nothing ever has to decide whether a holder is dead, because it
// made it true rather than assuming it.

import { describe, it, expect, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { callPlaid, PlaidError } from "../src/plaid-client.js";

/** A server that accepts a request and never answers it, recording whether the
 *  client aborted. `aborted` fires when the client closes the connection
 *  before the response is sent, which is what an AbortController does and what
 *  a Promise.race does not. */
function hangingServer(): Promise<{ url: string; sawAbort: () => boolean; close: () => void }> {
  let aborted = false;
  let received = false;
  const server: Server = createServer((req) => {
    received = true;
    req.on("aborted", () => {
      aborted = true;
    });
    req.on("close", () => {
      // Node reports an aborted request as a close without a completed
      // response on some versions; both signals are accepted, and neither
      // fires when the caller merely stops waiting.
      if (!req.complete || req.destroyed) aborted = true;
    });
    // Deliberately no response, ever.
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        sawAbort: () => {
          expect(received, "the server never received the request, so this proves nothing").toBe(true);
          return aborted;
        },
        close: () => server.close(),
      });
    });
  });
}

const servers: Array<{ close: () => void }> = [];
afterAll(() => servers.forEach((s) => s.close()));

describe("a call that never answers", () => {
  it("rejects with DEADLINE_EXCEEDED rather than NETWORK_ERROR", async () => {
    const server = await hangingServer();
    servers.push(server);
    const error = await callPlaid("/item/get", { clientId: "x", secret: "y", baseUrl: server.url, deadlineMs: 300 }, {}).catch(
      (e) => e
    );
    expect(error, "the call resolved against a server that never answers").toBeInstanceOf(PlaidError);
    // A deadline and a network failure are different findings. Sharing a code
    // would make the message unable to distinguish its causes.
    expect((error as PlaidError).errorCode).toBe("DEADLINE_EXCEEDED");
  }, 10_000);

  it("makes the server see the client go away, which a race would not", async () => {
    // THE ASSERTION THAT IS THE CONTROL. Everything above passes against a
    // Promise.race. This does not.
    const server = await hangingServer();
    servers.push(server);
    await callPlaid("/item/get", { clientId: "x", secret: "y", baseUrl: server.url, deadlineMs: 300 }, {}).catch(() => undefined);

    // The abort travels over the socket, so give the event loop a moment to
    // deliver it. This is not a race in the test: the request was already
    // cancelled or it was not, and waiting only lets the server notice.
    await new Promise((r) => setTimeout(r, 200));

    expect(
      server.sawAbort(),
      "the server never saw the client disconnect, so the request was ABANDONED rather than CANCELLED. It is still running on the far side, can still write, and the deadline bounded the waiting rather than the work.",
    ).toBe(true);
  }, 10_000);
});
