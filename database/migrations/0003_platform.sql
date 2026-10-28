-- 0003_platform.sql — what the Sprint 2 backend needs on top of the foundation:
-- profile fields, encrypted TOTP secrets, login throttling, numbering, notifications,
-- outbound message outbox and domain events (consumed by the automation engine).

BEGIN;

-- An email identifies exactly one account across the deployment (login has no org picker).
CREATE UNIQUE INDEX users_email_global ON users (email);
ALTER TABLE users
  ADD COLUMN avatar_hue smallint NOT NULL DEFAULT 210 CHECK (avatar_hue BETWEEN 0 AND 360),
  -- AES-256-GCM ciphertext (iv:tag:data, base64) of the RFC 6238 secret. Never plaintext.
  ADD COLUMN mfa_secret_enc text,
  ADD COLUMN mfa_pending_secret_enc text,
  ADD COLUMN password_changed_at timestamptz,
  ADD CONSTRAINT users_mfa_secret CHECK (mfa_enrolled = (mfa_secret_enc IS NOT NULL));

ALTER TABLE auth_challenges ADD COLUMN organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE sessions ADD COLUMN last_seen_at timestamptz NOT NULL DEFAULT now();

-- Sliding-window login throttling that works across API instances.
CREATE TABLE auth_attempts (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key         text NOT NULL,
  succeeded   boolean NOT NULL,
  ip          inet,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_attempts_key ON auth_attempts (key, occurred_at DESC);

-- Gap-free document numbering (lead codes, quotation / invoice numbers per financial year).
CREATE TABLE number_sequences (
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key              text NOT NULL,
  next_value       bigint NOT NULL DEFAULT 1 CHECK (next_value >= 1),
  PRIMARY KEY (organization_id, key)
);

-- Per-organisation settings (payroll statutory rates, activation rules, approval limits).
CREATE TABLE organization_settings (
  organization_id  uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  settings         jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  user_id          uuid NOT NULL,
  kind             text NOT NULL,
  title            text NOT NULL,
  body             text NOT NULL DEFAULT '',
  href             text NOT NULL DEFAULT '/' CHECK (href ~ '^/[^/\\]'  OR href = '/'),
  dedupe_key       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  read_at          timestamptz,
  FOREIGN KEY (organization_id, user_id) REFERENCES users (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX notifications_user ON notifications (user_id, created_at DESC);
CREATE UNIQUE INDEX notifications_dedupe ON notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

-- Transactional outbox for email/SMS. Rows are written in the same transaction as the
-- business change and delivered by the worker through a configured provider.
CREATE TABLE outbox_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid REFERENCES organizations(id) ON DELETE CASCADE,
  channel          text NOT NULL CHECK (channel IN ('email', 'sms')),
  recipient        text NOT NULL,
  template         text NOT NULL,
  -- Never contains secrets in clear except short-lived codes needed for delivery; purged after send.
  payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'blocked')),
  attempts         smallint NOT NULL DEFAULT 0,
  last_error       text,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  sent_at          timestamptz
);
CREATE INDEX outbox_pending ON outbox_messages (next_attempt_at) WHERE status = 'pending';

-- Domain events for automations and integrations (append-only, processed at-least-once).
CREATE TABLE domain_events (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type             text NOT NULL CHECK (type ~ '^[a-z_]+\.[a-z_]+$'),
  entity_type      text NOT NULL,
  entity_id        uuid,
  actor_user_id    uuid,
  payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  processed_at     timestamptz
);
CREATE INDEX domain_events_unprocessed ON domain_events (id) WHERE processed_at IS NULL;

COMMIT;
