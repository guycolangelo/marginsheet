-- =========================================================================
-- 0014_session_auth_method: a session records which credential class
-- established it.
--
-- WHY. identity-onboarding-spec §1, as tightened by Guy on 15 August 2026:
-- a phone change requires a PASSKEY when the member has one registered, and a
-- magic link is accepted only when no passkey exists. The phone is the
-- SIM-swap surface, so accepting an email-delivered link to change it lets
-- whoever controls the inbox move the security primitive. A passkey is bound
-- to hardware and cannot be forwarded.
--
-- Enforcing that requires knowing HOW the current session was established,
-- and Better Auth's session does not record it. This column does.
--
-- SERVER-WRITTEN ONLY. THIS IS THE WHOLE CONTROL.
--
-- The value is set by the sign-in path at the moment a session is created,
-- from what the server itself just verified. It is never read from a request
-- body, a header, a cookie, or any client-supplied field.
--
-- A client-supplied value would make the entire tightening ADVISORY: an
-- attacker holding a magic-link session would simply claim 'passkey' and the
-- phone change would be authorised by their own assertion. The guard would
-- still be there, the tests would still pass, and the control would be
-- decoration. There is no partial version of this rule. Either the server is
-- the only writer or the rule does not exist.
--
-- NULL means a session predating this column, and it is treated as the
-- WEAKEST class, never the strongest. An unknown provenance is not a passkey.
-- =========================================================================

-- TEXT with a CHECK, not an enum. Better Auth's generated Drizzle schema
-- declares this column as text and binds a text parameter, which a Postgres
-- enum column rejects at insert time. The adapter's shape wins here for the
-- same reason recorded in 0011: a schema that disagrees with its adapter is a
-- runtime failure wearing a house style. The CHECK does the constraining work
-- an enum would have done, and admits exactly two values so a third
-- credential class cannot appear without someone writing a rule for it.
ALTER TABLE "session" ADD COLUMN "auth_method" text
  CONSTRAINT session_auth_method_known CHECK ("auth_method" IN ('passkey', 'magic_link'));

COMMENT ON COLUMN "session"."auth_method" IS
  'Which credential class established this session. SERVER-WRITTEN ONLY, from what the server itself verified at sign-in: never from a request body, header, cookie, or any other client-supplied field. A client-supplied value would make the §1 phone-change tightening ADVISORY, because an attacker holding a magic-link session would simply claim passkey and authorise their own phone change; the guard and its tests would still pass while enforcing nothing. NULL means a session predating this column and is treated as the WEAKEST class, never the strongest.';

-- The app role writes it at sign-in and reads it at authorisation. It is
-- named explicitly rather than relying on the table-level grant, so that the
-- privilege is visible next to the column it protects.
GRANT SELECT ("auth_method"), INSERT ("auth_method"), UPDATE ("auth_method")
  ON TABLE "session" TO marginsheet_app;
