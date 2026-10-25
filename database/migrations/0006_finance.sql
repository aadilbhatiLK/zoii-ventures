-- 0006_finance.sql — Sprint 5: double-entry ledger, invoices, credit notes, receipts with
-- allocation, vendor bills & expenses, bank import and reconciliation, period close.
--
-- Ledger invariants enforced by the database (not just the service):
--  * every journal entry balances (sum debits = sum credits) and has ≥ 2 lines — checked
--    at COMMIT by deferred constraint triggers;
--  * journal entries and lines are append-only: corrections are reversal entries;
--  * nothing can be posted into a closed period;
--  * issued invoices / credit notes / receipts / bills are financially frozen.

BEGIN;

CREATE TABLE accounts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  code             text NOT NULL CHECK (code ~ '^[0-9]{4,6}$'),
  name             text NOT NULL,
  type             text NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'income', 'expense')),
  system_key       text,
  is_bank          boolean NOT NULL DEFAULT false,
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, system_key),
  CHECK (NOT is_bank OR type = 'asset')
);

CREATE TABLE fiscal_periods (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  month            char(7) NOT NULL CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_by        uuid,
  closed_at        timestamptz,
  UNIQUE (organization_id, month),
  FOREIGN KEY (organization_id, closed_by) REFERENCES users (organization_id, id) ON DELETE RESTRICT,
  CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);

CREATE TABLE journal_entries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  number           text NOT NULL,
  entry_date       date NOT NULL,
  source_type      text NOT NULL CHECK (source_type IN ('manual', 'invoice', 'credit_note', 'receipt', 'bill', 'bill_payment', 'payroll', 'reversal', 'opening')),
  source_id        uuid,
  memo             text NOT NULL CHECK (length(trim(memo)) >= 3),
  reversal_of      uuid UNIQUE,
  posted_by        uuid NOT NULL,
  posted_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, number),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, reversal_of) REFERENCES journal_entries (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, posted_by) REFERENCES users (organization_id, id) ON DELETE RESTRICT,
  CHECK ((source_type = 'reversal') = (reversal_of IS NOT NULL))
);
CREATE INDEX journal_entries_date ON journal_entries (organization_id, entry_date);
CREATE INDEX journal_entries_source ON journal_entries (organization_id, source_type, source_id);

