// Verifies the Cloudflare edge rate limiting rules against what the repo says.
//
// WHY THIS EXISTS. Per-source rate limiting lives at the Cloudflare edge, so
// that the client IP never reaches our code and MarginSheet takes no custody of
// network identity. That decision is correct and it creates a drift problem: a
// control living only in a dashboard is invisible to review and can be changed
// or deleted with nothing saying so. On 16 Aug 2026 the api.marginsheet.com
// route lived only in the Cloudflare UI, and the PR that moved it into the repo
// is the PR that broke production deploys, because nothing had ever reconciled
// the two.
//
// So the rule is declared in config/edge-rate-limits.json and this reads the
// live ruleset and compares. Drift is a red build rather than a discovery.
//
// THE THREE OUTCOMES ARE KEPT DISTINCT, and that is the whole design:
//
//   present and matching  -> pass
//   absent or altered     -> FAIL, naming what differs
//   cannot read           -> FAIL, naming the permission needed
//
// The third is the one that matters. A checker that cannot see the thing it
// guards must not report either answer: "green because the API said no" is the
// failure this build has spent a week removing, and "red, drift detected"
// would be a lie that sends someone hunting a rule that is fine.

const CONFIG = "config/edge-rate-limits.json";
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;

const fail = (...lines) => {
  for (const line of lines) console.error(line);
  process.exit(1);
};

let config;
try {
  const { readFileSync } = await import("node:fs");
  config = JSON.parse(readFileSync(CONFIG, "utf8"));
} catch (error) {
  fail(`Could not read ${CONFIG}: ${error.message}`);
}

if (!TOKEN) {
  fail(
    "CLOUDFLARE_API_TOKEN is not set, so the edge rules could not be checked.",
    "Refusing to report on rules this job never read."
  );
}

const url = `https://api.cloudflare.com/client/v4/zones/${config.zone_id}/rulesets/phases/http_ratelimit/entrypoint`;

let payload;
let status;
try {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  status = res.status;
  payload = await res.json();
} catch (error) {
  fail(`Could not reach the Cloudflare API: ${error.message}`, "Nothing was verified.");
}

// A 404 here means the phase entrypoint has never been created, which is what
// a zone with no rate limiting rules looks like. That is "absent", not
// "cannot read", and it is a legitimate red.
const noRulesYet = status === 404;

if (!noRulesYet && (status === 401 || status === 403)) {
  const detail = (payload?.errors ?? []).map((e) => `${e.code}: ${e.message}`).join("; ");

  // "Authentication error" is the same string whether the token is invalid,
  // valid but unscoped to this zone, or scoped to the zone but not to
  // rulesets. Those are three different fixes and one of them is not a
  // permission at all, so the check narrows it rather than guessing. Added
  // 16 Aug 2026 after two rounds of adding the wrong permission.
  const probe = async (path) => {
    try {
      const res = await fetch(`https://api.cloudflare.com/client/v4/${path}`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      return { ok: res.ok, status: res.status, body: await res.json() };
    } catch (error) {
      return { ok: false, status: 0, body: { errors: [{ message: error.message }] } };
    }
  };

  const identity = await probe("user/tokens/verify");
  const zone = await probe(`zones/${config.zone_id}`);

  const diagnosis = !identity.ok
    ? [
        "THE TOKEN ITSELF IS NOT VALID OR NOT ACTIVE.",
        "This is not a missing permission. The CLOUDFLARE_API_TOKEN secret in",
        "GitHub is stale, revoked, or belongs to a different token than the one",
        "that was edited. Editing a token's permissions in Cloudflare keeps its",
        "value; creating a new one does not, and the GitHub secret must be",
        "updated to match.",
      ]
    : !zone.ok
      ? [
          `THE TOKEN IS VALID BUT CANNOT SEE ZONE ${config.zone_id}.`,
          "Its zone resources do not include marginsheet.com, so no permission",
          "added to it will help until the zone is in its resource scope.",
        ]
      : [
          "THE TOKEN IS VALID AND CAN SEE THE ZONE, BUT NOT ITS RULESETS.",
          "So this is a permission scope on the Rulesets API specifically.",
          'Cloudflare has moved this: try "Zone -> Zone WAF -> Read" alongside',
          '"Firewall Services", and if the dashboard offers an explicit',
          '"Rulesets" or "Config Rules" group, that is the one. Edit rather than',
          "Read may also be required, since Cloudflare treats a phase entrypoint",
          "read as a management call on some plans.",
        ];

  fail(
    `The Cloudflare API refused this token (HTTP ${status}).`,
    detail ? `  ${detail}` : "",
    "",
    "NOTHING WAS VERIFIED. This is not a passing check and not a drift report.",
    "",
    `  token verify: HTTP ${identity.status}${identity.ok ? " ok" : " refused"}`,
    `  zone read:    HTTP ${zone.status}${zone.ok ? " ok" : " refused"}`,
    "",
    ...diagnosis
  );
}

if (!noRulesYet && (!payload?.success || status >= 400)) {
  const detail = (payload?.errors ?? []).map((e) => `${e.code}: ${e.message}`).join("; ");
  fail(`Cloudflare returned HTTP ${status}: ${detail || "no detail"}`, "Nothing was verified.");
}

const live = noRulesYet ? [] : (payload.result?.rules ?? []);
const problems = [];

for (const declared of config.rules) {
  const match = live.find((r) => normalise(r.expression) === normalise(declared.expression));

  if (!match) {
    problems.push(
      `MISSING: "${declared.description}"\n` +
        `    expression: ${declared.expression}\n` +
        `    ${declared.why}`
    );
    continue;
  }

  if (match.enabled === false) {
    problems.push(`DISABLED: "${declared.description}" exists but is switched off.`);
  }
  if (match.action !== declared.action) {
    problems.push(
      `CHANGED: "${declared.description}" action is "${match.action}", repo says "${declared.action}".`
    );
  }

  for (const [field, want] of Object.entries(declared.ratelimit)) {
    const got = match.ratelimit?.[field];
    const same = Array.isArray(want)
      ? JSON.stringify([...want].sort()) === JSON.stringify([...(got ?? [])].sort())
      : got === want;
    if (!same) {
      problems.push(
        `CHANGED: "${declared.description}" ratelimit.${field} is ${JSON.stringify(got)}, repo says ${JSON.stringify(want)}.`
      );
    }
  }
}

function normalise(expression) {
  return String(expression ?? "").replace(/\s+/g, " ").trim();
}

if (problems.length > 0) {
  fail(
    `The live edge rate limiting rules do not match ${CONFIG}:`,
    "",
    ...problems.map((p) => `  ${p}`),
    "",
    "These rules carry the per-source half of the magic-link send limits. Our own",
    "code holds the per-email and global limits and takes no custody of network",
    "identity, so if these are gone, spray from a single source is unlimited."
  );
}

console.log(
  `All ${config.rules.length} declared edge rate limiting rule(s) are present and unaltered on ${config.zone_name}.`
);
