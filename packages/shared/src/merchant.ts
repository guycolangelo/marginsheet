// The single canonical merchant normalization (categorization-spec §11,
// ledger-spec §8).
//
// THREE OPERATIONS KEY ON THIS ONE FUNCTION: correction matching, recurrence
// inheritance, and refund matching. There is exactly one implementation on
// purpose.
//
// THE BUG THIS FIXES: Base44 had two normalizations. Correction keying used a
// conservative normalize; history keying used a plain lowercase of the
// display name. The two silently disagreed, so recurrence inheritance and
// refund matching could miss what correction matching hit. Nothing errored,
// no test failed, learned records simply stopped applying, invisibly.
//
// CHANGING THIS BREAKS LEARNED RECORDS RETROACTIVELY. Every stored
// normalized_merchant_key, every merchant_correction, every commitment and
// refund pair was keyed with the rule as it stood when the row was written.
// "Improving" the normalization silently orphans a household's learned
// history. That is a migration with a backfill and a ruling, never a
// refactor.

/**
 * Business suffixes stripped from a merchant name before keying.
 *
 * Deliberately conservative: anything looser risks one merchant absorbing
 * another's classification, and the doctrine prefers asking the household to
 * guessing wrong.
 */
export const BUSINESS_SUFFIXES = [
  "inc",
  "llc",
  "corp",
  "co",
  "ltd",
  "llp",
  "pllc",
  "pc",
  "pa",
  "dba",
  "corporation",
  "company",
  "limited",
] as const;

const SUFFIX_PATTERN = new RegExp(
  String.raw`\b(?:${BUSINESS_SUFFIXES.join("|")})\b`,
  "gi"
);

// Apostrophes are removed outright rather than spaced, because they sit
// INSIDE a word: "Bob's Burgers" must key as "bobs burgers", not "bob s
// burgers". Covers the straight quote and both curly forms, since merchant
// feeds carry all three for the same merchant.
const APOSTROPHES = /['‘’ʼ]/g;

// Every other non-alphanumeric character becomes a SPACE rather than being
// deleted, because those sit BETWEEN words: "Shell/Circle K" must key as
// "shell circle k", not "shellcircle k". The two rules are deliberately
// different and a future author collapsing them into one will break one case
// or the other.
const PUNCTUATION = /[^\p{L}\p{N}\s]/gu;

/**
 * The canonical normalization, in this exact order:
 *   1. lowercase
 *   2. strip business suffixes
 *   3. strip punctuation (apostrophes removed, everything else spaced)
 *   4. collapse whitespace
 *
 * Order matters: suffixes are stripped before punctuation so that "Acme,
 * Inc." loses the suffix rather than becoming "acme inc" with the comma gone
 * and the suffix stranded mid-token.
 */
export function normalizeMerchantKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(SUFFIX_PATTERN, " ")
    .replace(APOSTROPHES, "")
    .replace(PUNCTUATION, " ")
    .replace(/\s+/g, " ")
    .trim();
}
