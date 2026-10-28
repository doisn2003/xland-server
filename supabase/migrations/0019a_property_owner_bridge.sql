-- Managed PostgreSQL checks CREATE on the schema for a function's new owner.
-- 0020 transfers two narrowly scoped functions to xland_admin. Grant only for
-- that transfer; 0020a closes the bridge in the same migration transaction.
-- Keep the already-recorded 0020 checksum unchanged.
GRANT CREATE ON SCHEMA xland TO xland_admin;
