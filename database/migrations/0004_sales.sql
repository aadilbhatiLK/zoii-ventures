-- 0004_sales.sql — Sprint 3: catalogue & pricing, versioned GST rules, BRD/PRD documents with
-- immutable approved versions, quotations with server-computed tax and revisions, approvals.

BEGIN;

-- ---------- catalogue ----------
CREATE TABLE products (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  code             text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{1,30}$'),
  name             text NOT NULL CHECK (length(trim(name)) >= 2),
  description      text,
  product_line     text NOT NULL REFERENCES product_lines(key),
  kind             text NOT NULL CHECK (kind IN ('one_time', 'recurring', 'service')),
  billing_cycle    text NOT NULL DEFAULT 'one_time' CHECK (billing_cycle IN ('one_time', 'monthly', 'quarterly', 'yearly')),
  unit             text NOT NULL DEFAULT 'unit',
  hsn_sac          text NOT NULL CHECK (hsn_sac ~ '^[0-9]{4,8}$'),
  unit_price       numeric(15, 2) NOT NULL CHECK (unit_price >= 0),
  -- Below this price a quotation line needs approval (pricing floor).
  floor_price      numeric(15, 2) CHECK (floor_price IS NULL OR floor_price >= 0),
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code),
  UNIQUE (organization_id, id),
  CHECK ((kind = 'recurring') = (billing_cycle <> 'one_time'))
);
CREATE TRIGGER products_updated BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Price history: every price change is a new row; quotations snapshot the price used.
CREATE TABLE product_price_history (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id  uuid NOT NULL,
  product_id       uuid NOT NULL,
  unit_price       numeric(15, 2) NOT NULL,
  floor_price      numeric(15, 2),
  changed_by       uuid,
  changed_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, product_id) REFERENCES products (organization_id, id) ON DELETE CASCADE
);

-- ---------- GST rules (versioned by effective date) ----------
CREATE TABLE tax_rules (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  hsn_sac          text NOT NULL CHECK (hsn_sac ~ '^[0-9]{4,8}$'),
  description      text NOT NULL,
  rate             numeric(5, 2) NOT NULL CHECK (rate >= 0 AND rate <= 40),
  effective_from   date NOT NULL,
  effective_to     date,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, hsn_sac, effective_from),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
-- Rate lookups match the longest HSN/SAC prefix in force on the document date.
CREATE INDEX tax_rules_lookup ON tax_rules (organization_id, hsn_sac, effective_from DESC);

CREATE OR REPLACE FUNCTION tax_rules_no_overlap() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM tax_rules t
     WHERE t.organization_id = NEW.organization_id AND t.hsn_sac = NEW.hsn_sac AND t.id <> NEW.id
       AND daterange(t.effective_from, t.effective_to, '[]') && daterange(NEW.effective_from, NEW.effective_to, '[]')
  ) THEN
    RAISE EXCEPTION 'Tax rule periods for HSN/SAC % overlap', NEW.hsn_sac USING ERRCODE = 'exclusion_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tax_rules_overlap BEFORE INSERT OR UPDATE ON tax_rules FOR EACH ROW EXECUTE FUNCTION tax_rules_no_overlap();

-- ---------- documents (BRD / PRD / SOW) ----------
CREATE TABLE documents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  number           text NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('brd', 'prd', 'sow', 'other')),
  title            text NOT NULL CHECK (length(trim(title)) >= 3),
  client_id        uuid,
  lead_id          uuid,
  owner_id         uuid NOT NULL,
  -- Latest approved version (what downstream records may reference), if any.
  approved_version smallint,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, number),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, client_id) REFERENCES clients (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, lead_id) REFERENCES leads (organization_id, id) ON DELETE SET NULL (lead_id),
  FOREIGN KEY (organization_id, owner_id) REFERENCES users (organization_id, id) ON DELETE RESTRICT,
  CHECK (client_id IS NOT NULL OR lead_id IS NOT NULL)
);
CREATE TRIGGER documents_updated BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE document_versions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  document_id      uuid NOT NULL,
  version          smallint NOT NULL CHECK (version >= 1),
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_review', 'approved', 'rejected', 'superseded')),
  content          text NOT NULL DEFAULT '',
  content_sha256   text,
  change_summary   text,
  author_id        uuid NOT NULL,
  submitted_at     timestamptz,
  decided_by       uuid,
  decided_at       timestamptz,
  decision_note    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, version),
  FOREIGN KEY (organization_id, document_id) REFERENCES documents (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, author_id) REFERENCES users (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, decided_by) REFERENCES users (organization_id, id) ON DELETE RESTRICT,
  -- Maker-checker: nobody approves their own document.
  CHECK (status <> 'approved' OR (decided_by IS NOT NULL AND decided_by <> author_id AND content_sha256 IS NOT NULL))
);
-- At most one editable or in-review version per document.
CREATE UNIQUE INDEX document_versions_one_open ON document_versions (document_id) WHERE status IN ('draft', 'in_review');

