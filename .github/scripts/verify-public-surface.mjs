// Which Workers answer the public internet, asked of the internet.
//
// WHY THIS IS NOT A CONFIG TEST. services/sync/test/no-public-routes.test.ts
// reads wrangler.jsonc, and a config file is a report. It reported a boundary
// for the entire life of the Worker while marginsheet-sync answered 200 in
// production, because `workers_dev` was absent and absent means PUBLISHED.
// Both checks are kept: one fails at the moment the config is edited, this one
// fails at the moment the deployed surface disagrees with it.
//
// THE POSITIVE CONTROL IS THE LOAD-BEARING PART. This check's passing state is
// "nothing answered", which is also what a broken network, a DNS failure or an
// egress-blocked runner produces. Without evidence the prober can reach
// anything at all, an outage reports a perfect boundary. So a Worker declared
// PUBLIC must answer before any silence is believed, and if it does not, this
// exits non-zero saying it could not tell rather than saying all is well.
//
// That is the same shape as the sync lock's /sync-unlocked path: a harness
// that cannot observe the failure produces the same green as one that looked.

import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync("config/public-surface.json", "utf8"));
const { subdomain, environments, probe } = config;

const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CF_ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;

/** The newest version id for a script, or null with the reason.
 *
 *  WORKERS.DEV HAS TWO SURFACES AND THIS RESOLVES THE SECOND. Preview URLs are
 *  a WILDCARD: <version-prefix>-<script>.<subdomain>, one address per version
 *  ever deployed. Probing only the production hostname reports a boundary while
 *  every historical version stays reachable, which is what this check did until
 *  19 Aug 2026. */
async function latestVersion(script) {
  if (!CF_TOKEN || !CF_ACCOUNT) return { id: null, why: "CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID is not set" };
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/workers/scripts/${script}/versions`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${CF_TOKEN}` },
      signal: AbortSignal.timeout(20_000),
    });
    const body = await res.json();
    if (!res.ok || body.success === false) {
      return { id: null, why: `versions API said ${res.status}: ${JSON.stringify(body.errors ?? body).slice(0, 200)}` };
    }
    const items = body.result?.items ?? body.result ?? [];
    const newest = Array.isArray(items) ? items[0] : null;
    if (!newest?.id) return { id: null, why: "versions API returned no versions" };
    return { id: newest.id, why: "" };
  } catch (error) {
    return { id: null, why: String(error) };
  }
}

async function reachable(host) {
  const url = `https://${host}${probe.path}`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    const body = await response.text();
    // Our Worker answered only if the body carries the marker. A disabled
    // subdomain still returns a page, and its status is not distinctive.
    const ours = response.status === 200 && body.includes(probe.marker);
    return { ours, status: response.status, detail: body.slice(0, 160) };
  } catch (error) {
    return { ours: false, status: null, detail: String(error) };
  }
}

const targets = [];
for (const worker of config.workers) {
  for (const suffix of environments) {
    targets.push({ host: `${worker.name}${suffix}.${subdomain}`, worker, surface: "production" });
  }
}

const results = [];
for (const target of targets) {
  results.push({ ...target, ...(await reachable(target.host)) });
}

// THE PREVIEW SURFACE, asked separately because it is a different address.
const unresolved = [];
for (const worker of config.workers) {
  for (const suffix of environments) {
    const script = `${worker.name}${suffix}`;
    const { id, why } = await latestVersion(script);
    if (!id) {
      // COULD NOT TELL IS NOT SILENCE. A failed lookup produces exactly the
      // same "nothing answered" as a properly disabled preview surface, so it
      // is recorded as unresolved and fails the run rather than passing it.
      unresolved.push({ script, why });
      continue;
    }
    const host = `${id.slice(0, 8)}-${script}.${subdomain}`;
    results.push({ host, worker, surface: "preview", ...(await reachable(host)) });
  }
}

// THE POSITIVE CONTROL, evaluated before any conclusion is drawn from silence.
const shouldAnswer = results.filter((r) => r.worker.public);
const answered = shouldAnswer.filter((r) => r.ours);
if (shouldAnswer.length > 0 && answered.length === 0) {
  console.error("COULD NOT TELL. Every Worker declared public was silent too, so");
  console.error("this run has no evidence it can reach anything. A boundary is not");
  console.error("being reported from an unreachable network.");
  for (const r of shouldAnswer) console.error(`  ${r.host} -> status=${r.status} ${r.detail}`);
  process.exit(1);
}

if (unresolved.length > 0) {
  console.error("COULD NOT TELL whether the preview surface is closed, for:");
  for (const u of unresolved) console.error(`  ${u.script}: ${u.why}`);
  console.error("A version id is required to build a preview host. Not resolving one");
  console.error("looks identical to a closed preview surface, so this fails rather");
  console.error("than reporting a boundary it did not observe.");
  process.exit(1);
}

const exposed = results.filter((r) => !r.worker.public && r.ours);

console.log(`Probed ${results.length} hosts. Positive control: ${answered.length}/${shouldAnswer.length} public Workers answered.`);
for (const r of results) {
  const verdict = r.ours ? "ANSWERS" : "silent ";
  const expected = r.worker.public ? "public" : "PRIVATE";
  console.log(`  ${verdict}  ${expected.padEnd(7)} ${(r.surface ?? "").padEnd(10)} ${r.host}  (status ${r.status})`);
}

if (exposed.length > 0) {
  console.error("");
  console.error("A WORKER DECLARED PRIVATE IS ANSWERING THE PUBLIC INTERNET:");
  for (const r of exposed) {
    console.error(`  ${r.host}`);
    console.error(`    ${r.worker.why}`);
  }
  console.error("");
  console.error("Set \"workers_dev\": false for that environment in its wrangler.jsonc.");
  console.error("Absent is not off: Cloudflare publishes on workers.dev unless told not to.");
  process.exit(1);
}

console.log("\nEvery Worker declared private is unreachable, and the prober proved it could reach.");