CREATE TABLE journal_lines (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id  uuid NOT NULL,
  entry_id         uuid NOT NULL,
  line_no          smallint NOT NULL CHECK (line_no >= 1),
  account_id       uuid NOT NULL,
  debit            numeric(15, 2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit           numeric(15, 2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  party_type       text CHECK (party_type IN ('client', 'vendor', 'employee')),
  party_id         uuid,
  description      text,
  UNIQUE (entry_id, line_no),
  FOREIGN KEY (organization_id, entry_id) REFERENCES journal_entries (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, account_id) REFERENCES accounts (organization_id, id) ON DELETE RESTRICT,
  CHECK ((debit > 0) <> (credit > 0)),
  CHECK ((party_type IS NULL) = (party_id IS NULL))
);
CREATE INDEX journal_lines_account ON journal_lines (organization_id, account_id);
CREATE INDEX journal_lines_party ON journal_lines (organization_id, party_type, party_id) WHERE party_id IS NOT NULL;

CREATE OR REPLACE FUNCTION journal_entry_check(eid uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE d numeric; c numeric; n int;
BEGIN
  SELECT coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*) INTO d, c, n FROM journal_lines WHERE entry_id = eid;
  IF n < 2 OR d <> c OR d = 0 THEN
    RAISE EXCEPTION 'Journal entry % is not balanced (debits %, credits %, lines %)', eid, d, c, n USING ERRCODE = 'check_violation';
  END IF;
END $$;
CREATE OR REPLACE FUNCTION journal_entries_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM journal_entry_check(NEW.id); RETURN NULL; END $$;
CREATE OR REPLACE FUNCTION journal_lines_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM journal_entry_check(NEW.entry_id); RETURN NULL; END $$;
CREATE CONSTRAINT TRIGGER journal_entries_balanced AFTER INSERT ON journal_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION journal_entries_balanced();
CREATE CONSTRAINT TRIGGER journal_lines_balanced AFTER INSERT ON journal_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION journal_lines_balanced();

CREATE TRIGGER journal_entries_append_only BEFORE UPDATE OR DELETE ON journal_entries FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER journal_lines_append_only BEFORE UPDATE OR DELETE ON journal_lines FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE OR REPLACE FUNCTION journal_period_open() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM fiscal_periods p WHERE p.organization_id = NEW.organization_id
              AND p.month = to_char(NEW.entry_date, 'YYYY-MM') AND p.status = 'closed') THEN
    RAISE EXCEPTION 'Period % is closed; post into an open period', to_char(NEW.entry_date, 'YYYY-MM') USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO fiscal_periods (organization_id, month) VALUES (NEW.organization_id, to_char(NEW.entry_date, 'YYYY-MM')) ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER journal_entries_period BEFORE INSERT ON journal_entries FOR EACH ROW EXECUTE FUNCTION journal_period_open();

-- ---------- receivables ----------
CREATE TABLE invoices (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  -- Assigned on issue from a gap-free per-financial-year sequence (ZV/INV/2627/0001).
  number           text,
  client_id        uuid NOT NULL,
  sales_order_id   uuid,
  project_id       uuid,
  milestone_id     uuid UNIQUE,
  subscription_id  uuid,
  billing_period   text,
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'partially_paid', 'paid', 'cancelled')),
  invoice_date     date NOT NULL,
  due_date         date NOT NULL,
  supplier_state   char(2) NOT NULL,
  place_of_supply  char(2) NOT NULL,
  supply_type      text NOT NULL CHECK (supply_type IN ('intra', 'inter')),
  -- Legal snapshot of the buyer at issue time (name, GSTIN, address).
  client_snapshot  jsonb NOT NULL DEFAULT '{}'::jsonb,
  subtotal         numeric(15, 2) NOT NULL DEFAULT 0,
  discount_total   numeric(15, 2) NOT NULL DEFAULT 0,
  taxable_total    numeric(15, 2) NOT NULL DEFAULT 0,
  cgst             numeric(15, 2) NOT NULL DEFAULT 0,
  sgst             numeric(15, 2) NOT NULL DEFAULT 0,
  igst             numeric(15, 2) NOT NULL DEFAULT 0,
  total            numeric(15, 2) NOT NULL DEFAULT 0,
  amount_paid      numeric(15, 2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  amount_credited  numeric(15, 2) NOT NULL DEFAULT 0 CHECK (amount_credited >= 0),
  notes            text,
  journal_entry_id uuid,
  issued_by        uuid,
  issued_at        timestamptz,
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, number),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, client_id) REFERENCES clients (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, sales_order_id) REFERENCES sales_orders (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, project_id) REFERENCES projects (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, milestone_id) REFERENCES milestones (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, subscription_id) REFERENCES subscriptions (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, journal_entry_id) REFERENCES journal_entries (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, created_by) REFERENCES users (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, issued_by) REFERENCES users (organization_id, id) ON DELETE RESTRICT,
  CHECK (due_date >= invoice_date),
  CHECK (taxable_total = subtotal - discount_total),
  CHECK (total = taxable_total + cgst + sgst + igst),
  CHECK (supply_type = CASE WHEN supplier_state = place_of_supply THEN 'intra' ELSE 'inter' END),
  CHECK (amount_paid + amount_credited <= total),
  CHECK ((status IN ('draft', 'cancelled')) OR (number IS NOT NULL AND journal_entry_id IS NOT NULL AND issued_at IS NOT NULL)),
  CHECK (status <> 'paid' OR amount_paid + amount_credited = total)
);
CREATE TRIGGER invoices_updated BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX invoices_client ON invoices (organization_id, client_id, invoice_date DESC);
CREATE INDEX invoices_open ON invoices (organization_id, due_date) WHERE status IN ('issued', 'partially_paid');
-- A subscription bills each period at most once.
CREATE UNIQUE INDEX invoices_subscription_period ON invoices (subscription_id, billing_period) WHERE subscription_id IS NOT NULL AND status <> 'cancelled';