-- Approved versions are frozen: content can never change and the row can only move to superseded.
CREATE OR REPLACE FUNCTION document_versions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'Only draft versions can be deleted' USING ERRCODE = 'insufficient_privilege'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('approved', 'superseded') THEN
    IF NEW.content IS DISTINCT FROM OLD.content OR NEW.content_sha256 IS DISTINCT FROM OLD.content_sha256
       OR NEW.decided_by IS DISTINCT FROM OLD.decided_by OR NEW.version <> OLD.version
       OR NOT (NEW.status = OLD.status OR (OLD.status = 'approved' AND NEW.status = 'superseded')) THEN
      RAISE EXCEPTION 'Approved document versions are immutable' USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF OLD.status IN ('in_review', 'rejected') AND NEW.content IS DISTINCT FROM OLD.content THEN
    RAISE EXCEPTION 'Only draft versions can be edited' USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER document_versions_guard BEFORE UPDATE OR DELETE ON document_versions FOR EACH ROW EXECUTE FUNCTION document_versions_guard();

-- ---------- approvals (generic maker-checker inbox) ----------
CREATE TABLE approval_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  entity_type      text NOT NULL CHECK (entity_type IN ('document_version', 'quotation', 'change_request', 'payroll_run', 'leave_request', 'journal_entry')),
  entity_id        uuid NOT NULL,
  title            text NOT NULL,
  reason           text NOT NULL,
  required_permission text NOT NULL REFERENCES permissions(key),
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by     uuid NOT NULL,
  requested_at     timestamptz NOT NULL DEFAULT now(),
  decided_by       uuid,
  decided_at       timestamptz,
  decision_note    text,
  FOREIGN KEY (organization_id, requested_by) REFERENCES users (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, decided_by) REFERENCES users (organization_id, id) ON DELETE RESTRICT,
  CHECK ((status = 'pending') = (decided_at IS NULL)),
  CHECK (status NOT IN ('approved', 'rejected') OR (decided_by IS NOT NULL AND decided_by <> requested_by))
);
CREATE UNIQUE INDEX approval_requests_one_pending ON approval_requests (entity_type, entity_id) WHERE status = 'pending';
CREATE INDEX approval_requests_inbox ON approval_requests (organization_id, required_permission, requested_at DESC) WHERE status = 'pending';

-- ---------- quotations ----------
CREATE TABLE quotations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  -- Base number shared by all revisions (ZV/QT/2627/0017); revision 1 is the original.
  number           text NOT NULL,
  revision         smallint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  previous_id      uuid,
  client_id        uuid NOT NULL,
  lead_id          uuid,
  document_id      uuid,
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_approval', 'approved', 'sent', 'accepted', 'rejected', 'expired', 'superseded', 'cancelled')),
  quote_date       date NOT NULL,
  valid_until      date NOT NULL,
  supplier_state   char(2) NOT NULL,
  place_of_supply  char(2) NOT NULL,
  supply_type      text NOT NULL CHECK (supply_type IN ('intra', 'inter')),
  subtotal         numeric(15, 2) NOT NULL DEFAULT 0,
  discount_total   numeric(15, 2) NOT NULL DEFAULT 0,
  taxable_total    numeric(15, 2) NOT NULL DEFAULT 0,
  cgst             numeric(15, 2) NOT NULL DEFAULT 0,
  sgst             numeric(15, 2) NOT NULL DEFAULT 0,
  igst             numeric(15, 2) NOT NULL DEFAULT 0,
  grand_total      numeric(15, 2) NOT NULL DEFAULT 0,
  notes            text,
  terms            text,
  approval_reasons text[] NOT NULL DEFAULT '{}',
  owner_id         uuid NOT NULL,
  approved_by      uuid,
  approved_at      timestamptz,
  sent_at          timestamptz,
  decided_at       timestamptz,
  client_decision_note text,
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, number, revision),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, client_id) REFERENCES clients (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, lead_id) REFERENCES leads (organization_id, id) ON DELETE SET NULL (lead_id),
  FOREIGN KEY (organization_id, document_id) REFERENCES documents (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, previous_id) REFERENCES quotations (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, owner_id) REFERENCES users (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, approved_by) REFERENCES users (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, created_by) REFERENCES users (organization_id, id) ON DELETE RESTRICT,
  CHECK (valid_until >= quote_date),
  CHECK (supply_type = CASE WHEN supplier_state = place_of_supply THEN 'intra' ELSE 'inter' END),
  CHECK (taxable_total = subtotal - discount_total),
  CHECK (grand_total = taxable_total + cgst + sgst + igst),
  CHECK (supply_type = 'intra' OR (cgst = 0 AND sgst = 0)),
  CHECK (supply_type = 'inter' OR igst = 0),
  CHECK (approved_by IS NULL OR approved_by <> created_by)
);
CREATE TRIGGER quotations_updated BEFORE UPDATE ON quotations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX quotations_client ON quotations (organization_id, client_id, created_at DESC);
-- One live revision per quotation number.
CREATE UNIQUE INDEX quotations_one_live ON quotations (organization_id, number) WHERE status NOT IN ('superseded', 'cancelled');

