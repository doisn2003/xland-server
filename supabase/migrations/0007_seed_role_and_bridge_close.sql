-- Dedicated, non-bypass provisioner. Seeds cannot overwrite user mutations.
DO $seed$ DECLARE tab record; BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='xland_seed') THEN
    CREATE ROLE xland_seed NOLOGIN NOINHERIT NOBYPASSRLS;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='xland_seed' AND (rolsuper OR rolbypassrls OR rolcanlogin)) THEN RAISE EXCEPTION 'Unsafe existing seed role'; END IF;
  EXECUTE format('GRANT xland_seed TO %I WITH INHERIT FALSE,SET TRUE',current_user);
  FOR tab IN SELECT tablename FROM pg_tables WHERE schemaname='xland' LOOP
    EXECUTE format('CREATE POLICY seed_read ON xland.%I FOR SELECT TO xland_seed USING(true)',tab.tablename);
    EXECUTE format('CREATE POLICY seed_insert ON xland.%I FOR INSERT TO xland_seed WITH CHECK(true)',tab.tablename);
    EXECUTE format('GRANT SELECT,INSERT ON xland.%I TO xland_seed',tab.tablename);
  END LOOP;
END $seed$;
GRANT USAGE ON SCHEMA xland TO xland_seed;
REVOKE CREATE ON SCHEMA xland FROM xland_auth,xland_payment;
DO $bridge$ BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) THEN
    EXECUTE format('GRANT xland_api,xland_auth,xland_payment TO %I WITH INHERIT FALSE,SET TRUE',current_user);
  END IF;
END $bridge$;