CREATE TABLE invoice_lines (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  invoice_id       uuid NOT NULL,
  line_no          smallint NOT NULL CHECK (line_no >= 1),
  description      text NOT NULL,
  hsn_sac          text NOT NULL CHECK (hsn_sac ~ '^[0-9]{4,8}$'),
  quantity         numeric(12, 3) NOT NULL CHECK (quantity > 0),
  unit_price       numeric(15, 2) NOT NULL CHECK (unit_price >= 0),
  discount_pct     numeric(5, 2) NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
  tax_rate         numeric(5, 2) NOT NULL CHECK (tax_rate BETWEEN 0 AND 40),
  gross            numeric(15, 2) NOT NULL,
  discount         numeric(15, 2) NOT NULL,
  taxable          numeric(15, 2) NOT NULL,
  cgst             numeric(15, 2) NOT NULL,
  sgst             numeric(15, 2) NOT NULL,
  igst             numeric(15, 2) NOT NULL,
  total            numeric(15, 2) NOT NULL,
  revenue_account_id uuid NOT NULL,
  UNIQUE (invoice_id, line_no),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, invoice_id) REFERENCES invoices (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, revenue_account_id) REFERENCES accounts (organization_id, id) ON DELETE RESTRICT,
  CHECK (taxable = gross - discount),
  CHECK (total = taxable + cgst + sgst + igst)
);

CREATE OR REPLACE FUNCTION invoices_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status NOT IN ('draft') AND (
      NEW.total <> OLD.total OR NEW.taxable_total <> OLD.taxable_total OR NEW.cgst <> OLD.cgst OR NEW.sgst <> OLD.sgst
      OR NEW.igst <> OLD.igst OR NEW.client_id <> OLD.client_id OR NEW.invoice_date <> OLD.invoice_date
      OR NEW.number IS DISTINCT FROM OLD.number OR NEW.client_snapshot <> OLD.client_snapshot
      OR NEW.place_of_supply <> OLD.place_of_supply OR NEW.journal_entry_id IS DISTINCT FROM OLD.journal_entry_id) THEN
    RAISE EXCEPTION 'Issued invoice % is immutable; use a credit note', OLD.number USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status <> 'draft' AND NEW.status = 'cancelled' THEN
    RAISE EXCEPTION 'Issued invoices cannot be cancelled; raise a credit note' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invoices_freeze BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION invoices_freeze();
CREATE OR REPLACE FUNCTION invoices_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'Only draft invoices can be deleted' USING ERRCODE = 'insufficient_privilege'; END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER invoices_no_delete BEFORE DELETE ON invoices FOR EACH ROW EXECUTE FUNCTION invoices_no_delete();
CREATE OR REPLACE FUNCTION invoice_lines_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM invoices WHERE id = coalesce(NEW.invoice_id, OLD.invoice_id);
  IF st IS NOT NULL AND st <> 'draft' THEN RAISE EXCEPTION 'Lines of an issued invoice cannot change' USING ERRCODE = 'insufficient_privilege'; END IF;
  RETURN coalesce(NEW, OLD);
END $$;
CREATE TRIGGER invoice_lines_freeze BEFORE INSERT OR UPDATE OR DELETE ON invoice_lines FOR EACH ROW EXECUTE FUNCTION invoice_lines_freeze();

