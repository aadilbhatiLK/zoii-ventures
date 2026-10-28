-- 0001_foundation.sql — organisations, identity, RBAC, sessions, audit, idempotency.
-- Conventions: UUID keys, TIMESTAMPTZ, organisation-scoped ownership, append-only audit.

BEGIN;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TABLE organizations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 160),
  legal_name   text NOT NULL,
  gstin        text CHECK (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  state_code   char(2),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER organizations_updated BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE teams (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name             text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name),
  UNIQUE (organization_id, id)
);

CREATE TABLE users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  team_id          uuid,
  email            text NOT NULL CHECK (email = lower(email) AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone_e164       text CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  full_name        text NOT NULL,
  title            text,
  -- Credentials are owned by the auth module: only a slow hash (argon2id) is ever stored.
  password_hash    text,
  mfa_enrolled     boolean NOT NULL DEFAULT false,
  status           text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'suspended', 'deactivated')),
  email_verified_at timestamptz,
  last_login_at    timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, email),
  UNIQUE (organization_id, phone_e164),
  UNIQUE (organization_id, id),
  -- Composite FKs keep every reference inside one organisation.
  FOREIGN KEY (organization_id, team_id) REFERENCES teams (organization_id, id) ON DELETE SET NULL (team_id)
);
CREATE INDEX users_team ON users (organization_id, team_id) WHERE team_id IS NOT NULL;
CREATE TRIGGER users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE permissions (
  key          text PRIMARY KEY CHECK (key ~ '^[a-z_]+(\.[a-z_]+)+$'),
  description  text NOT NULL
);

CREATE TABLE roles (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key              text NOT NULL CHECK (key ~ '^[a-z_]+$'),
  name             text NOT NULL,
  is_system        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, key),
  UNIQUE (organization_id, id)
);

CREATE TABLE role_permissions (
  role_id         uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key  text NOT NULL REFERENCES permissions(key) ON DELETE RESTRICT,
  PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE user_role_assignments (
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL,
  role_id          uuid NOT NULL,
  granted_by       uuid,
  granted_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id),
  FOREIGN KEY (organization_id, user_id) REFERENCES users (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, role_id) REFERENCES roles (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, granted_by) REFERENCES users (organization_id, id) ON DELETE SET NULL (granted_by)
);

-- Server-side sessions. Only a SHA-256 of the opaque cookie token is stored.
CREATE TABLE sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash     bytea NOT NULL UNIQUE CHECK (length(token_hash) = 32),
  mfa_satisfied  boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  revoked_at     timestamptz,
  ip             inet,
  user_agent     text,
  CHECK (expires_at > created_at)
);
CREATE INDEX sessions_user_active ON sessions (user_id) WHERE revoked_at IS NULL;

-- OTP / MFA / password-reset challenges: hashed codes, single use, bounded attempts.
CREATE TABLE auth_challenges (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES users(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('phone_otp', 'mfa', 'password_reset', 'email_verify')),
  code_hash    bytea NOT NULL,
  attempts     smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_challenges_open ON auth_challenges (user_id, kind) WHERE consumed_at IS NULL;

-- Append-only audit trail for sensitive actions.
CREATE TABLE audit_events (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  actor_user_id    uuid,
  action           text NOT NULL CHECK (action ~ '^[a-z_]+\.[a-z_]+$'),
  entity_type      text NOT NULL,
  entity_id        uuid,
  changes          jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id       text,
  ip               inet,
  -- Users are deactivated, never hard-deleted, so audit history keeps its actor (RESTRICT).
  FOREIGN KEY (organization_id, actor_user_id) REFERENCES users (organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX audit_events_entity ON audit_events (organization_id, entity_type, entity_id, occurred_at DESC);
CREATE INDEX audit_events_actor ON audit_events (organization_id, actor_user_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Retry-safe writes (payment webhooks, imports, client retries).
CREATE TABLE idempotency_keys (
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key              text NOT NULL CHECK (length(key) BETWEEN 8 AND 200),
  scope            text NOT NULL,
  request_hash     bytea NOT NULL,
  response_status  smallint,
  response_body    jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, scope, key)
);

COMMIT;
