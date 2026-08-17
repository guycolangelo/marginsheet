-- =========================================================================
-- 0022_invitation_token_format: the invite prefix, made structural (3.5).
--
-- OWED SINCE 16 AUGUST. 3.2c gave every token kind a purpose prefix checked
-- before any lookup, and recorded that `invitations.token` had no constraint
-- requiring it. Until now that was harmless, because nothing minted an
-- invitation: 3.5 is the first issuer, so this is the moment the gap becomes
-- real rather than theoretical.
--
-- WHY A CONSTRAINT AND NOT JUST THE MINTING CODE. Domain separation is only
-- worth what enforces it. An issuer that wrote an unprefixed token would pass
-- every existing test: the consumer would refuse the value, which reads as
-- "invitation rejected" rather than "we minted it wrong", and the failure
-- would look like a bug in redemption. The constraint makes the format a
-- property of the row rather than a habit of the writer.
--
-- Same posture as the enumerated column grants: the database refuses what the
-- application is merely supposed to avoid.
--
-- Sign-in tokens live in Better Auth's `verification` and are the plugin's to
-- shape. Recovery tokens live in our `recovery_challenges` and could carry the
-- same constraint; noted as a follow-up rather than done here, because 3.1b's
-- issuer is the only writer and this migration is scoped to the kind whose gap
-- was recorded.
-- =========================================================================

ALTER TABLE "invitations"
  ADD CONSTRAINT "invitations_token_purpose_prefix"
  CHECK ("token" LIKE 'ms\_invite\_%');

COMMENT ON COLUMN "invitations"."token" IS
  'The invitation bearer, carrying its purpose prefix (ms_invite_). The prefix is checked by readInvitationToken() BEFORE any lookup, so a sign-in or recovery token presented here is refused because it is the wrong kind rather than because it happens to be absent from this table. The CHECK constraint added in 0022 makes the format structural: an issuer that wrote an unprefixed token would otherwise pass every test, because the consumer would refuse it and the failure would look like a bug in redemption rather than in minting.';
