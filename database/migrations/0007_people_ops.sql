-- 0007_people_ops.sql — Sprint 6: employees, departments, attendance, leave, salary
-- structures, payroll runs & payslips, support tickets with SLA, automation rules & runs.

BEGIN;

CREATE TABLE departments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name             text NOT NULL,
  head_user_id     uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, head_user_id) REFERENCES users (organization_id, id) ON DELETE SET NULL (head_user_id)
);

CREATE TABLE employees (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  code             text NOT NULL,
  user_id          uuid,
  full_name        text NOT NULL CHECK (length(trim(full_name)) >= 2),
  work_email       text,
  phone            text,
  department_id    uuid,
  designation      text NOT NULL,
  manager_employee_id uuid,
  date_of_joining  date NOT NULL,
  date_of_exit     date,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'notice', 'exited')),
  employment_type  text NOT NULL DEFAULT 'full_time' CHECK (employment_type IN ('full_time', 'part_time', 'contract', 'intern')),
  work_state       char(2),
  pan              text CHECK (pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  uan              text CHECK (uan ~ '^[0-9]{12}$'),
  -- Bank account number is encrypted at rest (AES-256-GCM); only the last 4 digits are kept in clear.
  bank_account_enc text,
  bank_account_last4 text CHECK (bank_account_last4 ~ '^[0-9]{4}$'),
  bank_ifsc        text CHECK (bank_ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, user_id),
  FOREIGN KEY (organization_id, user_id) REFERENCES users (organization_id, id) ON DELETE SET NULL (user_id),
  FOREIGN KEY (organization_id, department_id) REFERENCES departments (organization_id, id) ON DELETE SET NULL (department_id),
  FOREIGN KEY (organization_id, manager_employee_id) REFERENCES employees (organization_id, id) ON DELETE SET NULL (manager_employee_id),
  CHECK (date_of_exit IS NULL OR date_of_exit >= date_of_joining),
  CHECK ((status = 'exited') = (date_of_exit IS NOT NULL)),
  CHECK ((bank_account_enc IS NULL) = (bank_account_last4 IS NULL))
);
CREATE TRIGGER employees_updated BEFORE UPDATE ON employees FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE holidays (
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  holiday_date     date NOT NULL,
  name             text NOT NULL,
  PRIMARY KEY (organization_id, holiday_date)
);

CREATE TABLE attendance (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  employee_id      uuid NOT NULL,
  work_date        date NOT NULL,
  status           text NOT NULL CHECK (status IN ('present', 'absent', 'half_day', 'leave', 'holiday', 'wfh', 'weekly_off')),
  check_in         timestamptz,
  check_out        timestamptz,
  source           text NOT NULL DEFAULT 'self' CHECK (source IN ('self', 'hr', 'leave')),
  note             text,
  recorded_by      uuid,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, work_date),
  FOREIGN KEY (organization_id, employee_id) REFERENCES employees (organization_id, id) ON DELETE CASCADE,
  CHECK (check_out IS NULL OR check_in IS NULL OR check_out >= check_in)
);

CREATE TABLE leave_types (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code             text NOT NULL CHECK (code ~ '^[A-Z]{2,6}$'),
  name             text NOT NULL,
  annual_quota     numeric(5, 1) NOT NULL CHECK (annual_quota >= 0),
  paid             boolean NOT NULL DEFAULT true,
  UNIQUE (organization_id, code),
  UNIQUE (organization_id, id)
);

CREATE TABLE leave_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  employee_id      uuid NOT NULL,
  leave_type_id    uuid NOT NULL,
  from_date        date NOT NULL,
  to_date          date NOT NULL,
  half_day         boolean NOT NULL DEFAULT false,
  days             numeric(5, 1) NOT NULL CHECK (days > 0),
  reason           text NOT NULL,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by     uuid NOT NULL,
  decided_by       uuid,
  decided_at       timestamptz,
  decision_note    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, employee_id) REFERENCES employees (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, leave_type_id) REFERENCES leave_types (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, requested_by) REFERENCES users (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, decided_by) REFERENCES users (organization_id, id) ON DELETE RESTRICT,
  CHECK (to_date >= from_date),
  CHECK (NOT half_day OR from_date = to_date),
  CHECK (status NOT IN ('approved', 'rejected') OR (decided_by IS NOT NULL AND decided_by <> requested_by))
);
CREATE INDEX leave_requests_employee ON leave_requests (employee_id, from_date);

-- Salary structure versions; components are evaluated by the payroll engine.
CREATE TABLE salary_structures (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  employee_id      uuid NOT NULL,
  effective_from   date NOT NULL,
  -- [{code, name, kind: earning|deduction, calc: fixed|percent_of_basic, value, taxable}]
  components       jsonb NOT NULL CHECK (jsonb_typeof(components) = 'array' AND jsonb_array_length(components) >= 1),
  monthly_gross    numeric(15, 2) NOT NULL CHECK (monthly_gross > 0),
  monthly_tds      numeric(15, 2) NOT NULL DEFAULT 0 CHECK (monthly_tds >= 0),
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, effective_from),
  FOREIGN KEY (organization_id, employee_id) REFERENCES employees (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, created_by) REFERENCES users (organization_id, id) ON DELETE RESTRICT
);

