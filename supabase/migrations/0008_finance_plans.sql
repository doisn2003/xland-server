GRANT INSERT ON xland.saved_finance_plans TO xland_api;
-- Allow row locking for a consistent current-price snapshot; no mutable price grant.
GRANT UPDATE(id) ON xland.properties TO xland_api;
CREATE POLICY finance_price_lock ON xland.properties FOR UPDATE TO xland_api
  USING(approval_status='approved') WITH CHECK(approval_status='approved');
