-- 0002_crm.sql — product lines, clients (+ tax profile, addresses, contacts), leads,
-- product interest, activities and follow-ups.
-- Decision: in Sprint 1–2 a lead carries its own pipeline stage. A separate
-- opportunities table arrives with quotations (Sprint 3), when one client can have
-- several concurrent deals. Calls and meetings are activity rows (type = call|meeting).

BEGIN;

CREATE TABLE product_lines (
  key   text PRIMARY KEY CHECK (key ~ '^[a-z_]+$'),
  name  text NOT NULL,
  sort  smallint NOT NULL DEFAULT 0
);
INSERT INTO product_lines (key, name, sort) VALUES
  ('ecommerce', 'E-commerce website', 1),
  ('pos', 'Restaurant & grocery POS', 2),
  ('kuicko_solutions', 'Kuicko business solutions', 3),
  ('social_media', 'Social media & digital marketing', 4),
  ('custom_software', 'Custom software / apps', 5),
  ('jewellery_crm', 'Jewellery CRM', 6),
  ('outdoor_media_crm', 'Outdoor media CRM', 7),
  ('wedding_card_erp', 'Wedding-card wholesale ERP', 8),
  ('other', 'Other', 99);

CREATE TABLE clients (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  code                text NOT NULL,
  display_name        text NOT NULL CHECK (length(trim(display_name)) >= 2),
  legal_name          text NOT NULL CHECK (length(trim(legal_name)) >= 2),
  industry            text NOT NULL,
  category            text NOT NULL CHECK (category IN ('startup', 'smb', 'mid_market', 'enterprise', 'government')),
  status              text NOT NULL DEFAULT 'onboarding' CHECK (status IN ('onboarding', 'active', 'inactive')),
  account_manager_id  uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  website             text,
  source_lead_id      uuid,
  created_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);
CREATE TRIGGER clients_updated BEFORE UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX clients_search ON clients (organization_id, lower(display_name));

-- Tax profile kept 1:1 and separate so invoices can snapshot it (place of supply).
-- Format is enforced here; the GSTIN checksum is verified in the application layer.
CREATE TABLE client_tax_profiles (
  client_id          uuid PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  registration_type  text NOT NULL DEFAULT 'unregistered' CHECK (registration_type IN ('regular', 'composition', 'unregistered', 'sez', 'overseas')),
  gstin              text CHECK (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  pan                text CHECK (pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  state_code         char(2),
  verified_at        timestamptz,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK ((registration_type IN ('regular', 'composition', 'sez')) = (gstin IS NOT NULL)),
  CHECK (gstin IS NULL OR (substring(gstin, 1, 2) = state_code AND substring(gstin, 3, 10) = pan))
);
CREATE UNIQUE INDEX client_tax_profiles_gstin ON client_tax_profiles (organization_id, gstin) WHERE gstin IS NOT NULL;
CREATE TRIGGER client_tax_profiles_updated BEFORE UPDATE ON client_tax_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE client_addresses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('billing', 'service')),
  line1       text NOT NULL,
  line2       text,
  city        text NOT NULL,
  state       text NOT NULL,
  state_code  char(2),
  pincode     text NOT NULL CHECK (pincode ~ '^[1-9][0-9]{5}$'),
  is_default  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX client_addresses_one_default ON client_addresses (client_id, kind) WHERE is_default;

CREATE TABLE client_contacts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name               text NOT NULL,
  designation        text,
  email              text CHECK (email IS NULL OR email = lower(email)),
  phone              text,
  is_primary         boolean NOT NULL DEFAULT false,
  is_decision_maker  boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (email IS NOT NULL OR phone IS NOT NULL)
);
CREATE UNIQUE INDEX client_contacts_one_primary ON client_contacts (client_id) WHERE is_primary;

