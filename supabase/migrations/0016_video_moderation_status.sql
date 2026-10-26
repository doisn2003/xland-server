ALTER TABLE xland.videos DROP CONSTRAINT IF EXISTS videos_approval_status_check;
ALTER TABLE xland.videos ADD CONSTRAINT videos_approval_status_check
  CHECK(approval_status IN ('pending','approved','rejected'));

DO $admin_social$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['video_likes','video_comments'] LOOP
    EXECUTE format('GRANT SELECT ON xland.%I TO xland_admin', tab);
    EXECUTE format('CREATE POLICY admin_read ON xland.%I FOR SELECT TO xland_admin USING(true)', tab);
  END LOOP;
END $admin_social$;
