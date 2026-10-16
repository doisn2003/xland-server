-- Aggregate-only access: clients cannot enumerate private likes/follows/reservations.
CREATE POLICY aggregate_read ON xland.video_likes FOR SELECT TO xland_auth USING(true);
CREATE POLICY aggregate_read ON xland.author_follows FOR SELECT TO xland_auth USING(true);
CREATE POLICY aggregate_read ON xland.event_registrations FOR SELECT TO xland_auth USING(true);
CREATE POLICY aggregate_read ON xland.slot_reservations FOR SELECT TO xland_auth USING(true);
GRANT SELECT ON xland.video_likes,xland.author_follows,xland.event_registrations,xland.slot_reservations TO xland_auth;
CREATE FUNCTION xland.video_like_count(target uuid) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT count(*) FROM xland.video_likes WHERE video_id=target
$$;
CREATE FUNCTION xland.author_follow_count(target uuid) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT count(*) FROM xland.author_follows WHERE author_id=target
$$;
CREATE FUNCTION xland.event_attendee_count(target uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT COALESCE(sum(attendee_count),0)::integer FROM xland.event_registrations WHERE event_id=target AND status IN ('pending','registered')
$$;
CREATE FUNCTION xland.slot_booking_count(target uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT count(*)::integer FROM xland.slot_reservations WHERE slot_id=target AND state<>'released'
$$;
ALTER FUNCTION xland.video_like_count(uuid) OWNER TO xland_auth;
ALTER FUNCTION xland.author_follow_count(uuid) OWNER TO xland_auth;
ALTER FUNCTION xland.event_attendee_count(uuid) OWNER TO xland_auth;
ALTER FUNCTION xland.slot_booking_count(uuid) OWNER TO xland_auth;
REVOKE ALL ON FUNCTION xland.video_like_count(uuid),xland.author_follow_count(uuid),xland.event_attendee_count(uuid),xland.slot_booking_count(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION xland.video_like_count(uuid),xland.author_follow_count(uuid),xland.event_attendee_count(uuid),xland.slot_booking_count(uuid) TO xland_api;

CREATE FUNCTION xland.reset_contact_verification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.phone IS DISTINCT FROM OLD.phone THEN NEW.phone_verified_at=NULL; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER contact_changed BEFORE UPDATE ON xland.user_contacts FOR EACH ROW EXECUTE FUNCTION xland.reset_contact_verification();
REVOKE UPDATE(phone_verified_at) ON xland.user_contacts FROM xland_api;

CREATE FUNCTION xland.guard_booking_state() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.status IN ('pending_confirmation','confirmed','completed') AND NOT EXISTS(
    SELECT 1 FROM xland.payment_intents i JOIN xland.payment_receipts r ON r.intent_id=i.id
    WHERE i.booking_id=NEW.id AND i.status='succeeded' AND r.verification_state='verified'
      AND r.received_amount_vnd=i.amount_vnd AND r.currency=i.currency AND r.mode=i.mode
  ) THEN RAISE EXCEPTION 'Verified deposit is required' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
ALTER FUNCTION xland.guard_booking_state() OWNER TO xland_payment;
CREATE CONSTRAINT TRIGGER booking_deposit_guard AFTER INSERT OR UPDATE ON xland.site_visit_bookings
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION xland.guard_booking_state();

CREATE FUNCTION xland.append_only_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'History is append only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER immutable_booking_history BEFORE UPDATE OR DELETE ON xland.booking_status_history FOR EACH ROW EXECUTE FUNCTION xland.append_only_history();
CREATE TRIGGER immutable_payment_history BEFORE UPDATE OR DELETE ON xland.payment_status_history FOR EACH ROW EXECUTE FUNCTION xland.append_only_history();
CREATE TRIGGER immutable_receipt BEFORE UPDATE OR DELETE ON xland.payment_receipts FOR EACH ROW EXECUTE FUNCTION xland.append_only_history();