CREATE TABLE leads (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  code               text NOT NULL,
  contact_name       text NOT NULL CHECK (length(trim(contact_name)) >= 2),
  company            text,
  email              text CHECK (email IS NULL OR email = lower(email)),
  phone              text NOT NULL,
  phone_last10       text GENERATED ALWAYS AS (right(regexp_replace(phone, '[^0-9]', '', 'g'), 10)) STORED,
  city               text,
  source             text NOT NULL CHECK (source IN ('website', 'referral', 'whatsapp', 'instagram', 'facebook_ads', 'google_ads', 'cold_call', 'walk_in', 'event', 'partner', 'other')),
  campaign           text,
  stage              text NOT NULL DEFAULT 'new' CHECK (stage IN ('new', 'contacted', 'qualified', 'discovery', 'proposal', 'negotiation', 'won', 'lost')),
  priority           text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  score              smallint NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  estimated_value    numeric(15, 2) NOT NULL CHECK (estimated_value >= 0),
  currency           char(3) NOT NULL DEFAULT 'INR',
  owner_id           uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  next_follow_up_at  timestamptz,
  lost_reason        text,
  client_id          uuid REFERENCES clients(id) ON DELETE RESTRICT,
  notes              text,
  created_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code),
  CHECK ((stage = 'lost') = (lost_reason IS NOT NULL)),
  CHECK (client_id IS NULL OR stage = 'won'),
  CHECK (stage NOT IN ('won', 'lost') OR next_follow_up_at IS NULL)
);
CREATE TRIGGER leads_updated BEFORE UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX leads_owner_stage ON leads (organization_id, owner_id, stage);
CREATE INDEX leads_follow_up ON leads (organization_id, next_follow_up_at) WHERE next_follow_up_at IS NOT NULL;
CREATE INDEX leads_phone ON leads (organization_id, phone_last10);
CREATE INDEX leads_email ON leads (organization_id, email) WHERE email IS NOT NULL;
CREATE INDEX leads_company ON leads (organization_id, lower(company));
CREATE INDEX leads_created ON leads (organization_id, created_at DESC);

ALTER TABLE clients ADD CONSTRAINT clients_source_lead_fk FOREIGN KEY (source_lead_id) REFERENCES leads(id) ON DELETE SET NULL;

CREATE TABLE lead_product_interests (
  lead_id       uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  product_line  text NOT NULL REFERENCES product_lines(key) ON DELETE RESTRICT,
  PRIMARY KEY (lead_id, product_line)
);

CREATE TABLE client_product_lines (
  client_id     uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  product_line  text NOT NULL REFERENCES product_lines(key) ON DELETE RESTRICT,
  PRIMARY KEY (client_id, product_line)
);

-- One activity table for the unified timeline; exactly one parent per row.
CREATE TABLE activities (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  lead_id          uuid REFERENCES leads(id) ON DELETE CASCADE,
  client_id        uuid REFERENCES clients(id) ON DELETE CASCADE,
  type             text NOT NULL CHECK (type IN ('created', 'note', 'call', 'meeting', 'email', 'stage_change', 'assignment', 'follow_up_scheduled', 'follow_up_completed', 'converted', 'updated')),
  summary          text NOT NULL CHECK (length(trim(summary)) >= 2),
  body             text,
  actor_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  meta             jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (num_nonnulls(lead_id, client_id) = 1)
);
CREATE INDEX activities_lead ON activities (lead_id, occurred_at DESC) WHERE lead_id IS NOT NULL;
CREATE INDEX activities_client ON activities (client_id, occurred_at DESC) WHERE client_id IS NOT NULL;

-- Follow-up history. leads.next_follow_up_at mirrors the single open row and is
-- maintained in the same transaction by the leads service.
CREATE TABLE follow_ups (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id       uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  assigned_to   uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  due_at        timestamptz NOT NULL,
  note          text,
  completed_at  timestamptz,
  outcome       text,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ((completed_at IS NULL) = (outcome IS NULL))
);
CREATE UNIQUE INDEX follow_ups_one_open ON follow_ups (lead_id) WHERE completed_at IS NULL;
CREATE INDEX follow_ups_due ON follow_ups (assigned_to, due_at) WHERE completed_at IS NULL;

COMMIT;
