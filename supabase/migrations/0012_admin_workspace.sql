-- Additive admin capability. Existing API roles, projections and policies are unchanged.
ALTER TABLE xland.user_roles DROP CONSTRAINT user_roles_role_check;
ALTER TABLE xland.user_roles ADD CONSTRAINT user_roles_role_check
  CHECK(role IN ('customer','consultant','coordinator','payment_operator','admin'));
DO $admin$ DECLARE tab text; BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='xland_admin') THEN
    CREATE ROLE xland_admin NOLOGIN NOINHERIT NOBYPASSRLS;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='xland_admin' AND (rolsuper OR rolbypassrls OR rolcanlogin)) THEN
    RAISE EXCEPTION 'Unsafe existing admin role';
  END IF;
  EXECUTE format('GRANT xland_admin TO %I WITH INHERIT FALSE,SET TRUE',current_user);
  FOREACH tab IN ARRAY ARRAY['user_roles','user_profiles','user_contacts','geo_locations','consultants','properties',
    'property_media','property_legal_items','property_documents','property_nearby_amenities','videos','site_visit_slots',
    'site_visit_bookings','slot_reservations','booking_status_history','support_requests','events','clubs',
    'event_registrations','payment_intents','payment_receipts','consultant_reviews'] LOOP
    EXECUTE format('GRANT SELECT ON xland.%I TO xland_admin',tab);
    EXECUTE format('CREATE POLICY admin_read ON xland.%I FOR SELECT TO xland_admin USING(true)',tab);
  END LOOP;
  FOREACH tab IN ARRAY ARRAY['consultants','properties','property_media','property_legal_items','property_documents',
    'property_nearby_amenities','videos','site_visit_slots','site_visit_bookings','slot_reservations',
    'support_requests','events','clubs','user_profiles','user_contacts'] LOOP
    EXECUTE format('GRANT INSERT,UPDATE ON xland.%I TO xland_admin',tab);
    EXECUTE format('CREATE POLICY admin_insert ON xland.%I FOR INSERT TO xland_admin WITH CHECK(true)',tab);
    EXECUTE format('CREATE POLICY admin_update ON xland.%I FOR UPDATE TO xland_admin USING(true) WITH CHECK(true)',tab);
  END LOOP;
END $admin$;
GRANT USAGE ON SCHEMA xland TO xland_admin;
GRANT INSERT ON xland.booking_status_history TO xland_admin;
CREATE POLICY admin_insert ON xland.booking_status_history FOR INSERT TO xland_admin WITH CHECK(true);
CREATE TABLE xland.admin_audit_log (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES xland.user_profiles,
  action text NOT NULL,
  entity text NOT NULL,
  record_id uuid,
  changed_fields jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_recent ON xland.admin_audit_log(created_at DESC,id DESC);
ALTER TABLE xland.admin_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE xland.admin_audit_log FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON xland.admin_audit_log TO xland_admin;
CREATE POLICY admin_audit_read ON xland.admin_audit_log FOR SELECT TO xland_admin USING(true);
CREATE POLICY admin_audit_insert ON xland.admin_audit_log FOR INSERT TO xland_admin WITH CHECK(actor_id=xland.current_user_id());
CREATE TRIGGER immutable_admin_audit BEFORE UPDATE OR DELETE ON xland.admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION xland.append_only_history();
-- Keep the existing isolated logical-restore workflow usable for the new table.
GRANT SELECT,INSERT ON xland.admin_audit_log TO xland_seed;
CREATE POLICY seed_read ON xland.admin_audit_log FOR SELECT TO xland_seed USING(true);
CREATE POLICY seed_insert ON xland.admin_audit_log FOR INSERT TO xland_seed WITH CHECK(true);
