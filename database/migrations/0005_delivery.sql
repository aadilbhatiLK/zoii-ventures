-- 0005_delivery.sql — Sprint 4: sales orders from accepted quotations, projects with
-- activation rules, milestones, tasks, change requests, UAT, sign-off, subscriptions & AMC.

BEGIN;

CREATE TABLE sales_orders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  number           text NOT NULL,
  client_id        uuid NOT NULL,
  quotation_id     uuid NOT NULL,
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'cancelled')),
  order_date       date NOT NULL,
  -- Snapshot of the accepted quotation's totals; changes go through change requests.
  taxable_total    numeric(15, 2) NOT NULL,
  tax_total        numeric(15, 2) NOT NULL,
  grand_total      numeric(15, 2) NOT NULL,
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, number),
  UNIQUE (organization_id, id),
  -- One order per accepted quotation, even under concurrent requests.
  UNIQUE (organization_id, quotation_id),
  FOREIGN KEY (organization_id, client_id) REFERENCES clients (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, quotation_id) REFERENCES quotations (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, created_by) REFERENCES users (organization_id, id) ON DELETE RESTRICT,
  CHECK (grand_total = taxable_total + tax_total)
);
CREATE TRIGGER sales_orders_updated BEFORE UPDATE ON sales_orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE projects (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  code             text NOT NULL,
  name             text NOT NULL CHECK (length(trim(name)) >= 3),
  client_id        uuid NOT NULL,
  sales_order_id   uuid,
  scope_document_id uuid,
  billable         boolean NOT NULL DEFAULT true,
  status           text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'on_hold', 'completed', 'cancelled')),
  manager_id       uuid NOT NULL,
  start_date       date,
  due_date         date,
  activated_at     timestamptz,
  activated_by     uuid,
  completed_at     timestamptz,
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, client_id) REFERENCES clients (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, sales_order_id) REFERENCES sales_orders (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, scope_document_id) REFERENCES documents (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, manager_id) REFERENCES users (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, activated_by) REFERENCES users (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, created_by) REFERENCES users (organization_id, id) ON DELETE RESTRICT,
  -- A billable project can only run against a sales order (i.e. an accepted quotation).
  CHECK (NOT billable OR status IN ('planned', 'cancelled') OR sales_order_id IS NOT NULL),
  CHECK ((status IN ('planned')) OR activated_at IS NOT NULL OR status = 'cancelled'),
  CHECK (due_date IS NULL OR start_date IS NULL OR due_date >= start_date)
);
CREATE TRIGGER projects_updated BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE project_members (
  organization_id  uuid NOT NULL,
  project_id       uuid NOT NULL,
  user_id          uuid NOT NULL,
  role             text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'lead')),
  PRIMARY KEY (project_id, user_id),
  FOREIGN KEY (organization_id, project_id) REFERENCES projects (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, user_id) REFERENCES users (organization_id, id) ON DELETE CASCADE
);

CREATE TABLE milestones (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  project_id       uuid NOT NULL,
  seq              smallint NOT NULL CHECK (seq >= 1),
  name             text NOT NULL,
  due_date         date,
  -- Billing value (pre-tax) released when the milestone is signed off.
  amount           numeric(15, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'uat', 'signed_off', 'invoiced')),
  signed_off_at    timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, seq),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, project_id) REFERENCES projects (organization_id, id) ON DELETE CASCADE,
  CHECK ((status IN ('signed_off', 'invoiced')) = (signed_off_at IS NOT NULL))
);

CREATE TABLE tasks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  project_id       uuid NOT NULL,
  milestone_id     uuid,
  title            text NOT NULL CHECK (length(trim(title)) >= 2),
  description      text,
  status           text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'review', 'done', 'blocked')),
  priority         text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  assignee_id      uuid,
  due_date         date,
  estimate_hours   numeric(6, 2) CHECK (estimate_hours IS NULL OR estimate_hours >= 0),
  sort             integer NOT NULL DEFAULT 0,
  completed_at     timestamptz,
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, project_id) REFERENCES projects (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, milestone_id) REFERENCES milestones (organization_id, id) ON DELETE SET NULL (milestone_id),
  FOREIGN KEY (organization_id, assignee_id) REFERENCES users (organization_id, id) ON DELETE SET NULL (assignee_id),
  FOREIGN KEY (organization_id, created_by) REFERENCES users (organization_id, id) ON DELETE RESTRICT,
  CHECK ((status = 'done') = (completed_at IS NOT NULL))
);
CREATE TRIGGER tasks_updated BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX tasks_project ON tasks (project_id, status, sort);
CREATE INDEX tasks_assignee ON tasks (organization_id, assignee_id, status) WHERE assignee_id IS NOT NULL;