CREATE TABLE payroll_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  month            char(7) NOT NULL CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'posted', 'cancelled')),
  employees_count  integer NOT NULL DEFAULT 0,
  gross_total      numeric(15, 2) NOT NULL DEFAULT 0,
  deductions_total numeric(15, 2) NOT NULL DEFAULT 0,
  net_total        numeric(15, 2) NOT NULL DEFAULT 0,
  employer_total   numeric(15, 2) NOT NULL DEFAULT 0,
  settings_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  prepared_by      uuid NOT NULL,
  prepared_at      timestamptz NOT NULL DEFAULT now(),
  approved_by      uuid,
  approved_at      timestamptz,
  journal_entry_id uuid,
  posted_at        timestamptz,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, prepared_by) REFERENCES users (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, approved_by) REFERENCES users (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, journal_entry_id) REFERENCES journal_entries (organization_id, id) ON DELETE RESTRICT,
  CHECK (net_total = gross_total - deductions_total),
  CHECK (approved_by IS NULL OR approved_by <> prepared_by),
  CHECK (status NOT IN ('approved', 'posted') OR approved_by IS NOT NULL),
  CHECK ((status = 'posted') = (journal_entry_id IS NOT NULL))
);
CREATE UNIQUE INDEX payroll_runs_one_per_month ON payroll_runs (organization_id, month) WHERE status <> 'cancelled';

CREATE TABLE payslips (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  run_id           uuid NOT NULL,
  employee_id      uuid NOT NULL,
  working_days     numeric(5, 1) NOT NULL,
  payable_days     numeric(5, 1) NOT NULL,
  lop_days         numeric(5, 1) NOT NULL DEFAULT 0,
  earnings         jsonb NOT NULL,
  deductions       jsonb NOT NULL,
  employer_contributions jsonb NOT NULL DEFAULT '[]'::jsonb,
  gross            numeric(15, 2) NOT NULL,
  total_deductions numeric(15, 2) NOT NULL,
  net_pay          numeric(15, 2) NOT NULL CHECK (net_pay >= 0),
  employer_cost    numeric(15, 2) NOT NULL,
  UNIQUE (run_id, employee_id),
  FOREIGN KEY (organization_id, run_id) REFERENCES payroll_runs (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, employee_id) REFERENCES employees (organization_id, id) ON DELETE RESTRICT,
  CHECK (net_pay = gross - total_deductions),
  CHECK (payable_days + lop_days = working_days)
);

-- ---------- support ----------
CREATE TABLE sla_policies (
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  priority         text NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  first_response_minutes integer NOT NULL CHECK (first_response_minutes > 0),
  resolution_minutes integer NOT NULL CHECK (resolution_minutes > 0),
  PRIMARY KEY (organization_id, priority),
  CHECK (resolution_minutes >= first_response_minutes)
);

CREATE TABLE tickets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  number           text NOT NULL,
  client_id        uuid NOT NULL,
  project_id       uuid,
  subscription_id  uuid,
  subject          text NOT NULL CHECK (length(trim(subject)) >= 3),
  description      text NOT NULL,
  category         text NOT NULL DEFAULT 'support' CHECK (category IN ('support', 'bug', 'change', 'billing', 'other')),
  priority         text NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'waiting_on_client', 'resolved', 'closed')),
  channel          text NOT NULL DEFAULT 'phone' CHECK (channel IN ('phone', 'email', 'whatsapp', 'portal', 'in_person')),
  assignee_id      uuid,
  first_response_due_at timestamptz NOT NULL,
  resolution_due_at timestamptz NOT NULL,
  first_responded_at timestamptz,
  resolved_at      timestamptz,
  closed_at        timestamptz,
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, number),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, client_id) REFERENCES clients (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, project_id) REFERENCES projects (organization_id, id) ON DELETE SET NULL (project_id),
  FOREIGN KEY (organization_id, subscription_id) REFERENCES subscriptions (organization_id, id) ON DELETE SET NULL (subscription_id),
  FOREIGN KEY (organization_id, assignee_id) REFERENCES users (organization_id, id) ON DELETE SET NULL (assignee_id),
  FOREIGN KEY (organization_id, created_by) REFERENCES users (organization_id, id) ON DELETE RESTRICT,
  CHECK ((status IN ('resolved', 'closed')) = (resolved_at IS NOT NULL)),
  CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);
CREATE TRIGGER tickets_updated BEFORE UPDATE ON tickets FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX tickets_open ON tickets (organization_id, status, resolution_due_at) WHERE status NOT IN ('resolved', 'closed');

CREATE TABLE ticket_comments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  ticket_id        uuid NOT NULL,
  author_id        uuid NOT NULL,
  body             text NOT NULL CHECK (length(trim(body)) >= 1),
  internal         boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, ticket_id) REFERENCES tickets (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, author_id) REFERENCES users (organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX ticket_comments_ticket ON ticket_comments (ticket_id, created_at);

-- ---------- automation ----------
CREATE TABLE automation_rules (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             text NOT NULL,
  trigger          text NOT NULL CHECK (trigger ~ '^[a-z_]+\.[a-z_]+$'),
  -- [{field, op: eq|neq|gte|lte|in, value}] evaluated against the event payload / entity.
  conditions       jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(conditions) = 'array'),
  -- [{type: notify|create_task|email, to, title, body}]
  actions          jsonb NOT NULL CHECK (jsonb_typeof(actions) = 'array' AND jsonb_array_length(actions) >= 1),
  enabled          boolean NOT NULL DEFAULT true,
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES users (organization_id, id) ON DELETE RESTRICT
);
CREATE TRIGGER automation_rules_updated BEFORE UPDATE ON automation_rules FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE automation_runs (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id  uuid NOT NULL,
  rule_id          uuid NOT NULL,
  -- Exactly-once per (rule, subject): e.g. "event:123" or "invoice_overdue:<id>:2026-10-24".
  dedupe_key       text NOT NULL,
  entity_type      text,
  entity_id        uuid,
  status           text NOT NULL CHECK (status IN ('succeeded', 'failed', 'skipped')),
  detail           text,
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_id, dedupe_key),
  FOREIGN KEY (organization_id, rule_id) REFERENCES automation_rules (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX automation_runs_rule ON automation_runs (rule_id, started_at DESC);

COMMIT;
