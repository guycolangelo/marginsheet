// Transactional email for the auth flows (M3 task 3.2a).
//
// This is MarginSheet speaking as itself about access to an account. It is not
// a brain and it is not commercial voice: MyKeeper and MyCFO have their own
// Postmark identity and their own numbers, and Kit owns billing and offers.
// A sign-in link is neither, so it goes out plainly.
//
// The sender is an interface, deliberately. The flow is provable against a
// recording fake without a live Postmark token, which is what lets 3.2a go
// green before the real credential is pasted (sequence approved 15 Aug 2026).

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
}

export interface EmailSender {
  send(message: OutboundEmail): Promise<void>;
}

/** Records instead of sending. Tests assert against this; production never sees it. */
export class RecordingSender implements EmailSender {
  readonly sent: OutboundEmail[] = [];
  async send(message: OutboundEmail): Promise<void> {
    this.sent.push(message);
  }
}

// Postmark's Message can EMBED the recipient (the inactive-recipient errors
// do), so keeping the address out takes active removal rather than simply not
// adding it. "We did not include it" and "it is not there" are different
// claims, and only the second one is true after this runs.
function withoutRecipient(text: string, recipient: string): string {
  if (!recipient) return text;
  const local = recipient.split("@")[0];
  return text
    .split(recipient)
    .join("[recipient]")
    .split(local)
    .join("[recipient]");
}

export function postmarkSender(token: string, from: string): EmailSender {
  return {
    async send(message) {
      const res = await fetch("https://api.postmarkapp.com/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Postmark-Server-Token": token,
        },
        body: JSON.stringify({
          From: from,
          To: message.to,
          Subject: message.subject,
          TextBody: message.text,
          MessageStream: "outbound",
        }),
      });

      if (!res.ok) {
        // Postmark's ErrorCode and Message are operational detail about OUR
        // account, not household data, so they are included (ruled 16 Aug
        // 2026). A bare status code sent us hunting when the answer was one
        // string away: a live 422 in production said only "HTTP 422", which
        // is a family of causes rather than one.
        //
        // The recipient is still kept out. A failed send is an operational
        // fact; who it was for is not something to scatter into logs and
        // error trackers.
        let detail = " (no parseable body)";
        try {
          const body = (await res.json()) as { ErrorCode?: number; Message?: string };
          const code = body.ErrorCode ?? "unknown";
          const text = withoutRecipient(body.Message ?? "", message.to);
          detail = ` (ErrorCode ${code}: ${text})`;
        } catch {
          // Leave the fallback. A body we cannot parse is not worth guessing at.
        }
        throw new Error(`Postmark rejected the send: HTTP ${res.status}${detail}`);
      }
    },
  };
}

// The sign-in email.
//
// THE LINK CONSUMES NOTHING (ruled 15 Aug 2026). It opens a page where an
// explicit action completes the sign-in. Corporate email security scanners
// follow links before the human does, and a GET-consumed single-use token is
// burned by the scanner, so the member clicks a dead link on their first
// experience of the product. Guy's ruling: "your link expired" on a first
// sign-in is the kind of failure that ends the relationship before it starts.
//
// The copy reads as CONFIRMATION, not as an obstacle. A page that sounds like
// a challenge tells the member the product does not trust them. The extra
// click is the product finishing what they asked for.
export function magicLinkEmail(confirmUrl: string, minutes: number): Omit<OutboundEmail, "to"> {
  return {
    subject: "Your MarginSheet sign-in link",
    text: [
      "Here is your sign-in link.",
      "",
      confirmUrl,
      "",
      `Open it and confirm, and you are in. The link works for ${minutes} minutes and once only.`,
      "",
      "If you did not ask to sign in, nothing has happened and you can ignore this.",
    ].join("\n"),
  };
}
