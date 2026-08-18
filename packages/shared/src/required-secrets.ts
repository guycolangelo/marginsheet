// Which secrets a Worker must hold NON-EMPTY, derived from the declaration.
//
// WHY THIS IS SHARED. Three Workers now need the same logic, and a second
// hand-written copy of a requirement drifts by default: config/worker-secrets
// .json said sync/production holds two, a hardcoded list in the sync Worker
// said four, both were correct when written, and the first deploy that
// exercised both failed. Derive, never duplicate.
//
// NOT A BREACH OF THE INDEPENDENT-EXPECTATION RULE. That rule forbids a CHECK
// reading its expectation from its SUBJECT. Here the declaration is the single
// statement of what should be present, and two different checks examine two
// different properties of it: secret-inventory compares the declared NAMES
// against what Cloudflare holds, and this compares the declared names against
// what is NON-EMPTY at runtime.
//
// WHY THE WORKER AND NOT THE INVENTORY. `wrangler secret list` returns
// {name, type} and never a value or a length, so a secret set to the empty
// string passes the inventory perfectly. That is the 15 Aug 2026 incident: six
// connection strings held the empty string while every environment reported
// healthy. The Worker is the only thing that can see the value.

import declaration from "../../../config/worker-secrets.json";

type Declaration = { workers: Record<string, Record<string, string[]>> };

export function requiredSecrets(worker: string, environment: string): string[] {
  const declared = (declaration as Declaration).workers[worker]?.[environment];
  if (!declared) {
    // Fails closed. A deploy that stops beats one that verifies nothing, and an
    // environment the declaration has never heard of is exactly the case where
    // an empty list would look like success.
    throw new Error(
      `config/worker-secrets.json declares no secrets for ${worker}/${environment}`
    );
  }
  return declared;
}

/** Booleans only. No length, no prefix, no part of any value, ever. */
export function secretPresence(
  worker: string,
  environment: string,
  env: Record<string, unknown>
): Record<string, boolean> {
  return Object.fromEntries(
    requiredSecrets(worker, environment).map((name) => [
      name,
      typeof env[name] === "string" && (env[name] as string).length > 0,
    ])
  );
}
