// Commitment source authority (projection-spec §6).
//
// ONE implementation of the ordering, for the same reason there is one
// merchant normalization: comparing sources by inlining a different order
// somewhere is how two writers end up disagreeing about which fact wins.

/**
 * Ascending authority. Higher overrides lower PER STREAM.
 *
 * "Per stream" is load-bearing: authority is compared within one upsert key
 * (household, merchant_key, direction, cadence, account), never across the
 * table. A census correction to the electric bill says nothing about the
 * mortgage.
 */
export const COMMITMENT_SOURCE_AUTHORITY = {
  /** Day-one bootstrap. A commitments list exists at first sync. */
  plaid_recurring: 1,
  /** M15. The long cadences Plaid misses; may correct a stream's cadence. */
  census: 2,
  /** Exact statement balances and due dates. The statement is fact. */
  liability_detail: 3,
  /** A household plan with teeth. Always wins, matching local-always-wins. */
  household_stated: 4,
} as const;

export type CommitmentSource = keyof typeof COMMITMENT_SOURCE_AUTHORITY;

/**
 * Whether an incoming source may overwrite the stored one for the same
 * stream. Equal authority overwrites: a fresher fact from the same source
 * is still fresher.
 */
export function overrides(incoming: CommitmentSource, stored: CommitmentSource): boolean {
  return COMMITMENT_SOURCE_AUTHORITY[incoming] >= COMMITMENT_SOURCE_AUTHORITY[stored];
}
