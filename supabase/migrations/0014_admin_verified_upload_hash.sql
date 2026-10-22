-- PostgreSQL CHECK accepts UNKNOWN. Explicitly require a hash on verified rows,
-- including if a future internal writer accidentally supplies NULL.
ALTER TABLE xland.admin_uploads ADD CONSTRAINT verified_upload_requires_hash
  CHECK(verified_at IS NULL OR sha256 IS NOT NULL);
