# The imperative sweep

Regenerates `docs/imperative-inventory.md`'s data. **A survey nobody can re-run is a
snapshot that goes stale**, and the inventory's whole claim is that it reflects the
codebase now.

```bash
node scripts/imperative-sweep/1-extract-blocks.mjs   # comment blocks carrying an imperative
node scripts/imperative-sweep/2-classify.mjs         # ENFORCED / UNKNOWN / ADVISORY
node scripts/imperative-sweep/3-mechanism-claims.mjs # the actionable cut
```

Writes intermediates to `.sweep/`, which is not committed.

**Read the method's limits in the inventory's section 1 before trusting a number.**
Two are load-bearing: an obligation phrased without a verb is invisible to the
wordlist, and claim-level enforcement is not machine-decidable, which is why
UNKNOWN exists and is large.
