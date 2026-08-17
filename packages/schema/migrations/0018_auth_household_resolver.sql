-- =========================================================================
-- 0018_auth_household_resolver (M3 task 3.1a).
--
-- !!! THIS IS THE FIRST DELIBERATE HOLE IN THE RLS BOUNDARY. !!!
--
-- It will be cited as precedent, so what it escapes and why is written down
-- here rather than inferred later.
--
-- WHAT IT ESCAPES. `members` carries the household_isolation policy, which
-- filters on the marginsheet.household_id GUC. That creates a circle for every
-- request-scoped read in the product: a session identifies a USER, the member
-- row says which HOUSEHOLD that user belongs to, and the member row cannot be
-- read until the household is already known. 0011 named this shape for Better
-- Auth's own tables ("a policy that filtered sessions by household would make
-- authentication depend on knowing the answer authentication produces"); here
-- it bites `members` itself.
--
-- This function runs as its owner rather than as the caller, so it can answer
-- exactly one question through the policy: which household does this auth user
-- belong to. Nothing else crosses.
--
-- WHY NOTHING NARROWER WORKS. Two alternatives were considered and refused
-- (Guy, 17 Aug 2026), on failure mode rather than surface area:
--
--   A policy permitting a self-lookup by auth_user_id against a second GUC
--   would work, and it depends on the application setting that GUC correctly
--   on every request forever. A control that depends on remembering is the
--   shape this build has spent a week removing.
--
--   Denormalising household_id onto the session row would work, and it creates
--   a second source of truth that must stay correct across every membership
--   change. Two places that must agree eventually disagree.
--
-- One function, reviewed once, that cannot be got wrong per request.
--
-- ADDING A SECOND SECURITY DEFINER FUNCTION IS A RULING, NOT AN
-- IMPLEMENTATION DETAIL. This one exists because authentication cannot
-- bootstrap without it. Any future one must show the same: that the thing it
-- needs is genuinely unobtainable inside the policy, not merely awkward. "We
-- also needed X" is how an RLS boundary becomes advisory one convenience at a
-- time. The test suite asserts this is the only one.
--
-- WHAT IT DELIBERATELY IS NOT:
--   * not a member lookup: it returns a uuid, never a row
--   * not an authorization check: it answers "which household", never "may
--     they". Every caller still runs under RLS afterwards
--   * not a general escape: setting the GUC from its result gives the caller
--     exactly the access the policy already intended
--
-- It IS an oracle mapping an auth user id to a household id for whoever can
-- execute it, which is why EXECUTE is enumerated to one role below. A
-- household id is an opaque uuid that grants nothing on its own; the policy
-- still stands between it and any row.
--
-- search_path is pinned empty and every name is schema-qualified. An
-- unqualified name inside a SECURITY DEFINER function is resolved against the
-- CALLER's search_path, which is how these become privilege escalation.
-- =========================================================================

CREATE FUNCTION public.auth_household_id(p_auth_user_id text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT m.household_id
    FROM public.members m
   WHERE m.auth_user_id = p_auth_user_id
     AND m.status = 'active'
   LIMIT 1
$$;

COMMENT ON FUNCTION public.auth_household_id(text) IS
  'Resolves an auth user id to their household id, running as owner so it can see past household_isolation. The FIRST deliberate hole in the RLS boundary, and deliberately one id wide: it returns a uuid, never a row, and answers "which household" rather than "may they". It exists because authentication cannot bootstrap otherwise: a session identifies a user, the member row says which household, and the member row cannot be read until the household is known. Adding a second SECURITY DEFINER function is a ruling of Guy''s, not an implementation detail. Only active members resolve; a removed member resolves to NULL and their caller gets nothing.';

-- Privileges are ENUMERATED, not granted broadly, the same posture as the
-- Plaid token column in 0002 and account.password in 0011. Postgres grants
-- EXECUTE to PUBLIC by default on new functions, which for a SECURITY DEFINER
-- function means every role including marginsheet_sync. That default is
-- revoked first and then one role is named.
REVOKE ALL ON FUNCTION public.auth_household_id(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_household_id(text) TO marginsheet_app;

-- marginsheet_sync gets nothing, deliberately. The Plaid sync worker is given
-- its household context by the job it is running, and has no session to
-- resolve. A worker that could resolve arbitrary users to households would be
-- able to enumerate the membership table one id at a time.
