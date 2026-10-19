-- A-19 auth extension: additive identities/OTP; approved 2026-10-19.
-- Preserve existing user IDs, passwords, sessions and application data.
ALTER TABLE xland.user_identities ALTER COLUMN username_normalized DROP NOT NULL;
ALTER TABLE xland.user_identities ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE xland.user_identities ADD CONSTRAINT auth_password_pair CHECK
  ((username_normalized IS NULL)=(password_hash IS NULL));

CREATE TABLE xland.auth_external_identities (
  issuer text NOT NULL CHECK(issuer IN ('https://accounts.google.com','urn:xland:phone')),
  subject text NOT NULL CHECK(length(subject) BETWEEN 1 AND 255),
  user_id uuid NOT NULL REFERENCES xland.user_identities ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(issuer,subject),
  UNIQUE(user_id,issuer)
);
CREATE TABLE xland.auth_otp_challenges (
  id uuid PRIMARY KEY,
  phone text NOT NULL CHECK(phone ~ '^\+84[35789][0-9]{8}$'),
  phone_hash bytea NOT NULL CHECK(octet_length(phone_hash)=32),
  request_digest bytea NOT NULL UNIQUE CHECK(octet_length(request_digest)=32),
  code_digest bytea NOT NULL CHECK(octet_length(code_digest)=32),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK(expires_at>created_at),
  resend_at timestamptz NOT NULL CHECK(resend_at>created_at AND resend_at<=expires_at),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','uncertain','failed','consumed','superseded')),
  consumed_at timestamptz,
  CHECK((status='consumed')=(consumed_at IS NOT NULL))
);
CREATE INDEX auth_otp_phone_recent ON xland.auth_otp_challenges(phone_hash,created_at DESC);
CREATE INDEX auth_otp_expiry ON xland.auth_otp_challenges(expires_at);
CREATE TABLE xland.auth_rate_buckets (
  bucket_key bytea PRIMARY KEY CHECK(octet_length(bucket_key)=32),
  hits integer NOT NULL CHECK(hits>0),
  expires_at timestamptz NOT NULL
);
CREATE INDEX auth_rate_expiry ON xland.auth_rate_buckets(expires_at);
ALTER TABLE xland.auth_external_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE xland.auth_external_identities FORCE ROW LEVEL SECURITY;
ALTER TABLE xland.auth_otp_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE xland.auth_otp_challenges FORCE ROW LEVEL SECURITY;
ALTER TABLE xland.auth_rate_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE xland.auth_rate_buckets FORCE ROW LEVEL SECURITY;
REVOKE ALL ON xland.auth_external_identities,xland.auth_otp_challenges,xland.auth_rate_buckets FROM PUBLIC,xland_api,xland_payment;
CREATE POLICY auth_service ON xland.auth_external_identities TO xland_auth USING(true) WITH CHECK(true);
CREATE POLICY auth_service ON xland.auth_otp_challenges TO xland_auth USING(true) WITH CHECK(true);
CREATE POLICY auth_service ON xland.auth_rate_buckets TO xland_auth USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE ON xland.auth_external_identities,xland.auth_otp_challenges,xland.auth_rate_buckets TO xland_auth;
-- Ops cleanup under a dedicated maintenance role, never xland_api:
-- retain challenge request_digest >=24h to prevent timeout retries being re-sent;
-- delete expired challenges >24h and expired buckets >24h in bounded batches.
-- Never delete external identities to clean up OTPs.
