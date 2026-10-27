-- Contact addresses remain private under the existing user_contacts RLS policies.
ALTER TABLE xland.user_contacts ADD COLUMN address text CHECK (length(address) <= 500);
GRANT UPDATE(address) ON xland.user_contacts TO xland_api;
ALTER TABLE xland.user_profiles DROP CONSTRAINT user_profiles_display_name_check;
ALTER TABLE xland.user_profiles ADD CONSTRAINT user_profiles_display_name_check CHECK (length(display_name) <= 100);
