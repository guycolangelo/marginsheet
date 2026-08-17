-- =========================================================================
-- 0017_auth_send_attempts: the ledger the magic-link rate limiter counts
-- (M3 task 3.2e).
--
-- WHAT IT IS FOR. Two limits are enforced from this table: per email, so one
-- address cannot be mailbox-bombed, and a global ceiling, so a runaway loop of
-- our own making cannot spend the Postmark budget. A runaway loop is at least
-- as likely as an attacker and costs the same money.
--
-- WHAT IS DELIBERATELY NOT HERE: ANY NETWORK IDENTITY.
--
-- There is no ip_address column and there is never to be one. Rate limiting by
-- source is done at the Cloudflare edge, where the IP already is as a matter of
-- routing, and it never reaches this Worker or this database. Guy's ruling,
-- 16 Aug 2026: MarginSheet takes no CUSTODY of network identity, and edge
-- limiting leaves custody where it already sits. Keying our own counters on an
-- IP, or on a hash or any other derivative of one, moves custody to us. The
-- bright line is the value, not its reversibility: once "derived, transient,
-- hashed" is acceptable it gets cited for the next feature.
--
-- So a future author adding an ip column here is not extending a limiter, they
-- are reversing a ruling, and that is Guy's to reverse and not a migration
-- author's. Same standing as 0012's trigger.
--
-- WHY THE EMAIL IS STORED IN THE CLEAR. It is the thing being limited, and
-- hashing it would defeat the point while pretending to protect something we
-- already hold: `user`.`email` carries the same addresses. Signup happens on
-- first use, so an attempt for an unrecognised address creates a user row
-- anyway. This adds no address the database did not already have.
--
-- WHY NO RLS. Same reasoning as 0011's Better Auth tables. This is not
-- household-scoped: the limiter runs before anyone is authenticated and must
-- count attempts for an address that may belong to no household at all. A
-- policy filtering by household GUC would make the limiter depend on knowing
-- the answer authentication has not produced yet.
--
-- marginsheet_sync gets nothing. The Plaid worker has no business here.
-- =========================================================================

CREATE TABLE auth_send_attempts (
  "id"         uuid PRIMARY KEY DEFAULT uuidv7(),
  -- Which limited action this was. One kind today; OTP sends join in 3.3.
  "kind"       text NOT NULL,
  -- The address the send was for. Never a hash, never an IP.
  "subject"    text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "auth_send_attempts_kind_known"
    CHECK ("kind" IN ('magic_link'))
);

-- The per-subject window query.
CREATE INDEX "auth_send_attempts_subject_idx"
  ON auth_send_attempts ("kind", "subject", "created_at" DESC);

-- The global ceiling query, and the prune.
CREATE INDEX "auth_send_attempts_recent_idx"
  ON auth_send_attempts ("kind", "created_at" DESC);

COMMENT ON TABLE auth_send_attempts IS
  'Attempt ledger for magic-link sends, counted by the per-email limit and the global send ceiling (3.2e). Holds NO network identity and never will: per-source limiting is done at the Cloudflare edge, where the IP already sits as a matter of routing. Adding an IP column here, hashed or otherwise, moves custody of network identity to MarginSheet and reverses a ruling of Guy''s (16 Aug 2026). The bright line is the value, not its reversibility.';

COMMENT ON COLUMN auth_send_attempts."subject" IS
  'The email address the send was for, in the clear. It is the thing being limited, and hashing it would protect nothing that user.email does not already hold.';

-- The application inserts attempts, counts them, and prunes expired ones.
-- No UPDATE: an attempt is a fact about a moment and is never revised, and a
-- role that could rewrite timestamps could rewrite its own way past the limit.
GRANT SELECT, INSERT, DELETE ON TABLE auth_send_attempts TO marginsheet_app;
