-- Allow names-only future property entry; no fabricated legacy coordinates.
ALTER TABLE xland.properties ALTER COLUMN approximate_lat DROP NOT NULL;
ALTER TABLE xland.properties ALTER COLUMN approximate_lng DROP NOT NULL;
ALTER TABLE xland.properties ALTER COLUMN approximate_radius_m DROP NOT NULL;
ALTER TABLE xland.properties ADD CONSTRAINT approximate_location_complete CHECK (
  (approximate_lat IS NULL AND approximate_lng IS NULL AND approximate_radius_m IS NULL) OR
  (approximate_lat IS NOT NULL AND approximate_lng IS NOT NULL AND approximate_radius_m IS NOT NULL)
);
ALTER TABLE xland.properties ADD CONSTRAINT commune_name_administrative CHECK (
  commune_name IS NULL OR commune_name ~* '^(xã|phường) [^,;/]+$'
);
-- properties uses column grants: never SELECT the whole row (exact lat/lng are private).
GRANT SELECT(commune_name) ON xland.properties TO xland_api;
