-- Add current two-tier addresses without rewriting historical administrative codes.
CREATE TABLE xland.geo_catalogs (
  version text PRIMARY KEY,
  effective_date date NOT NULL,
  source_url text NOT NULL,
  source_revision text NOT NULL,
  active boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX geo_catalog_one_active ON xland.geo_catalogs(active) WHERE active;
ALTER TABLE xland.geo_catalogs ENABLE ROW LEVEL SECURITY;
ALTER TABLE xland.geo_catalogs FORCE ROW LEVEL SECURITY;
GRANT SELECT ON xland.geo_catalogs TO xland_api,xland_admin;
GRANT SELECT,INSERT ON xland.geo_catalogs TO xland_seed;
CREATE POLICY catalog_read ON xland.geo_catalogs FOR SELECT USING(true);
CREATE POLICY seed_insert ON xland.geo_catalogs FOR INSERT TO xland_seed WITH CHECK(true);
ALTER TABLE xland.geo_locations DROP CONSTRAINT geo_locations_kind_check;
ALTER TABLE xland.geo_locations ADD CONSTRAINT geo_locations_kind_check CHECK(kind IN ('province','district','commune'));
ALTER TABLE xland.geo_locations ADD COLUMN region text CHECK(region IN ('north','central','south'));
GRANT SELECT(region) ON xland.geo_locations TO xland_api;

ALTER TABLE xland.properties
  ADD COLUMN commune_code text,
  ADD COLUMN address_detail text CHECK(length(address_detail)<=500),
  ADD COLUMN old_address text CHECK(length(old_address)<=1000),
  ALTER COLUMN district DROP NOT NULL,
  ALTER COLUMN district_code DROP NOT NULL,
  ADD CONSTRAINT property_commune_fk FOREIGN KEY(commune_code,catalog_version) REFERENCES xland.geo_locations(code,catalog_version);
GRANT SELECT(commune_code,commune_name,address_detail,old_address,catalog_version) ON xland.properties TO xland_api;
CREATE INDEX property_commune ON xland.properties(province_code,commune_code);
ALTER TABLE xland.properties DROP CONSTRAINT commune_name_administrative;
ALTER TABLE xland.properties ADD CONSTRAINT commune_name_administrative CHECK(commune_name IS NULL OR commune_name ~* '^(xã|phường|[đĐ]ặc khu) [^,;/]+$');
-- Preserve precisely what was recorded. Do not guess a current commune from a former district.
UPDATE xland.properties SET old_address=NULLIF(concat_ws(', ',NULLIF(commune_name,''),NULLIF(district,''),NULLIF(province,'')),'');

-- category is the canonical four-value type. Preserve the old three-value
-- land_type projection so previously released servers/mobile clients keep reading.
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM xland.properties WHERE land_type<>CASE WHEN category='industrial' THEN 'other' ELSE category END) THEN
    RAISE EXCEPTION 'Conflicting property land types require review before migration';
  END IF;
END $$;
ALTER TABLE xland.properties ADD CONSTRAINT property_consistent_land_type CHECK(land_type=CASE WHEN category='industrial' THEN 'other' ELSE category END);

CREATE FUNCTION xland.guard_property_address_type() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog AS $$
DECLARE province_row xland.geo_locations; commune_row xland.geo_locations;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.land_type IS DISTINCT FROM OLD.land_type AND NEW.category IS NOT DISTINCT FROM OLD.category THEN NEW.category=NEW.land_type;
    ELSIF NEW.category IS DISTINCT FROM OLD.category AND NEW.land_type IS NOT DISTINCT FROM OLD.land_type THEN NEW.land_type=CASE WHEN NEW.category='industrial' THEN 'other' ELSE NEW.category END;
    END IF;
  ELSE
    NEW.category=COALESCE(NEW.category,NEW.land_type);
    NEW.land_type=COALESCE(NEW.land_type,CASE WHEN NEW.category='industrial' THEN 'other' ELSE NEW.category END);
  END IF;
  IF NEW.land_type IS DISTINCT FROM (CASE WHEN NEW.category='industrial' THEN 'other' ELSE NEW.category END) THEN
    RAISE EXCEPTION 'Loại đất không thống nhất. Chỉ chọn một loại đất cho hồ sơ.' USING ERRCODE='23514',COLUMN='category';
  END IF;
  IF EXISTS(SELECT 1 FROM xland.geo_catalogs WHERE version=NEW.catalog_version) THEN
    SELECT * INTO province_row FROM xland.geo_locations WHERE code=NEW.province_code AND catalog_version=NEW.catalog_version AND kind='province';
    SELECT * INTO commune_row FROM xland.geo_locations WHERE code=NEW.commune_code AND catalog_version=NEW.catalog_version AND kind='commune';
    IF province_row.code IS NULL OR commune_row.code IS NULL OR commune_row.parent_code<>province_row.code THEN
      RAISE EXCEPTION 'Chọn xã/phường thuộc tỉnh/thành phố đã chọn.' USING ERRCODE='23514',COLUMN='commune_code';
    END IF;
    IF NEW.district_code IS NOT NULL OR NEW.district IS NOT NULL THEN
      RAISE EXCEPTION 'Địa giới hiện hành không sử dụng quận/huyện. Nhập thông tin này vào Địa chỉ cũ nếu cần.' USING ERRCODE='23514',COLUMN='district_code';
    END IF;
    NEW.province=province_row.name; NEW.commune_name=commune_row.name; NEW.region=province_row.region;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER property_address_type_guard BEFORE INSERT OR UPDATE ON xland.properties
FOR EACH ROW EXECUTE FUNCTION xland.guard_property_address_type();
