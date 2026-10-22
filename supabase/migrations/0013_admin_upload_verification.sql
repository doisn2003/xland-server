-- Uploads remain private until the server verifies the stored bytes.
CREATE TABLE xland.admin_uploads (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES xland.user_profiles,
  staging_key text NOT NULL UNIQUE,
  mime_type text NOT NULL CHECK(mime_type IN ('image/jpeg','image/png','image/webp','video/mp4','video/webm','application/pdf')),
  expected_size integer NOT NULL CHECK(expected_size>0 AND expected_size<=52428800),
  private_document boolean NOT NULL,
  storage_key text UNIQUE,
  public_url text UNIQUE,
  sha256 text,
  created_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  CHECK(NOT private_document OR (expected_size<=20971520 AND mime_type IN ('application/pdf','image/jpeg','image/png'))),
  CHECK(private_document OR mime_type<>'application/pdf'),
  CHECK((verified_at IS NULL AND storage_key IS NULL AND public_url IS NULL AND sha256 IS NULL)
     OR (verified_at IS NOT NULL AND storage_key IS NOT NULL AND sha256 ~ '^[0-9a-f]{64}$' AND (private_document = (public_url IS NULL))))
);
ALTER TABLE xland.admin_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE xland.admin_uploads FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON xland.admin_uploads TO xland_admin;
CREATE POLICY admin_upload_read ON xland.admin_uploads FOR SELECT TO xland_admin USING(true);
CREATE POLICY admin_upload_insert ON xland.admin_uploads FOR INSERT TO xland_admin WITH CHECK(actor_id=xland.current_user_id());
CREATE POLICY admin_upload_update ON xland.admin_uploads FOR UPDATE TO xland_admin USING(actor_id=xland.current_user_id()) WITH CHECK(actor_id=xland.current_user_id());
GRANT SELECT,INSERT ON xland.admin_uploads TO xland_seed;
CREATE POLICY seed_read ON xland.admin_uploads FOR SELECT TO xland_seed USING(true);
CREATE POLICY seed_insert ON xland.admin_uploads FOR INSERT TO xland_seed WITH CHECK(true);
