-- =========================================================================
-- 0012_no_network_identity: the session table stores no IP and no user agent.
--
-- RULED BY GUY, 15 August 2026. MarginSheet holds no network identity for
-- households. Sentry was stripped of it in three layers including an
-- org-level setting, and a session table storing IP and user agent makes that
-- principle false in a different store. "We only keep it for security" is the
-- sentence every company says before a breach discloses it.
--
-- WHAT THIS COSTS, ACCEPTED KNOWINGLY: no sign-in-from-a-new-device
-- detection, no IP-based anomaly signals, weaker forensics if an account is
-- ever compromised. Real security tools, traded for not holding the data. Any
-- future control needing one of them is a ruling with a named purpose, never
-- a default that accumulated.
--
-- WHY A TRIGGER AND NOT REVOKED COLUMN PRIVILEGES.
--
-- The ruling said to configure it off, and to revoke the column privileges if
-- it could not be configured off, the same way account.password is handled.
-- Better Auth has a flag for IP (advanced.ipAddress.disableIpTracking) and
-- NONE for user agent, which it reads from the header unconditionally. So the
-- fallback mattered, and it was tested on a throwaway branch on 15 Aug 2026:
--
--   Revoking INSERT on these two columns BREAKS SESSION CREATION.
--
-- Better Auth's adapter names ip_address in its INSERT column list, so
-- withholding the privilege does not quietly store a null, it fails the
-- insert. That is an outage, not a control: authentication stops working
-- entirely, which protects the data by removing the product.
--
-- (Note for anyone repeating that test: revoking a COLUMN privilege while the
-- role still holds the TABLE-level privilege is a no-op in Postgres. The
-- first run of this experiment "passed" for exactly that reason and proved
-- nothing. The table grant must be dropped and the columns enumerated.)
--
-- A trigger achieves what the ruling wanted and the revoke could not: the
-- write succeeds, and the values are never stored. It is structural, it
-- cannot be flipped by configuration, and unlike the privilege approach it
-- cannot be bypassed by a future Better Auth upgrade that stops naming the
-- column.
-- =========================================================================

CREATE OR REPLACE FUNCTION strip_network_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.ip_address := NULL;
  NEW.user_agent := NULL;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION strip_network_identity() IS
  'Forces session.ip_address and session.user_agent to NULL on every write. The application is also configured not to collect the IP, but configuration is a setting somebody can flip and this is not. Never drop this to enable a feature: storing network identity is a ruling, and reversing it is Guy''s, not a migration author''s.';

CREATE TRIGGER session_no_network_identity
  BEFORE INSERT OR UPDATE ON "session"
  FOR EACH ROW
  EXECUTE FUNCTION strip_network_identity();

-- Any rows written before this migration are cleared. There are none in any
-- environment today, and this is written to be true regardless.
UPDATE "session" SET ip_address = NULL, user_agent = NULL
 WHERE ip_address IS NOT NULL OR user_agent IS NOT NULL;
