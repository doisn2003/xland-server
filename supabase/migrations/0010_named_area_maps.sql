-- A-20: public map input is commune/ward + province; never a parcel address.
ALTER TABLE xland.properties ADD COLUMN commune_name text
  CHECK(commune_name IS NULL OR length(trim(commune_name)) BETWEEN 2 AND 100);
COMMENT ON COLUMN xland.properties.commune_name IS
  'Public commune/ward name including its type; paired with province. No street/parcel address.';

DO $maps$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='xland_maps') THEN
    CREATE ROLE xland_maps NOLOGIN NOINHERIT NOBYPASSRLS;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='xland_maps' AND (rolsuper OR rolbypassrls OR rolcanlogin)) THEN
    RAISE EXCEPTION 'Unsafe existing maps role';
  END IF;
  EXECUTE format('GRANT xland_maps TO %I WITH INHERIT FALSE,SET TRUE',current_user);
END $maps$;
CREATE TABLE xland.map_area_cache (
  area_key text PRIMARY KEY CHECK(length(area_key)=64),
  result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
  expires_at timestamptz NOT NULL
);
CREATE TABLE xland.map_daily_usage (
  usage_day date PRIMARY KEY,
  quarter_credits integer NOT NULL CHECK(quarter_credits BETWEEN 0 AND 12000)
);
ALTER TABLE xland.map_area_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE xland.map_area_cache FORCE ROW LEVEL SECURITY;
ALTER TABLE xland.map_daily_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE xland.map_daily_usage FORCE ROW LEVEL SECURITY;
REVOKE ALL ON xland.map_area_cache,xland.map_daily_usage FROM PUBLIC,xland_api,xland_auth,xland_payment,xland_seed;
GRANT USAGE ON SCHEMA xland TO xland_maps;
GRANT SELECT,INSERT,UPDATE,DELETE ON xland.map_area_cache,xland.map_daily_usage TO xland_maps;
CREATE POLICY map_service ON xland.map_area_cache TO xland_maps USING(true) WITH CHECK(true);
CREATE POLICY map_service ON xland.map_daily_usage TO xland_maps USING(true) WITH CHECK(true);
