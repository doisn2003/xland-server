CREATE OR REPLACE FUNCTION xland.guard_booking_state() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.status IN ('pending_confirmation','confirmed','completed') AND NOT EXISTS(
    SELECT 1 FROM xland.payment_intents i JOIN xland.payment_receipts r ON r.intent_id=i.id
    WHERE i.booking_id=NEW.id AND i.status='succeeded' AND r.verification_state='verified'
      AND r.received_amount_vnd=i.amount_vnd AND r.currency=i.currency AND r.mode=i.mode AND r.provider=i.provider
  ) THEN RAISE EXCEPTION 'Verified deposit is required' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
