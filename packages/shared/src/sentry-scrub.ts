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
export function scrubEvent<T>(event: T): T {
  return scrubValue(event) as T;
}
