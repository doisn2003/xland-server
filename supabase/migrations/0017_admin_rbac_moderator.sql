-- Expand user_roles check constraint to include 'moderator'
ALTER TABLE xland.user_roles DROP CONSTRAINT user_roles_role_check;
ALTER TABLE xland.user_roles ADD CONSTRAINT user_roles_role_check
  CHECK(role IN ('customer','consultant','coordinator','payment_operator','admin','moderator'));

-- Grant role management permissions to xland_admin for RBAC administration
GRANT INSERT, UPDATE, DELETE ON xland.user_roles TO xland_admin;
CREATE POLICY admin_insert ON xland.user_roles FOR INSERT TO xland_admin WITH CHECK(true);
CREATE POLICY admin_update ON xland.user_roles FOR UPDATE TO xland_admin USING(true) WITH CHECK(true);
CREATE POLICY admin_delete ON xland.user_roles FOR DELETE TO xland_admin USING(true);