CREATE TABLE quotation_lines (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  quotation_id     uuid NOT NULL,
  line_no          smallint NOT NULL CHECK (line_no >= 1),
  product_id       uuid,
  description      text NOT NULL CHECK (length(trim(description)) >= 2),
  hsn_sac          text NOT NULL CHECK (hsn_sac ~ '^[0-9]{4,8}$'),
  billing_cycle    text NOT NULL DEFAULT 'one_time' CHECK (billing_cycle IN ('one_time', 'monthly', 'quarterly', 'yearly')),
  quantity         numeric(12, 3) NOT NULL CHECK (quantity > 0),
  unit_price       numeric(15, 2) NOT NULL CHECK (unit_price >= 0),
  list_price       numeric(15, 2),
  discount_pct     numeric(5, 2) NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
  tax_rate         numeric(5, 2) NOT NULL CHECK (tax_rate BETWEEN 0 AND 40),
  gross            numeric(15, 2) NOT NULL,
  discount         numeric(15, 2) NOT NULL,
  taxable          numeric(15, 2) NOT NULL,
  cgst             numeric(15, 2) NOT NULL,
  sgst             numeric(15, 2) NOT NULL,
  igst             numeric(15, 2) NOT NULL,
  total            numeric(15, 2) NOT NULL,
  UNIQUE (quotation_id, line_no),
  FOREIGN KEY (organization_id, quotation_id) REFERENCES quotations (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, product_id) REFERENCES products (organization_id, id) ON DELETE RESTRICT,
  CHECK (taxable = gross - discount),
  CHECK (total = taxable + cgst + sgst + igst)
);

-- Once a quotation leaves draft its money is frozen; changes need a new revision.
CREATE OR REPLACE FUNCTION quotations_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'draft' AND (
       NEW.subtotal <> OLD.subtotal OR NEW.discount_total <> OLD.discount_total OR NEW.grand_total <> OLD.grand_total
       OR NEW.cgst <> OLD.cgst OR NEW.sgst <> OLD.sgst OR NEW.igst <> OLD.igst OR NEW.client_id <> OLD.client_id
       OR NEW.place_of_supply <> OLD.place_of_supply OR NEW.valid_until <> OLD.valid_until OR NEW.terms IS DISTINCT FROM OLD.terms) THEN
    RAISE EXCEPTION 'Quotation % is no longer a draft; create a revision instead', OLD.number USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER quotations_freeze BEFORE UPDATE ON quotations FOR EACH ROW EXECUTE FUNCTION quotations_freeze();

CREATE OR REPLACE FUNCTION quotation_lines_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM quotations WHERE id = coalesce(NEW.quotation_id, OLD.quotation_id);
  IF st IS NOT NULL AND st <> 'draft' THEN
    RAISE EXCEPTION 'Lines of a non-draft quotation cannot change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
CREATE TRIGGER quotation_lines_freeze BEFORE INSERT OR UPDATE OR DELETE ON quotation_lines FOR EACH ROW EXECUTE FUNCTION quotation_lines_freeze();

COMMIT;
