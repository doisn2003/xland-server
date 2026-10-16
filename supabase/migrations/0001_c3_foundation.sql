-- 0001: additive isolated XLand schema, PostgreSQL17+. No DROP/TRUNCATE.
DO $roles$ BEGIN
IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='xland_api') THEN CREATE ROLE xland_api LOGIN NOINHERIT NOBYPASSRLS; END IF;
IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='xland_api' AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Unsafe existing runtime role'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='xland_auth') THEN CREATE ROLE xland_auth LOGIN NOINHERIT NOBYPASSRLS; END IF;
IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='xland_auth' AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Unsafe existing runtime role'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='xland_payment') THEN CREATE ROLE xland_payment LOGIN NOINHERIT NOBYPASSRLS; END IF;
IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='xland_payment' AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Unsafe existing runtime role'; END IF;
END $roles$;
CREATE SCHEMA xland;
REVOKE ALL ON SCHEMA xland FROM PUBLIC;
GRANT USAGE ON SCHEMA xland TO xland_api,xland_auth,xland_payment;
CREATE FUNCTION xland.current_user_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('xland.user_id',true),'')::uuid $$;

CREATE TABLE xland.user_identities (
id uuid PRIMARY KEY,
username_normalized text NOT NULL UNIQUE CHECK(username_normalized ~ '^[a-z0-9._-]{3,64}$'),
password_hash text NOT NULL CHECK(length(password_hash)>0),
status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
disabled_at timestamptz,
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE xland.auth_sessions (
id uuid PRIMARY KEY,
user_id uuid NOT NULL REFERENCES xland.user_identities ON DELETE RESTRICT,
token_digest bytea NOT NULL UNIQUE CHECK(octet_length(token_digest)=32),
created_at timestamptz NOT NULL,
expires_at timestamptz NOT NULL,
revoked_at timestamptz,
CHECK(expires_at=created_at+interval '24 hours'),
CHECK(revoked_at IS NULL OR revoked_at>=created_at)
);

CREATE TABLE xland.user_profiles (
id uuid PRIMARY KEY REFERENCES xland.user_identities,
display_name text NOT NULL CHECK(length(display_name) BETWEEN 1 AND 100),
avatar_url text,
is_verified boolean NOT NULL DEFAULT false,
public_role text,
is_illustrative boolean NOT NULL DEFAULT false,
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE xland.user_contacts (
user_id uuid PRIMARY KEY REFERENCES xland.user_profiles,
phone text,
phone_verified_at timestamptz,
email_contact text,
updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE xland.user_settings (
user_id uuid PRIMARY KEY REFERENCES xland.user_profiles,
notification_consent boolean NOT NULL DEFAULT false,
feed_autoplay boolean NOT NULL DEFAULT false,
feed_muted_by_default boolean NOT NULL DEFAULT true,
locale text NOT NULL DEFAULT 'vi_VN' CHECK(locale='vi_VN'),
time_zone text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh' CHECK(time_zone='Asia/Ho_Chi_Minh'),
updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE xland.user_roles (
user_id uuid REFERENCES xland.user_profiles,
role text CHECK(role IN ('customer','consultant','coordinator','payment_operator')),
granted_at timestamptz NOT NULL DEFAULT now(),
granted_by uuid REFERENCES xland.user_profiles,
PRIMARY KEY(user_id,role)
);

CREATE TABLE xland.geo_locations (
code text,
catalog_version text,
kind text NOT NULL CHECK(kind IN ('province','district')),
name text NOT NULL,
parent_code text,
parent_catalog_version text,
PRIMARY KEY(code,catalog_version),
FOREIGN KEY(parent_code,parent_catalog_version) REFERENCES xland.geo_locations(code,catalog_version)
);

CREATE TABLE xland.consultants (
id uuid PRIMARY KEY REFERENCES xland.user_profiles,
name text NOT NULL,
role text NOT NULL,
location text NOT NULL,
is_verified boolean NOT NULL DEFAULT false,
avatar_url text,
cover_url text,
next_available_slot timestamptz,
video_count integer NOT NULL DEFAULT 0 CHECK(video_count>=0),
follower_count integer NOT NULL DEFAULT 0 CHECK(follower_count>=0),
rating numeric(3,2) CHECK(rating BETWEEN 0 AND 5),
is_illustrative boolean NOT NULL DEFAULT false,
updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE xland.properties (
id uuid PRIMARY KEY,
code text NOT NULL UNIQUE,
title text NOT NULL,
province text NOT NULL,
province_code text NOT NULL,
district text NOT NULL,
district_code text NOT NULL,
catalog_version text NOT NULL,
region text NOT NULL CHECK(region IN ('north','central','south')),
category text NOT NULL CHECK(category IN ('residential','industrial','agricultural','other')),
price_total numeric(20,0) NOT NULL CHECK(price_total>=0),
price_per_m2 numeric(20,0) GENERATED ALWAYS AS (round(price_total/area_m2)) STORED,
area_m2 numeric(18,6) NOT NULL CHECK(area_m2>0),
frontage_m numeric(18,6) CHECK(frontage_m>=0),
depth_m numeric(18,6) CHECK(depth_m>=0),
road_width_m numeric(18,6) CHECK(road_width_m>=0),
direction text CHECK(direction IN ('north','northeast','east','southeast','south','southwest','west','northwest')),
land_type text NOT NULL CHECK(land_type IN ('residential','agricultural','other')),
status text NOT NULL CHECK(status IN ('listed','paused','sold')),
status_badge text NOT NULL CHECK(status_badge IN ('board_source','standard')),
approval_status text NOT NULL CHECK(approval_status IN ('pending','approved')),
consultant_id uuid NOT NULL REFERENCES xland.consultants,
highlights jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(highlights)='array'),
lat numeric CHECK(lat BETWEEN -90 AND 90),
lng numeric CHECK(lng BETWEEN -180 AND 180),
approximate_lat numeric NOT NULL CHECK(approximate_lat BETWEEN -90 AND 90),
approximate_lng numeric NOT NULL CHECK(approximate_lng BETWEEN -180 AND 180),
approximate_radius_m integer NOT NULL CHECK(approximate_radius_m>0),
is_illustrative boolean NOT NULL DEFAULT false,
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
FOREIGN KEY(province_code,catalog_version) REFERENCES xland.geo_locations(code,catalog_version),
FOREIGN KEY(district_code,catalog_version) REFERENCES xland.geo_locations(code,catalog_version)
);

CREATE TABLE xland.property_media (
id uuid PRIMARY KEY,
property_id uuid NOT NULL REFERENCES xland.properties,
kind text NOT NULL CHECK(kind IN ('image','video')),
usage text NOT NULL CHECK(usage IN ('gallery','area','feed')),
storage_key text,
public_url text,
thumbnail_url text,
alt_text text NOT NULL,
duration_seconds integer CHECK(duration_seconds>=0),
sort_order integer NOT NULL,
is_illustrative boolean NOT NULL DEFAULT true,
UNIQUE(property_id,usage,sort_order),
UNIQUE(id,property_id)
);

CREATE TABLE xland.videos (
id uuid PRIMARY KEY,
property_id uuid NOT NULL REFERENCES xland.properties,
author_id uuid NOT NULL REFERENCES xland.user_profiles,
media_id uuid NOT NULL,
caption text NOT NULL,
published_at timestamptz NOT NULL,
approval_status text NOT NULL DEFAULT 'approved' CHECK(approval_status IN ('pending','approved')),
view_count bigint NOT NULL DEFAULT 0 CHECK(view_count>=0 AND view_count<=9007199254740991),
is_illustrative boolean NOT NULL DEFAULT false,
deleted_at timestamptz,
FOREIGN KEY(media_id,property_id) REFERENCES xland.property_media(id,property_id),
UNIQUE(id,property_id)
);

CREATE TABLE xland.video_likes (
user_id uuid REFERENCES xland.user_profiles,
video_id uuid REFERENCES xland.videos,
created_at timestamptz NOT NULL DEFAULT now(),
PRIMARY KEY(user_id,video_id)
);

CREATE TABLE xland.video_comments (
id uuid PRIMARY KEY,
video_id uuid NOT NULL REFERENCES xland.videos,
author_id uuid NOT NULL REFERENCES xland.user_profiles,
body text NOT NULL CHECK(length(body) BETWEEN 1 AND 1000),
created_at timestamptz NOT NULL DEFAULT now(),
deleted_at timestamptz
);

CREATE TABLE xland.author_follows (
follower_id uuid REFERENCES xland.user_profiles,
author_id uuid REFERENCES xland.user_profiles,
created_at timestamptz NOT NULL DEFAULT now(),
PRIMARY KEY(follower_id,author_id),
CHECK(follower_id<>author_id)
);

CREATE TABLE xland.saved_videos (
user_id uuid REFERENCES xland.user_profiles,
video_id uuid REFERENCES xland.videos,
created_at timestamptz NOT NULL DEFAULT now(),
PRIMARY KEY(user_id,video_id)
);

CREATE TABLE xland.saved_properties (
user_id uuid REFERENCES xland.user_profiles,
property_id uuid REFERENCES xland.properties,
created_at timestamptz NOT NULL DEFAULT now(),
PRIMARY KEY(user_id,property_id)
);

CREATE TABLE xland.property_legal_items (
id uuid PRIMARY KEY,
property_id uuid NOT NULL REFERENCES xland.properties,
title text NOT NULL,
subtitle text,
checked_date date,
status text NOT NULL CHECK(status IN ('verified','pending')),
sort_order integer NOT NULL,
UNIQUE(property_id,sort_order),
CHECK(status<>'verified' OR checked_date IS NOT NULL)
);

CREATE TABLE xland.property_documents (
id uuid PRIMARY KEY,
property_id uuid NOT NULL REFERENCES xland.properties,
title text NOT NULL,
file_type text NOT NULL,
mime_type text NOT NULL CHECK(mime_type IN ('application/pdf','image/jpeg','image/png')),
size_bytes bigint NOT NULL CHECK(size_bytes>0 AND size_bytes<=9007199254740991),
uploaded_date date NOT NULL,
storage_key text UNIQUE,
access_level text NOT NULL CHECK(access_level IN ('public_redacted','authenticated','granted')),
public_preview_url text,
is_illustrative boolean NOT NULL DEFAULT true
);

CREATE TABLE xland.document_access_grants (
document_id uuid REFERENCES xland.property_documents,
user_id uuid REFERENCES xland.user_profiles,
granted_by uuid NOT NULL REFERENCES xland.user_profiles,
expires_at timestamptz,
granted_at timestamptz NOT NULL DEFAULT now(),
revoked_at timestamptz,
PRIMARY KEY(document_id,user_id),
CHECK(expires_at IS NULL OR expires_at>granted_at)
);

CREATE TABLE xland.property_nearby_amenities (
id uuid PRIMARY KEY,
property_id uuid NOT NULL REFERENCES xland.properties,
category text NOT NULL CHECK(category IN ('utility','traffic','living')),
name text NOT NULL,
distance_text text NOT NULL,
icon_type text NOT NULL CHECK(icon_type IN ('school','hospital','market','road','other')),
approximate_lat numeric CHECK(approximate_lat BETWEEN -90 AND 90),
approximate_lng numeric CHECK(approximate_lng BETWEEN -180 AND 180),
sort_order integer NOT NULL,
UNIQUE(property_id,category,sort_order)
);

CREATE TABLE xland.consultant_reviews (
id uuid PRIMARY KEY,
consultant_id uuid NOT NULL REFERENCES xland.consultants,
author_id uuid REFERENCES xland.user_profiles,
public_author_label text NOT NULL,
rating numeric(3,2) NOT NULL CHECK(rating BETWEEN 0 AND 5),
body text NOT NULL,
created_at timestamptz NOT NULL,
is_illustrative boolean NOT NULL DEFAULT true
);

CREATE TABLE xland.events (
id uuid PRIMARY KEY,
title text NOT NULL,
tags jsonb NOT NULL DEFAULT '[]',
media jsonb NOT NULL DEFAULT '[]',
starts_at timestamptz NOT NULL,
ends_at timestamptz NOT NULL,
time_zone text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
event_date date GENERATED ALWAYS AS ((starts_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date) STORED,
start_time time GENERATED ALWAYS AS ((starts_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::time) STORED,
end_time time GENERATED ALWAYS AS ((ends_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::time) STORED,
venue_name text NOT NULL,
address text NOT NULL,
max_slots integer NOT NULL CHECK(max_slots>0),
duration_mins integer NOT NULL CHECK(duration_mins>0),
ticket_price numeric(20,0) NOT NULL CHECK(ticket_price>=0),
status text NOT NULL CHECK(status IN ('open','sold_out','closed','cancelled')),
agenda jsonb NOT NULL,
speakers jsonb NOT NULL,
benefits jsonb NOT NULL,
is_illustrative boolean NOT NULL DEFAULT true,
CHECK(ends_at>starts_at),
CHECK(extract(epoch FROM ends_at-starts_at)/60=duration_mins)
);

CREATE TABLE xland.saved_events (
user_id uuid REFERENCES xland.user_profiles,
event_id uuid REFERENCES xland.events,
created_at timestamptz NOT NULL DEFAULT now(),
PRIMARY KEY(user_id,event_id)
);

CREATE TABLE xland.event_registrations (
id uuid PRIMARY KEY,
event_id uuid NOT NULL REFERENCES xland.events,
user_id uuid NOT NULL REFERENCES xland.user_profiles,
attendee_count integer NOT NULL CHECK(attendee_count>0),
contact_name text NOT NULL,
contact_phone text NOT NULL,
status text NOT NULL CHECK(status IN ('pending','registered','cancelled')),
ticket_price_snapshot numeric(20,0) NOT NULL CHECK(ticket_price_snapshot>=0),
payment_mode text NOT NULL DEFAULT 'disabled' CHECK(payment_mode IN ('disabled','simulation','live')),
created_at timestamptz NOT NULL DEFAULT now(),
UNIQUE(event_id,user_id)
);

CREATE TABLE xland.clubs (
id uuid PRIMARY KEY,
title text NOT NULL,
summary text NOT NULL,
description text NOT NULL,
region_label text NOT NULL,
activities jsonb NOT NULL,
media jsonb NOT NULL,
support_recipient_id uuid REFERENCES xland.user_profiles,
is_illustrative boolean NOT NULL DEFAULT true,
updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE xland.site_visit_slots (
id uuid PRIMARY KEY,
property_id uuid NOT NULL REFERENCES xland.properties,
consultant_id uuid REFERENCES xland.consultants,
starts_at timestamptz NOT NULL,
ends_at timestamptz NOT NULL,
time_zone text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
max_attendees integer NOT NULL CHECK(max_attendees>0),
max_bookings integer NOT NULL CHECK(max_bookings>0),
status text NOT NULL CHECK(status IN ('open','closed')),
approximate_meeting_lat numeric NOT NULL CHECK(approximate_meeting_lat BETWEEN -90 AND 90),
approximate_meeting_lng numeric NOT NULL CHECK(approximate_meeting_lng BETWEEN -180 AND 180),
radius_m integer NOT NULL CHECK(radius_m>0),
label text NOT NULL,
is_illustrative boolean NOT NULL DEFAULT true,
CHECK(ends_at>starts_at),
UNIQUE(id,property_id)
);

CREATE TABLE xland.site_visit_bookings (
id uuid PRIMARY KEY,
user_id uuid NOT NULL REFERENCES xland.user_profiles,
property_id uuid NOT NULL REFERENCES xland.properties,
consultant_id uuid REFERENCES xland.consultants,
slot_id uuid NOT NULL,
source_video_id uuid,
requested_starts_at timestamptz NOT NULL,
confirmed_starts_at timestamptz,
time_zone text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
visit_date date GENERATED ALWAYS AS ((requested_starts_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date) STORED,
time_slot time GENERATED ALWAYS AS ((requested_starts_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::time) STORED,
attendee_count integer NOT NULL CHECK(attendee_count>0),
transport_mode text NOT NULL CHECK(transport_mode IN ('self_arranged','needs_assistance')),
request_documents boolean NOT NULL,
request_loan_advice boolean NOT NULL,
customer_name text NOT NULL,
customer_phone text NOT NULL,
note text,
status text NOT NULL CHECK(status IN ('draft','awaiting_deposit','pending_confirmation','confirmed','completed','expired','cancel_requested','cancelled','reschedule_requested','rejected','no_show')),
price_snapshot numeric(20,0) NOT NULL CHECK(price_snapshot>=0),
policy_version text,
confirmed_meeting_label text,
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
is_illustrative boolean NOT NULL DEFAULT false,
FOREIGN KEY(slot_id,property_id) REFERENCES xland.site_visit_slots(id,property_id),
FOREIGN KEY(source_video_id,property_id) REFERENCES xland.videos(id,property_id),
UNIQUE(id,user_id),
CHECK(status NOT IN ('confirmed','completed') OR confirmed_starts_at IS NOT NULL)
);

CREATE TABLE xland.slot_reservations (
booking_id uuid PRIMARY KEY REFERENCES xland.site_visit_bookings,
slot_id uuid NOT NULL REFERENCES xland.site_visit_slots,
state text NOT NULL CHECK(state IN ('hold','deposit_received','confirmed','released')),
hold_expires_at timestamptz,
created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE xland.booking_status_history (
id uuid PRIMARY KEY,
booking_id uuid NOT NULL REFERENCES xland.site_visit_bookings,
from_status text NOT NULL,
to_status text NOT NULL,
occurred_at timestamptz NOT NULL DEFAULT now(),
actor_id uuid REFERENCES xland.user_profiles,
source text NOT NULL,
public_note text,
internal_note text,
CHECK(from_status<>to_status)
);

CREATE TABLE xland.payment_intents (
id uuid PRIMARY KEY,
booking_id uuid NOT NULL,
user_id uuid NOT NULL,
amount_vnd numeric(20,0) CHECK(amount_vnd>0),
currency text NOT NULL DEFAULT 'VND' CHECK(currency='VND'),
status text NOT NULL CHECK(status IN ('unpaid','pending','succeeded','failed','expired','needs_review','refund_pending','refunded')),
mode text NOT NULL CHECK(mode IN ('disabled','simulation','live')),
reference text,
policy_version text,
provider text,
expires_at timestamptz,
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
FOREIGN KEY(booking_id,user_id) REFERENCES xland.site_visit_bookings(id,user_id),
CHECK(mode='disabled' OR amount_vnd IS NOT NULL),
CHECK(mode<>'live' OR (policy_version IS NOT NULL AND provider IS NOT NULL AND reference IS NOT NULL)),
UNIQUE(provider,mode,reference)
);

CREATE TABLE xland.payment_receipts (
id uuid PRIMARY KEY,
intent_id uuid NOT NULL REFERENCES xland.payment_intents,
provider text NOT NULL,
provider_transaction_id text NOT NULL,
received_amount_vnd numeric(20,0) NOT NULL CHECK(received_amount_vnd>0),
currency text NOT NULL DEFAULT 'VND' CHECK(currency='VND'),
received_at timestamptz NOT NULL,
mode text NOT NULL CHECK(mode IN ('simulation','live')),
verification_state text NOT NULL CHECK(verification_state IN ('verified','needs_review')),
created_at timestamptz NOT NULL DEFAULT now(),
UNIQUE(provider,mode,provider_transaction_id)
);

CREATE TABLE xland.payment_provider_events (
id uuid PRIMARY KEY,
provider text NOT NULL,
mode text NOT NULL CHECK(mode IN ('simulation','live')),
provider_event_id text NOT NULL,
receipt_id uuid REFERENCES xland.payment_receipts,
payload_digest text NOT NULL,
processing_status text NOT NULL,
error_code text,
received_at timestamptz NOT NULL DEFAULT now(),
processed_at timestamptz,
redacted_evidence jsonb NOT NULL DEFAULT '{}',
UNIQUE(provider,mode,provider_event_id)
);

CREATE TABLE xland.payment_status_history (
id uuid PRIMARY KEY,
intent_id uuid NOT NULL REFERENCES xland.payment_intents,
from_status text NOT NULL,
to_status text NOT NULL,
occurred_at timestamptz NOT NULL DEFAULT now(),
source text NOT NULL,
actor_id uuid REFERENCES xland.user_profiles,
public_note text,
CHECK(from_status<>to_status)
);

CREATE TABLE xland.saved_finance_plans (
id uuid PRIMARY KEY,
user_id uuid NOT NULL REFERENCES xland.user_profiles,
property_id uuid NOT NULL REFERENCES xland.properties,
label text NOT NULL,
input jsonb NOT NULL,
price_snapshot numeric(20,0) NOT NULL,
result jsonb,
formula_version text,
rounding_rule text,
created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE xland.support_requests (
id uuid PRIMARY KEY,
user_id uuid NOT NULL REFERENCES xland.user_profiles,
property_id uuid REFERENCES xland.properties,
consultant_id uuid REFERENCES xland.consultants,
recipient_id uuid REFERENCES xland.user_profiles,
kind text NOT NULL CHECK(kind IN ('chat','legal_review','loan_advice','consultant_appointment','location_inquiry')),
status text NOT NULL CHECK(status IN ('received','pending','responded','closed')),
message text NOT NULL CHECK(length(message) BETWEEN 1 AND 2000),
contact_name text NOT NULL,
contact_phone text NOT NULL,
consent_to_share_contact boolean NOT NULL CHECK(consent_to_share_contact),
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
CHECK(property_id IS NOT NULL OR consultant_id IS NOT NULL)
);

CREATE TABLE xland.idempotency_records (
user_id uuid REFERENCES xland.user_profiles,
operation text,
key text CHECK(length(key) BETWEEN 16 AND 128),
request_hash text NOT NULL,
resource_id uuid,
response_status integer NOT NULL,
response_public jsonb,
created_at timestamptz NOT NULL DEFAULT now(),
expires_at timestamptz NOT NULL,
PRIMARY KEY(user_id,operation,key)
);

-- Useful query paths and concurrent uniqueness guard.
CREATE INDEX property_discovery ON xland.properties(status,approval_status,updated_at DESC,id DESC);
CREATE INDEX property_geo_price ON xland.properties(province_code,district_code,price_total,id);
CREATE INDEX video_feed ON xland.videos(published_at DESC,id DESC) WHERE deleted_at IS NULL AND approval_status='approved';
CREATE INDEX video_author ON xland.videos(author_id,published_at DESC,id DESC);
CREATE INDEX booking_owner ON xland.site_visit_bookings(user_id,created_at DESC,id DESC);
CREATE INDEX booking_slot ON xland.site_visit_bookings(slot_id,status);
CREATE INDEX slot_lookup ON xland.site_visit_slots(property_id,starts_at,id);
CREATE INDEX session_expiry ON xland.auth_sessions(user_id,expires_at);
CREATE INDEX event_lookup ON xland.events(status,starts_at,id);
CREATE INDEX comment_page ON xland.video_comments(video_id,created_at,id) WHERE deleted_at IS NULL;
CREATE INDEX reservation_capacity ON xland.slot_reservations(slot_id,state);
CREATE UNIQUE INDEX intent_open_unique ON xland.payment_intents(booking_id,mode) WHERE status='pending';
ALTER TABLE xland.user_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE xland.user_identities FORCE ROW LEVEL SECURITY;
ALTER TABLE xland.auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE xland.auth_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE xland.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE xland.user_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE xland.user_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE xland.user_contacts FORCE ROW LEVEL SECURITY;
ALTER TABLE xland.user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE xland.user_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE xland.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE xland.user_roles FORCE ROW LEVEL SECURITY;
ALTER TABLE xland.geo_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE xland.geo_locations FORCE ROW LEVEL SECURITY;
ALTER TABLE xland.consultants ENABLE ROW LEVEL SECURITY;
ALTER TABLE xland.consultants FORCE ROW LEVEL SECURITY;
ALTER TABLE xland.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE xland.properties FORCE ROW LEVEL SECURITY;
ALTER TABLE xland.property_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE xland.property_media FORCE ROW LEVEL SECURITY;
ALTER TABLE xland.videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE xland.videos FORCE ROW LEVEL SECURITY;
ALTER TABLE xland.video_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE xland.video_likes FORCE ROW LEVEL SECURITY;
ALTER TABLE xland.video_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE xland.video_comments FORCE ROW LEVEL SECURITY;
ALTER TABLE xland.author_follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE xland.author_follows FORCE ROW LEVEL SECURITY;
ALTER TABLE xland.saved_videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE xland.saved_videos FORCE ROW LEVEL SECURITY;
ALTER TABLE xland.saved_properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE xland.saved_properties FORCE ROW LEVEL SECURITY;
ALTER TABLE xland.property_legal_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE xland.property_legal_items FORCE ROW LEVEL SECURITY;
ALTER TABLE xland.property_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE xland.property_documents FORCE ROW LEVEL SECURITY;
ALTER TABLE xland.document_access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE xland.document_access_grants FORCE ROW LEVEL SECURITY;
ALTER TABLE xland.property_nearby_amenities ENABLE ROW LEVEL SECURITY;
ALTER TABLE xland.property_nearby_amenities FORCE ROW LEVEL SECURITY;
ALTER TABLE xland.consultant_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE xland.consultant_reviews FORCE ROW LEVEL SECURITY;
ALTER TABLE xland.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE xland.events FORCE ROW LEVEL SECURITY;
ALTER TABLE xland.saved_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE xland.saved_events FORCE ROW LEVEL SECURITY;
ALTER TABLE xland.event_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE xland.event_registrations FORCE ROW LEVEL SECURITY;
ALTER TABLE xland.clubs ENABLE ROW LEVEL SECURITY;
ALTER TABLE xland.clubs FORCE ROW LEVEL SECURITY;
ALTER TABLE xland.site_visit_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE xland.site_visit_slots FORCE ROW LEVEL SECURITY;
ALTER TABLE xland.site_visit_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE xland.site_visit_bookings FORCE ROW LEVEL SECURITY;
ALTER TABLE xland.slot_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE xland.slot_reservations FORCE ROW LEVEL SECURITY;
ALTER TABLE xland.booking_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE xland.booking_status_history FORCE ROW LEVEL SECURITY;
ALTER TABLE xland.payment_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE xland.payment_intents FORCE ROW LEVEL SECURITY;
ALTER TABLE xland.payment_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE xland.payment_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE xland.payment_provider_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE xland.payment_provider_events FORCE ROW LEVEL SECURITY;
ALTER TABLE xland.payment_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE xland.payment_status_history FORCE ROW LEVEL SECURITY;
ALTER TABLE xland.saved_finance_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE xland.saved_finance_plans FORCE ROW LEVEL SECURITY;
ALTER TABLE xland.support_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE xland.support_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE xland.idempotency_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE xland.idempotency_records FORCE ROW LEVEL SECURITY;
CREATE POLICY public_read ON xland.user_profiles FOR SELECT TO xland_api USING (true);
CREATE POLICY public_read ON xland.consultants FOR SELECT TO xland_api USING (true);
CREATE POLICY public_read ON xland.geo_locations FOR SELECT TO xland_api USING (true);
CREATE POLICY public_read ON xland.properties FOR SELECT TO xland_api USING (approval_status='approved');
CREATE POLICY public_read ON xland.property_media FOR SELECT TO xland_api USING (true);
CREATE POLICY public_read ON xland.videos FOR SELECT TO xland_api USING (approval_status='approved' AND deleted_at IS NULL AND EXISTS(SELECT 1 FROM xland.properties p WHERE p.id=property_id));
CREATE POLICY public_read ON xland.property_legal_items FOR SELECT TO xland_api USING (true);
CREATE POLICY public_read ON xland.property_documents FOR SELECT TO xland_api USING (true);
CREATE POLICY public_read ON xland.property_nearby_amenities FOR SELECT TO xland_api USING (true);
CREATE POLICY public_read ON xland.consultant_reviews FOR SELECT TO xland_api USING (true);
CREATE POLICY public_read ON xland.events FOR SELECT TO xland_api USING (true);
CREATE POLICY public_read ON xland.clubs FOR SELECT TO xland_api USING (true);
CREATE POLICY public_read ON xland.site_visit_slots FOR SELECT TO xland_api USING (true);
GRANT SELECT ON xland.user_profiles,xland.consultants,xland.geo_locations,xland.videos,xland.property_legal_items,xland.property_nearby_amenities,xland.consultant_reviews,xland.events,xland.clubs,xland.site_visit_slots TO xland_api;
GRANT SELECT(id,code,title,province,province_code,district,district_code,catalog_version,region,category,price_total,frontage_m,depth_m,road_width_m,direction,land_type,status,status_badge,approval_status,consultant_id,highlights,approximate_lat,approximate_lng,approximate_radius_m,is_illustrative,created_at,updated_at) ON xland.properties TO xland_api;
GRANT SELECT(id,property_id,kind,usage,public_url,thumbnail_url,alt_text,duration_seconds,sort_order,is_illustrative) ON xland.property_media TO xland_api;
GRANT SELECT(id,property_id,title,file_type,mime_type,size_bytes,uploaded_date,access_level,public_preview_url,is_illustrative) ON xland.property_documents TO xland_api;
CREATE POLICY owned ON xland.user_contacts TO xland_api USING (user_id=xland.current_user_id()) WITH CHECK (user_id=xland.current_user_id());
GRANT SELECT ON xland.user_contacts TO xland_api;
CREATE POLICY owned ON xland.user_settings TO xland_api USING (user_id=xland.current_user_id()) WITH CHECK (user_id=xland.current_user_id());
GRANT SELECT ON xland.user_settings TO xland_api;
CREATE POLICY owned ON xland.video_likes TO xland_api USING (user_id=xland.current_user_id()) WITH CHECK (user_id=xland.current_user_id());
GRANT SELECT ON xland.video_likes TO xland_api;
CREATE POLICY owned ON xland.author_follows TO xland_api USING (follower_id=xland.current_user_id()) WITH CHECK (follower_id=xland.current_user_id());
GRANT SELECT ON xland.author_follows TO xland_api;
CREATE POLICY owned ON xland.saved_videos TO xland_api USING (user_id=xland.current_user_id()) WITH CHECK (user_id=xland.current_user_id());
GRANT SELECT ON xland.saved_videos TO xland_api;
CREATE POLICY owned ON xland.saved_properties TO xland_api USING (user_id=xland.current_user_id()) WITH CHECK (user_id=xland.current_user_id());
GRANT SELECT ON xland.saved_properties TO xland_api;
CREATE POLICY owned ON xland.saved_events TO xland_api USING (user_id=xland.current_user_id()) WITH CHECK (user_id=xland.current_user_id());
GRANT SELECT ON xland.saved_events TO xland_api;
CREATE POLICY owned ON xland.event_registrations TO xland_api USING (user_id=xland.current_user_id()) WITH CHECK (user_id=xland.current_user_id());
GRANT SELECT ON xland.event_registrations TO xland_api;
CREATE POLICY owned ON xland.site_visit_bookings TO xland_api USING (user_id=xland.current_user_id()) WITH CHECK (user_id=xland.current_user_id());
GRANT SELECT ON xland.site_visit_bookings TO xland_api;
CREATE POLICY owned ON xland.saved_finance_plans TO xland_api USING (user_id=xland.current_user_id()) WITH CHECK (user_id=xland.current_user_id());
GRANT SELECT ON xland.saved_finance_plans TO xland_api;
CREATE POLICY owned ON xland.support_requests TO xland_api USING (user_id=xland.current_user_id()) WITH CHECK (user_id=xland.current_user_id());
GRANT SELECT ON xland.support_requests TO xland_api;
CREATE POLICY owned ON xland.idempotency_records TO xland_api USING (user_id=xland.current_user_id()) WITH CHECK (user_id=xland.current_user_id());
GRANT SELECT ON xland.idempotency_records TO xland_api;
GRANT INSERT,DELETE ON xland.video_likes,xland.author_follows,xland.saved_videos,xland.saved_properties,xland.saved_events TO xland_api;
GRANT UPDATE(display_name,avatar_url,updated_at) ON xland.user_profiles TO xland_api;
CREATE POLICY owned_update ON xland.user_profiles FOR UPDATE TO xland_api USING(id=xland.current_user_id()) WITH CHECK(id=xland.current_user_id());
GRANT UPDATE(phone,phone_verified_at,updated_at) ON xland.user_contacts TO xland_api;
GRANT UPDATE(notification_consent,feed_autoplay,feed_muted_by_default,updated_at) ON xland.user_settings TO xland_api;
GRANT INSERT ON xland.site_visit_bookings,xland.event_registrations,xland.support_requests,xland.idempotency_records TO xland_api;
GRANT UPDATE(resource_id,response_status,response_public) ON xland.idempotency_records TO xland_api;
GRANT DELETE ON xland.saved_finance_plans TO xland_api;
CREATE POLICY comment_read ON xland.video_comments FOR SELECT TO xland_api USING(deleted_at IS NULL);
CREATE POLICY comment_owned ON xland.video_comments FOR INSERT TO xland_api WITH CHECK(author_id=xland.current_user_id());
CREATE POLICY comment_delete ON xland.video_comments FOR UPDATE TO xland_api USING(author_id=xland.current_user_id()) WITH CHECK(author_id=xland.current_user_id());
GRANT SELECT,INSERT ON xland.video_comments TO xland_api;
GRANT UPDATE(deleted_at) ON xland.video_comments TO xland_api;
CREATE POLICY reservation_owner ON xland.slot_reservations TO xland_api USING(EXISTS(SELECT 1 FROM xland.site_visit_bookings b WHERE b.id=booking_id)) WITH CHECK(EXISTS(SELECT 1 FROM xland.site_visit_bookings b WHERE b.id=booking_id));
GRANT SELECT,INSERT ON xland.slot_reservations TO xland_api;
CREATE POLICY grant_owner ON xland.document_access_grants FOR SELECT TO xland_api USING(user_id=xland.current_user_id());
GRANT SELECT ON xland.document_access_grants TO xland_api;
CREATE POLICY booking_history_owner ON xland.booking_status_history TO xland_api USING(EXISTS(SELECT 1 FROM xland.site_visit_bookings b WHERE b.id=booking_id)) WITH CHECK(EXISTS(SELECT 1 FROM xland.site_visit_bookings b WHERE b.id=booking_id));
GRANT SELECT(id,booking_id,from_status,to_status,occurred_at,actor_id,source,public_note),INSERT ON xland.booking_status_history TO xland_api;
CREATE POLICY payment_owner ON xland.payment_intents FOR SELECT TO xland_api USING(user_id=xland.current_user_id());
GRANT SELECT ON xland.payment_intents TO xland_api;
CREATE POLICY auth_service ON xland.user_identities TO xland_auth USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE ON xland.user_identities TO xland_auth;
CREATE POLICY auth_service ON xland.auth_sessions TO xland_auth USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE ON xland.auth_sessions TO xland_auth;
CREATE POLICY auth_service ON xland.user_profiles TO xland_auth USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE ON xland.user_profiles TO xland_auth;
CREATE POLICY auth_service ON xland.user_contacts TO xland_auth USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE ON xland.user_contacts TO xland_auth;
CREATE POLICY auth_service ON xland.user_settings TO xland_auth USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE ON xland.user_settings TO xland_auth;
CREATE POLICY auth_service ON xland.user_roles TO xland_auth USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE ON xland.user_roles TO xland_auth;
CREATE POLICY payment_service ON xland.payment_intents TO xland_payment USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE ON xland.payment_intents TO xland_payment;
CREATE POLICY payment_service ON xland.payment_receipts TO xland_payment USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE ON xland.payment_receipts TO xland_payment;
CREATE POLICY payment_service ON xland.payment_provider_events TO xland_payment USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE ON xland.payment_provider_events TO xland_payment;
CREATE POLICY payment_service ON xland.payment_status_history TO xland_payment USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE ON xland.payment_status_history TO xland_payment;
CREATE POLICY payment_service ON xland.site_visit_bookings TO xland_payment USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE ON xland.site_visit_bookings TO xland_payment;
CREATE POLICY payment_service ON xland.booking_status_history TO xland_payment USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE ON xland.booking_status_history TO xland_payment;
CREATE POLICY payment_service ON xland.slot_reservations TO xland_payment USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE ON xland.slot_reservations TO xland_payment;
-- Transactions lock public inventory rows without granting writable business fields.
GRANT UPDATE(id) ON xland.site_visit_slots,xland.events TO xland_api;
CREATE POLICY slot_lock ON xland.site_visit_slots FOR UPDATE TO xland_api USING(true) WITH CHECK(true);
CREATE POLICY event_lock ON xland.events FOR UPDATE TO xland_api USING(true) WITH CHECK(true);

