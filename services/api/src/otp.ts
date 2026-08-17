// Phone OTP for the recovery path (M3 task 3.1b).
//
// THE PHONE IS A SECURITY PRIMITIVE, NEVER A LOGIN METHOD (§1). Approving an
// OTP proves possession of the number and produces a VERDICT. It never
// produces a session, and nothing here returns anything session-shaped. The
// decoupling probe established that empirically against live Twilio on 15 Aug
// 2026: an approved verification returned a verdict and no session-shaped
// field. This module must not become the place that quietly changes that.
//
// THE SENDER IS AN INTERFACE, deliberately, the same shape as EmailSender.
// That is what let 3.2a go green before the Postmark token was pasted, and it
// is why this task is not blocked on the Twilio account still being a trial
// with caller-ID restrictions. The recording fake proves the flow; Twilio
// Verify proves the delivery, and the two are exercised at different times.
//
// WHY VERIFY RATHER THAN SENDING OUR OWN CODES. Twilio Verify owns code
// generation, expiry, attempt limits and delivery. Rolling our own would mean
// storing codes we would then have to protect, and re-implementing rate
// limiting that already exists. It also keeps the A2P messaging numbers, which
// belong to the brains, out of the security path entirely.

export interface OtpSender {
  /** Starts a verification for a number. Returns nothing about the code. */
  send(phone: string): Promise<void>;
  /**
   * Checks a code against a number.
   *
   * Returns a BOOLEAN VERDICT and nothing else, by design. A richer return
   * type is how a "session-shaped field" arrives: the caller must not be able
   * to learn anything from an approval except that it was approved.
   */
  check(phone: string, code: string): Promise<boolean>;
}

/** Records instead of sending. Tests assert against this; production never sees it. */
export class RecordingOtpSender implements OtpSender {
  readonly sent: { phone: string; code: string }[] = [];

  async send(phone: string): Promise<void> {
    // A per-number code, so a test can present the WRONG number's code and be
    // refused. A single shared code would make the cross-account control
    // untestable, which is the control this whole task is built around.
    const code = String(Math.floor(100000 + Math.random() * 900000));
    this.sent.push({ phone, code });
  }

  /** The code most recently sent to a number, for tests to present. */
  codeFor(phone: string): string | undefined {
    return [...this.sent].reverse().find((s) => s.phone === phone)?.code;
  }

  async check(phone: string, code: string): Promise<boolean> {
    const expected = this.codeFor(phone);
    return Boolean(expected) && expected === code;
  }
}

export function twilioVerifySender(
  accountSid: string,
  authToken: string,
  serviceSid: string
): OtpSender {
  const base = `https://verify.twilio.com/v2/Services/${serviceSid}`;
  const auth = `Basic ${btoa(`${accountSid}:${authToken}`)}`;

  const post = async (path: string, form: Record<string, string>) => {
    const res = await fetch(`${base}/${path}`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
    });
    return { ok: res.ok, status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  return {
    async send(phone) {
      const { ok, status, body } = await post("Verifications", { To: phone, Channel: "sms" });
      if (!ok) {
        // Twilio's code and message are operational detail about OUR account,
        // not household data, so they are included. The NUMBER is not: a
        // failed send is an operational fact, and whose number it was for is
        // not something to scatter into logs. Same rule as the Postmark sender.
        throw new Error(`Twilio Verify rejected the send: HTTP ${status} (code ${body.code ?? "unknown"})`);
      }
    },

    async check(phone, code) {
      const { ok, body } = await post("VerificationCheck", { To: phone, Code: code });
      // A wrong code is a 404 from Twilio, not an error condition for us: it
      // is a verdict of "no". Only the approved status is a yes, and nothing
      // else from the response crosses this boundary.
      return ok && body.status === "approved";
    },
  };
}