CREATE TABLE credit_notes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  number           text NOT NULL,
  invoice_id       uuid NOT NULL,
  note_date        date NOT NULL,
  reason           text NOT NULL CHECK (length(trim(reason)) >= 3),
  taxable_total    numeric(15, 2) NOT NULL CHECK (taxable_total > 0),
  cgst             numeric(15, 2) NOT NULL DEFAULT 0,
  sgst             numeric(15, 2) NOT NULL DEFAULT 0,
  igst             numeric(15, 2) NOT NULL DEFAULT 0,
  total            numeric(15, 2) NOT NULL,
  journal_entry_id uuid NOT NULL,
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, number),
  FOREIGN KEY (organization_id, invoice_id) REFERENCES invoices (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, journal_entry_id) REFERENCES journal_entries (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, created_by) REFERENCES users (organization_id, id) ON DELETE RESTRICT,
  CHECK (total = taxable_total + cgst + sgst + igst)
);
CREATE TRIGGER credit_notes_append_only BEFORE UPDATE OR DELETE ON credit_notes FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE credit_note_lines (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id  uuid NOT NULL,
  credit_note_id   uuid NOT NULL REFERENCES credit_notes(id) ON DELETE RESTRICT,
  invoice_line_id  uuid NOT NULL,
  taxable          numeric(15, 2) NOT NULL CHECK (taxable > 0),
  cgst             numeric(15, 2) NOT NULL,
  sgst             numeric(15, 2) NOT NULL,
  igst             numeric(15, 2) NOT NULL,
  FOREIGN KEY (organization_id, invoice_line_id) REFERENCES invoice_lines (organization_id, id) ON DELETE RESTRICT
);
CREATE TRIGGER credit_note_lines_append_only BEFORE UPDATE OR DELETE ON credit_note_lines FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE receipts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  number           text NOT NULL,
  client_id        uuid NOT NULL,
  receipt_date     date NOT NULL,
  -- Cash actually received, plus income-tax TDS the client deducted (credited to the same invoices).
  amount           numeric(15, 2) NOT NULL CHECK (amount >= 0),
  tds_amount       numeric(15, 2) NOT NULL DEFAULT 0 CHECK (tds_amount >= 0),
  method           text NOT NULL CHECK (method IN ('bank_transfer', 'upi', 'cash', 'cheque', 'card', 'other')),
  reference        text,
  deposit_account_id uuid NOT NULL,
  journal_entry_id uuid NOT NULL,
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, number),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, client_id) REFERENCES clients (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, deposit_account_id) REFERENCES accounts (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, journal_entry_id) REFERENCES journal_entries (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, created_by) REFERENCES users (organization_id, id) ON DELETE RESTRICT,
  CHECK (amount + tds_amount > 0)
);
CREATE TRIGGER receipts_append_only BEFORE UPDATE OR DELETE ON receipts FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE receipt_allocations (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id  uuid NOT NULL,
  receipt_id       uuid NOT NULL,
  invoice_id       uuid NOT NULL,
  amount           numeric(15, 2) NOT NULL CHECK (amount > 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, receipt_id) REFERENCES receipts (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, invoice_id) REFERENCES invoices (organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX receipt_allocations_invoice ON receipt_allocations (invoice_id);
CREATE TRIGGER receipt_allocations_append_only BEFORE UPDATE OR DELETE ON receipt_allocations FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE OR REPLACE FUNCTION receipt_allocations_bounded() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cap numeric; used numeric;
BEGIN
  SELECT amount + tds_amount INTO cap FROM receipts WHERE id = NEW.receipt_id;
  SELECT coalesce(sum(amount), 0) INTO used FROM receipt_allocations WHERE receipt_id = NEW.receipt_id;
  IF used > cap THEN
    RAISE EXCEPTION 'Allocations (%) exceed the receipt (%)', used, cap USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER receipt_allocations_bounded AFTER INSERT ON receipt_allocations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION receipt_allocations_bounded();

-- ---------- payables ----------
CREATE TABLE vendors (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name             text NOT NULL CHECK (length(trim(name)) >= 2),
  gstin            text CHECK (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  pan              text CHECK (pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  state_code       char(2),
  email            text,
  phone            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);
CREATE UNIQUE INDEX vendors_gstin ON vendors (organization_id, gstin) WHERE gstin IS NOT NULL;

CREATE TABLE bills (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  number           text NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('bill', 'expense')),
  vendor_id        uuid,
  vendor_bill_no   text,
  bill_date        date NOT NULL,
  due_date         date NOT NULL,
  description      text NOT NULL,
  expense_account_id uuid NOT NULL,
  taxable          numeric(15, 2) NOT NULL CHECK (taxable > 0),
  cgst             numeric(15, 2) NOT NULL DEFAULT 0 CHECK (cgst >= 0),
  sgst             numeric(15, 2) NOT NULL DEFAULT 0 CHECK (sgst >= 0),
  igst             numeric(15, 2) NOT NULL DEFAULT 0 CHECK (igst >= 0),
  -- Whether the GST is claimable as input credit (else it is part of the expense).
  itc_eligible     boolean NOT NULL DEFAULT true,
  tds_section      text,
  tds_amount       numeric(15, 2) NOT NULL DEFAULT 0 CHECK (tds_amount >= 0),
  total            numeric(15, 2) NOT NULL,
  -- Amount owed to the vendor = total - TDS withheld.
  payable          numeric(15, 2) NOT NULL,
  amount_paid      numeric(15, 2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  status           text NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'partially_paid', 'paid')),
  journal_entry_id uuid NOT NULL,
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, number),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, vendor_id) REFERENCES vendors (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, expense_account_id) REFERENCES accounts (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, journal_entry_id) REFERENCES journal_entries (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, created_by) REFERENCES users (organization_id, id) ON DELETE RESTRICT,
  CHECK (kind = 'expense' OR vendor_id IS NOT NULL),
  CHECK (total = taxable + cgst + sgst + igst),
  CHECK (payable = total - tds_amount AND payable >= 0),
  CHECK (amount_paid <= payable),
  CHECK (igst = 0 OR (cgst = 0 AND sgst = 0)),
  CHECK (due_date >= bill_date)
);
CREATE TRIGGER bills_updated BEFORE UPDATE ON bills FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE UNIQUE INDEX bills_vendor_no ON bills (organization_id, vendor_id, vendor_bill_no) WHERE vendor_bill_no IS NOT NULL;
CREATE OR REPLACE FUNCTION bills_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NEW.total <> OLD.total OR NEW.taxable <> OLD.taxable OR NEW.tds_amount <> OLD.tds_amount
     OR NEW.journal_entry_id <> OLD.journal_entry_id OR NEW.expense_account_id <> OLD.expense_account_id THEN
    RAISE EXCEPTION 'Recorded bills are immutable; post a reversal instead' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bills_freeze BEFORE UPDATE OR DELETE ON bills FOR EACH ROW EXECUTE FUNCTION bills_freeze();

