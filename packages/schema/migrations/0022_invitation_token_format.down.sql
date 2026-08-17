-- Reverses 0022_invitation_token_format.sql.
-- Dropping this makes the invite prefix advisory again: minting code could
-- write an unprefixed token and nothing would refuse the row.
ALTER TABLE "invitations" DROP CONSTRAINT IF EXISTS "invitations_token_purpose_prefix";
COMMENT ON COLUMN "invitations"."token" IS NULL;
