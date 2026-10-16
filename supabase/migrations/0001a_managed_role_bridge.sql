-- A-09: additive compatibility bridge before original ownership transfers.
-- Keep original 0001..0006 checksums intact on existing local databases.
DO $bridge$ BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) THEN
    EXECUTE format('GRANT xland_api,xland_auth,xland_payment TO %I WITH INHERIT TRUE,SET TRUE',current_user);
  END IF;
END $bridge$;
GRANT CREATE ON SCHEMA xland TO xland_auth,xland_payment;
