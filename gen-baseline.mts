import { unbackedClaims } from "./packages/lint/src/mechanism-claims.js";
import { readFileSync, writeFileSync } from "node:fs";
const claims = unbackedClaims(process.cwd(), ["services", "packages", "scripts", ".github/scripts", "apps"]);
const keys = [...new Set(claims.map((c) => c.key))].sort();
const doc = JSON.parse(readFileSync("config/mechanism-claim-baseline.json", "utf8"));
if (keys.length > doc.count) { console.error(`REFUSING: baseline would GROW ${doc.count} -> ${keys.length}. The ratchet only shrinks.`); process.exit(1); }
writeFileSync("config/mechanism-claim-baseline.json", JSON.stringify({ ...doc, count: keys.length, claims: keys }, null, 2) + "\n");
console.log(`after: ${keys.length}`);