CREATE TABLE change_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  project_id       uuid NOT NULL,
  number           text NOT NULL,
  title            text NOT NULL,
  description      text NOT NULL,
  -- Commercial and schedule impact; a positive amount is billed as extra work.
  impact_amount    numeric(15, 2) NOT NULL DEFAULT 0 CHECK (impact_amount >= 0),
  impact_days      integer NOT NULL DEFAULT 0 CHECK (impact_days >= 0),
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'cancelled')),
  client_approved  boolean NOT NULL DEFAULT false,
  requested_by     uuid NOT NULL,
  decided_by       uuid,
  decided_at       timestamptz,
  decision_note    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, number),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, project_id) REFERENCES projects (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, requested_by) REFERENCES users (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, decided_by) REFERENCES users (organization_id, id) ON DELETE RESTRICT,
  CHECK (status <> 'approved' OR (decided_by IS NOT NULL AND decided_by <> requested_by AND client_approved))
);

CREATE TABLE uat_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  project_id       uuid NOT NULL,
  milestone_id     uuid NOT NULL,
  title            text NOT NULL,
  expected_result  text,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'passed', 'failed')),
  tested_by_name   text,
  notes            text,
  updated_by       uuid,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id) REFERENCES projects (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, milestone_id) REFERENCES milestones (organization_id, id) ON DELETE CASCADE
);

-- Client sign-off evidence. E-sign isn't integrated: the record captures who signed, how and when.
CREATE TABLE signoffs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  project_id       uuid NOT NULL,
  milestone_id     uuid NOT NULL UNIQUE,
  signed_by_name   text NOT NULL,
  signed_by_email  text,
  method           text NOT NULL CHECK (method IN ('email_confirmation', 'signed_document', 'in_person')),
  evidence_ref     text NOT NULL,
  signed_at        timestamptz NOT NULL,
  recorded_by      uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id) REFERENCES projects (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, milestone_id) REFERENCES milestones (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, recorded_by) REFERENCES users (organization_id, id) ON DELETE RESTRICT
);
CREATE TRIGGER signoffs_append_only BEFORE UPDATE OR DELETE ON signoffs FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE subscriptions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  number           text NOT NULL,
  client_id        uuid NOT NULL,
  product_id       uuid,
  sales_order_id   uuid,
  kind             text NOT NULL CHECK (kind IN ('subscription', 'amc')),
  description      text NOT NULL,
  hsn_sac          text NOT NULL CHECK (hsn_sac ~ '^[0-9]{4,8}$'),
  amount           numeric(15, 2) NOT NULL CHECK (amount > 0),
  billing_cycle    text NOT NULL CHECK (billing_cycle IN ('monthly', 'quarterly', 'yearly')),
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'cancelled', 'expired')),
  start_date       date NOT NULL,
  end_date         date,
  next_billing_date date,
  auto_renew       boolean NOT NULL DEFAULT true,
  renewal_notice_days smallint NOT NULL DEFAULT 30 CHECK (renewal_notice_days BETWEEN 0 AND 180),
  owner_id         uuid NOT NULL,
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, number),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, client_id) REFERENCES clients (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, product_id) REFERENCES products (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, sales_order_id) REFERENCES sales_orders (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, owner_id) REFERENCES users (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, created_by) REFERENCES users (organization_id, id) ON DELETE RESTRICT,
  CHECK (end_date IS NULL OR end_date >= start_date),
  CHECK (status <> 'active' OR next_billing_date IS NOT NULL)
);
CREATE TRIGGER subscriptions_updated BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX subscriptions_billing ON subscriptions (organization_id, next_billing_date) WHERE status = 'active';

COMMIT;
