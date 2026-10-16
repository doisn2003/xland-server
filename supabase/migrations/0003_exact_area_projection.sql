-- Numeric identifiers are public projection columns; exact coordinates remain revoked.
GRANT SELECT(area_m2,price_per_m2) ON xland.properties TO xland_api;
