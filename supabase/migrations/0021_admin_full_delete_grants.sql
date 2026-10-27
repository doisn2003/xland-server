-- Grant DELETE, SELECT on all entities and dependent tables to xland_admin for full CRUD deletion
DO $admin_delete$ DECLARE tab text; BEGIN
  -- 1. Ensure SELECT on auxiliary tables needed for dependency lookups and cascades
  FOREACH tab IN ARRAY ARRAY[
    'saved_finance_plans','saved_properties','saved_videos','saved_events',
    'document_access_grants','video_likes','video_comments','payment_status_history',
    'payment_provider_events'
  ] LOOP
    EXECUTE format('GRANT SELECT ON xland.%I TO xland_admin', tab);
    EXECUTE format('DROP POLICY IF EXISTS admin_read ON xland.%I', tab);
    EXECUTE format('CREATE POLICY admin_read ON xland.%I FOR SELECT TO xland_admin USING(true)', tab);
  END LOOP;

  -- 2. Grant DELETE on all deletable root entities and cascade target tables
  FOREACH tab IN ARRAY ARRAY[
    'properties','consultants','clubs','events','videos','site_visit_slots','support_requests',
    'saved_finance_plans','saved_properties','saved_videos','saved_events','document_access_grants',
    'video_likes','video_comments','consultant_reviews','event_registrations',
    'site_visit_bookings','slot_reservations','booking_status_history',
    'payment_provider_events','payment_receipts','payment_status_history','payment_intents'
  ] LOOP
    EXECUTE format('GRANT DELETE ON xland.%I TO xland_admin', tab);
    EXECUTE format('DROP POLICY IF EXISTS admin_delete ON xland.%I', tab);
    EXECUTE format('CREATE POLICY admin_delete ON xland.%I FOR DELETE TO xland_admin USING(true)', tab);
  END LOOP;
END $admin_delete$;
