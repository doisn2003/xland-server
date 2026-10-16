-- Additive grants for C4/C7; API role can only create a disabled/unpaid placeholder.
CREATE POLICY owned_disabled_insert ON xland.payment_intents FOR INSERT TO xland_api
  WITH CHECK(user_id=xland.current_user_id() AND mode='disabled' AND status='unpaid' AND amount_vnd IS NULL AND reference IS NULL AND policy_version IS NULL AND provider IS NULL);
GRANT INSERT(id,booking_id,user_id,status,mode) ON xland.payment_intents TO xland_api;
CREATE FUNCTION xland.payment_received_at(target uuid) RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT max(r.received_at) FROM xland.payment_receipts r JOIN xland.payment_intents i ON i.id=r.intent_id
    WHERE i.id=target AND i.user_id=xland.current_user_id() AND r.verification_state='verified'
$$;
ALTER FUNCTION xland.payment_received_at(uuid) OWNER TO xland_payment;
REVOKE ALL ON FUNCTION xland.payment_received_at(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION xland.payment_received_at(uuid) TO xland_api;
-- Keep planned private storage identities available without exposing keys in public projections.
ALTER TABLE xland.user_profiles ADD COLUMN avatar_storage_key text;
ALTER TABLE xland.property_media ADD COLUMN thumbnail_key text;
ALTER TABLE xland.property_documents ADD COLUMN public_preview_key text;
REVOKE SELECT ON xland.user_profiles FROM xland_api;
GRANT SELECT(id,display_name,avatar_url,is_verified,public_role,is_illustrative,created_at,updated_at) ON xland.user_profiles TO xland_api;
