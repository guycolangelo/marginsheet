# MarginSheet Spec Manifest — FINAL
## 14 August 2026, end of day. Spec phase: COMPLETE.

## The eleven documents

| # | Document | Governs | Status |
|---|---|---|---|
| 0 | CLAUDE.md | M0 + every task | ✅ Written today |
| 1 | ledger-spec.md | M6a | ✅ Extracted + rulings |
| 2 | projection-spec.md | M6b | ✅ Designed + rulings |
| 3 | categorization-spec.md | M5, informs M4 | ✅ Extracted + Publix amendment |
| 4 | data-model-spec.md | M1 | ✅ Merged |
| 5 | identity-onboarding-spec.md | M3, M7 | ✅ Designed (offer §3a parked) |
| 6 | plaid-pipeline-spec.md | M4 | ✅ Extracted + invariant |
| 7 | app-ui-spec.md | M8 → Claude Design brief | ✅ Contracts written |
| 8 | migration-spec.md | M9 | ✅ Written |
| 9 | conversation-service-spec.md | M10–M21 | ✅ Guy's, current |
| 10 | mycfo-mykeeper-conversational-spec.md | Voice, canon, M11–M12 | ✅ Guy's, current (2 pending amendments: short_but_covered register, correct_transaction fixture; + tenure field to FactPackageCore) |

## Rulings ledger (today)
14-day trial, card required · Full rebuild, no Base44 · Single Neon Postgres, D1 dropped · Better Auth, passwordless, Twilio Verify · Tiered model fallbacks · 1 Oct stretch / 1 Nov real, founder-OK + objective floor gate · Taxes After Takehome under fixed_obligations · Transfers never income; refunds net spending; reimbursements AR; gifts income · Uncategorized inflows count (total right, breakdown pending) · Margin Plan → Household Goals (stated vs computed split) · Likely layer ships, labeled · Cash Flow: all depository, per-account, 13 weeks, short_but_covered · Beta = repeating 100% coupon, card, exempt · Annual Planning Session included with subscription · Early-activation offer PARKED · Categories/rules/splits: optional doors, both surfaces, scope-explicit corrections

## Rulings ledger (15 August 2026)

**NET WORTH DOCTRINE, locked.** Net worth is never a hero metric and never celebrated; the Module 8 Balance Sheet reports position without scoring it; Margin is the only celebrated number, because Margin is the only number the household controls. The causal chain in all copy is control, then opportunity, then wealth, and only the first is promised. Full text in `CLAUDE.md`. Rules 1 and 2 are enforced in `packages/lint` (`no-net-worth-lead`, `no-net-worth-celebration`).

Also ruled today: M0 build rulings (merge authority, deferral ledger for live credentials, model registry aliases with MID_TIER corrected to claude-sonnet-5 on probe evidence), M1 schema rulings (chat_transcript ports as-is; no legacy specs survive, data-model-spec is authoritative; Plaid token key custody closed as Wrangler secrets; members.auth_user_id is a documented soft reference, no FK; consent_records stores consent language and contact point verbatim, append-only).

## Open on Guy's desk
1. **A2P 10DLC submission** (the clock that matters most)
2. **Cyber liability quotes ×4** (open Plaid MSA obligation today)
3. **Attorney hour, 8 items**
4. Early-activation strategy (parked, zero critical path)
5. Which of the 17 legacy specs survive (data-model's stated blind spot)
6. Plaid rate/tier/cap email · Kit domain + 3 senders · CFPB stat verification · site copy sweep (60→14, Amex demo, /security 404, taxes rendering)

## Next: M0 opens.
