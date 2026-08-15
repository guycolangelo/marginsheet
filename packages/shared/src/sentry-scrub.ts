// The access-token scrubber (plaid-pipeline invariant 7, live from day one:
// M0 plan Task 0.6). Runs as Sentry beforeSend in both services. Anything
// that looks like credential material is redacted before an event leaves the
// worker. Patterns err toward over-scrubbing; a redacted breadcrumb is
// cheap, a leaked token is not.

const REDACTED = "[scrubbed]";

const SECRET_PATTERNS: RegExp[] = [
  // Plaid access tokens and item credentials
  /access-(sandbox|development|production)-[0-9a-f-]+/gi,
  // Postgres connection strings (Neon URLs carry passwords)
  /postgres(ql)?:\/\/\S+/gi,
  // Neon role passwords
  /npg_[A-Za-z0-9]+/g,
  // Anthropic keys
  /sk-ant-[A-Za-z0-9_-]+/g,
  // Stripe keys and webhook secrets
  /[srp]k_(test|live)_[A-Za-z0-9]+/g,
  /whsec_[A-Za-z0-9]+/g,
  // Bearer credentials wherever they appear in text
  /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/g,
];

// Header/field names whose values are always redacted regardless of content.
const SENSITIVE_KEYS = new Set([
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "cookie",
  "set-cookie",
  "password",
  "token",
  "access_token",
  "refresh_token",
  // Network identity. On Cloudflare, CF-Connecting-IP is the household's real
  // address, not the edge's; the others are the same value under different
  // proxy conventions. Found in a captured request-headers panel during the
  // 0.6 wiring proof, 15 Aug 2026. An IP is personal data under GDPR and
  // CCPA, and this product's requests come from households.
  "cf-connecting-ip",
  "cf-connecting-ipv6",
  "x-forwarded-for",
  "x-real-ip",
  "true-client-ip",
  "forwarded",
  // Coarse geolocation Cloudflare adds per request. Not needed to debug a
  // worker, and it is a location signal attached to a household's traffic.
  "cf-ipcountry",
  "cf-ipcity",
  "cf-region",
  "cf-postal-code",
]);

function scrubString(value: string): string {
  let out = value;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, REDACTED);
  }
  return out;
}

function scrubValue(value: unknown, keyHint?: string): unknown {
  if (keyHint !== undefined && SENSITIVE_KEYS.has(keyHint.toLowerCase())) {
    return REDACTED;
  }
  if (typeof value === "string") return scrubString(value);
  if (Array.isArray(value)) return value.map((v) => scrubValue(v));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = scrubValue(v, k);
    }
    return out;
  }
  return value;
}

// Shaped as a Sentry beforeSend: takes the event, returns the scrubbed event.
// Generic so both services can pass their own Sentry event types through.
//
// The user context is dropped outright, not pattern-scrubbed. Sentry's ingest
// resolves an ip_address from the connecting hop even with sendDefaultPii
// false (observed 15 Aug 2026 during the 0.6 wiring proof). An IP is personal
// data under GDPR and CCPA; this product's users are households and their
// financial lives. Identity in Sentry, when it is ever needed, arrives as a
// household id set deliberately, never as a network address inferred by a
// vendor's default.
export function scrubEvent<T>(event: T): T {
  const scrubbed = scrubValue(event) as T;
  if (scrubbed !== null && typeof scrubbed === "object") {
    delete (scrubbed as Record<string, unknown>).user;
  }
  return scrubbed;
}
