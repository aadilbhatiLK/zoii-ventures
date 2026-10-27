-- 0009: closing or reopening a fiscal period is maker-checker, like the rest of finance.
-- A request records who asked, why, and the close checks at that moment; the period only
-- changes when a different person with finance.period.close approves it. Additive only.

CREATE TABLE period_change_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  month            char(7) NOT NULL CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  action           text NOT NULL CHECK (action IN ('close', 'reopen')),
  reason           text,
  forced           boolean NOT NULL DEFAULT false,
  checks           jsonb NOT NULL DEFAULT '[]',
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by     uuid NOT NULL,
  requested_at     timestamptz NOT NULL DEFAULT now(),
  decided_by       uuid,
  decided_at       timestamptz,
  FOREIGN KEY (organization_id, requested_by) REFERENCES users (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, decided_by) REFERENCES users (organization_id, id) ON DELETE RESTRICT,
  CHECK (action <> 'reopen' OR length(trim(coalesce(reason, ''))) >= 5),
  CHECK ((status = 'pending') = (decided_at IS NULL))
);
-- One open request per month at a time.
CREATE UNIQUE INDEX period_change_requests_one_pending ON period_change_requests (organization_id, month) WHERE status = 'pending';

ALTER TABLE approval_requests DROP CONSTRAINT approval_requests_entity_type_check;
ALTER TABLE approval_requests ADD CONSTRAINT approval_requests_entity_type_check
  CHECK (entity_type IN ('document_version', 'quotation', 'change_request', 'payroll_run', 'leave_request', 'journal_entry', 'period_change'));
