-- 0008: who edited a record that later goes through maker-checker approval.
-- Anyone who changed a draft is a "maker" for it and may not approve it
-- (closes the "approver rewrites someone else's draft, then approves it" path).

CREATE TABLE record_editors (
  organization_id  uuid NOT NULL,
  entity_type      text NOT NULL,
  entity_id        uuid NOT NULL,
  user_id          uuid NOT NULL,
  first_edited_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, entity_type, entity_id, user_id),
  FOREIGN KEY (organization_id, user_id) REFERENCES users (organization_id, id) ON DELETE RESTRICT
);

-- Append-only: an editor can't erase their trail before approval.
CREATE OR REPLACE FUNCTION record_editors_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'record_editors is append-only' USING ERRCODE = '42501';
END $$;
CREATE TRIGGER record_editors_no_update BEFORE UPDATE OR DELETE ON record_editors
  FOR EACH ROW EXECUTE FUNCTION record_editors_append_only();