CREATE TABLE bill_payments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  bill_id          uuid NOT NULL,
  payment_date     date NOT NULL,
  amount           numeric(15, 2) NOT NULL CHECK (amount > 0),
  paid_from_account_id uuid NOT NULL,
  reference        text,
  journal_entry_id uuid NOT NULL,
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, bill_id) REFERENCES bills (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, paid_from_account_id) REFERENCES accounts (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, journal_entry_id) REFERENCES journal_entries (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, created_by) REFERENCES users (organization_id, id) ON DELETE RESTRICT
);
CREATE TRIGGER bill_payments_append_only BEFORE UPDATE OR DELETE ON bill_payments FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------- banking ----------
CREATE TABLE bank_imports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  bank_account_id  uuid NOT NULL,
  filename         text NOT NULL,
  rows_total       integer NOT NULL,
  rows_imported    integer NOT NULL,
  rows_duplicate   integer NOT NULL,
  imported_by      uuid NOT NULL,
  imported_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, bank_account_id) REFERENCES accounts (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, imported_by) REFERENCES users (organization_id, id) ON DELETE RESTRICT
);

CREATE TABLE bank_statement_lines (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  bank_account_id  uuid NOT NULL,
  import_id        uuid NOT NULL,
  txn_date         date NOT NULL,
  description      text NOT NULL,
  reference        text,
  -- Signed: positive = money in (credit on the statement), negative = money out.
  amount           numeric(15, 2) NOT NULL CHECK (amount <> 0),
  balance          numeric(15, 2),
  dedupe_hash      text NOT NULL,
  status           text NOT NULL DEFAULT 'unmatched' CHECK (status IN ('unmatched', 'matched', 'ignored')),
  matched_entry_id uuid,
  matched_by       uuid,
  matched_at       timestamptz,
  UNIQUE (bank_account_id, dedupe_hash),
  FOREIGN KEY (organization_id, bank_account_id) REFERENCES accounts (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, import_id) REFERENCES bank_imports (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, matched_entry_id) REFERENCES journal_entries (organization_id, id) ON DELETE RESTRICT,
  CHECK ((status = 'matched') = (matched_entry_id IS NOT NULL))
);
CREATE INDEX bank_lines_open ON bank_statement_lines (organization_id, bank_account_id, txn_date) WHERE status = 'unmatched';
-- A ledger entry reconciles against at most one statement line.
CREATE UNIQUE INDEX bank_lines_one_match ON bank_statement_lines (matched_entry_id) WHERE matched_entry_id IS NOT NULL;

COMMIT;
