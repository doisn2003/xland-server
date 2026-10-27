-- A plot is a full property; adjacency supports nested subdivisions.
ALTER TABLE xland.properties
  ADD COLUMN parent_property_id uuid REFERENCES xland.properties(id) ON DELETE RESTRICT,
  ADD COLUMN has_subplots boolean NOT NULL DEFAULT false,
  ADD COLUMN is_corner boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT property_not_own_parent CHECK(parent_property_id IS DISTINCT FROM id);
CREATE INDEX property_children ON xland.properties(parent_property_id,code,id);
GRANT SELECT(parent_property_id,has_subplots,is_corner) ON xland.properties TO xland_api;

-- Serialize topology/area writes, including direct SQL, before taking row locks.
CREATE FUNCTION xland.lock_property_tree() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog AS $$ BEGIN
  PERFORM pg_advisory_xact_lock(193726,19);
  RETURN NULL;
END $$;
CREATE TRIGGER property_tree_lock BEFORE INSERT OR UPDATE OR DELETE ON xland.properties
  FOR EACH STATEMENT EXECUTE FUNCTION xland.lock_property_tree();

CREATE FUNCTION xland.guard_property_tree() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog AS $$
DECLARE parent xland.properties; allocated numeric; cycle_found boolean;
BEGIN
  IF NEW.parent_property_id IS NOT NULL THEN
    SELECT * INTO parent FROM xland.properties WHERE id=NEW.parent_property_id;
    IF NOT FOUND OR NOT parent.has_subplots THEN
      RAISE EXCEPTION 'Lô cha phải bật Nhiều lô đất con.' USING ERRCODE='23514', COLUMN='parent_property_id';
    END IF;
    WITH RECURSIVE ancestors AS (
      SELECT id,parent_property_id FROM xland.properties WHERE id=NEW.parent_property_id
      UNION SELECT p.id,p.parent_property_id FROM xland.properties p JOIN ancestors a ON p.id=a.parent_property_id
    ) SELECT EXISTS(SELECT 1 FROM ancestors WHERE id=NEW.id) INTO cycle_found;
    IF cycle_found THEN RAISE EXCEPTION 'Không thể tạo vòng lặp lô cha–con.' USING ERRCODE='23514', COLUMN='parent_property_id'; END IF;
    SELECT COALESCE(sum(area_m2),0) INTO allocated FROM xland.properties WHERE parent_property_id=parent.id AND id<>NEW.id;
    IF allocated+NEW.area_m2>parent.area_m2 THEN
      RAISE EXCEPTION 'Tổng diện tích các lô con vượt diện tích lô cha.' USING ERRCODE='23514', COLUMN='area_m2';
    END IF;
  END IF;
  SELECT COALESCE(sum(area_m2),0) INTO allocated FROM xland.properties WHERE parent_property_id=NEW.id;
  IF allocated>0 AND NOT NEW.has_subplots THEN
    RAISE EXCEPTION 'Cần chuyển các lô con sang hồ sơ khác trước khi tắt chế độ nhiều lô.' USING ERRCODE='23514', COLUMN='has_subplots';
  END IF;
  IF allocated>NEW.area_m2 THEN
    RAISE EXCEPTION 'Diện tích lô cha không được nhỏ hơn tổng diện tích các lô con.' USING ERRCODE='23514', COLUMN='area_m2';
  END IF;
  RETURN NEW;
END $$;
ALTER FUNCTION xland.guard_property_tree() OWNER TO xland_admin;
REVOKE ALL ON FUNCTION xland.guard_property_tree() FROM PUBLIC;
CREATE TRIGGER property_tree_guard BEFORE INSERT OR UPDATE ON xland.properties
  FOR EACH ROW EXECUTE FUNCTION xland.guard_property_tree();

-- Use the narrowly scoped admin reader to avoid recursive RLS evaluation.
-- No hidden ancestor identifiers or content are exposed by this boolean function.
CREATE FUNCTION xland.property_ancestors_public(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  WITH RECURSIVE ancestors AS (
    SELECT id,parent_property_id,approval_status FROM xland.properties WHERE id=target
    UNION SELECT p.id,p.parent_property_id,p.approval_status FROM xland.properties p JOIN ancestors a ON p.id=a.parent_property_id
  ) SELECT target IS NULL OR (EXISTS(SELECT 1 FROM ancestors) AND NOT EXISTS(SELECT 1 FROM ancestors WHERE approval_status<>'approved'));
$$;
ALTER FUNCTION xland.property_ancestors_public(uuid) OWNER TO xland_admin;
REVOKE ALL ON FUNCTION xland.property_ancestors_public(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION xland.property_ancestors_public(uuid) TO xland_api;
ALTER POLICY public_read ON xland.properties USING (approval_status='approved' AND xland.property_ancestors_public(parent_property_id));
