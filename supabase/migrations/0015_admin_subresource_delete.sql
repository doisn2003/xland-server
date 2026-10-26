DO $admin_delete$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['property_media','property_legal_items','property_documents','property_nearby_amenities'] LOOP
    EXECUTE format('GRANT DELETE ON xland.%I TO xland_admin', tab);
    EXECUTE format('CREATE POLICY admin_delete ON xland.%I FOR DELETE TO xland_admin USING(true)', tab);
  END LOOP;
END $admin_delete$;
