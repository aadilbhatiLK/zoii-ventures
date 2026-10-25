# Database design

PostgreSQL 16+. Migrations in `database/migrations` are plain SQL applied in filename order; `npm run db:verify` applies them to an in-process Postgres (PGlite, PG 17 compatible) and asserts 20+ integrity rules.

## Conventions

- `uuid` keys (`gen_random_uuid()`), `timestamptz` everywhere, `numeric(15,2)` for money + explicit `currency`.
- Every business table carries `organization_id` (single org today, multi-org ready).
- `updated_at` maintained by trigger. Enumerations are `CHECK` constraints (or reference tables when users may extend them, e.g. `product_lines`).
- Secrets never stored in plaintext: passwords as argon2id hashes, session tokens and OTPs as hashes.
- `audit_events` is append-only (UPDATE/DELETE raise `42501`); users are deactivated, never hard-deleted.
- **Organisation integrity:** parent tables expose `UNIQUE (organization_id, id)` and every reference is a composite `(organization_id, x_id)` foreign key, so a row can never point at another organisation's user, client, lead or team. Child tables carry `organization_id` too, ready for row-level security.

## Migrations

| Migration | Tables |
| --------- | ------ |
| `0001_foundation.sql` | organizations, teams, users, permissions, roles, role_permissions, user_role_assignments, sessions, auth_challenges, audit_events, idempotency_keys |
| `0002_crm.sql` | product_lines, clients, client_tax_profiles, client_addresses, client_contacts, client_product_lines, leads, lead_product_interests, activities, follow_ups |
| `0003_platform.sql` | auth_attempts (throttling), number_sequences (gap-free per FY), organization_settings, notifications, outbox_messages, domain_events; users gain `mfa_secret_enc`, `mfa_pending_secret_enc`, `avatar_hue`; global email uniqueness |
| `0004_sales.sql` | products, product_price_history, tax_rules (no overlapping validity per HSN), documents, document_versions (approved = immutable), approval_requests, quotations, quotation_lines (frozen after approval) |
| `0005_delivery.sql` | sales_orders (one per quotation), projects, project_members, milestones, tasks, change_requests, uat_items, signoffs (append-only), subscriptions |
| `0006_finance.sql` | accounts, fiscal_periods, journal_entries, journal_lines (balanced at commit, append-only), invoices, invoice_lines (frozen after issue), credit_notes, receipts, receipt_allocations (bounded by balance), vendors, bills, bill_payments, bank_imports, bank_statement_lines |
| `0007_people_ops.sql` | departments, employees (bank account AES-GCM encrypted + last4), holidays, attendance, leave_types, leave_requests, salary_structures, payroll_runs (approver ≠ preparer), payslips, sla_policies, tickets, ticket_comments, automation_rules, automation_runs (unique rule + dedupe key) |
| `seeds/0001_permissions.sql` | permissions + 14 system roles, generated from the code registry (the API also syncs them on boot) |

Migrations are applied by `backend/src/db/migrate.ts` in filename order. Each file runs in a transaction and its checksum is stored in `schema_migrations`; editing an applied file stops the runner. Never edit an applied migration — add a new one.

### Key constraints (verified by `db:verify`)

- Lead: value ≥ 0; `lost ⇔ lost_reason`; `won ⇔ client_id` (won only through conversion); `won/lost ⇔ closed_at`; closed leads have no follow-up date; unique code per org.
- A lead converts into at most one client (`UNIQUE (organization_id, source_lead_id)`).
- Cross-organisation references are rejected (lead owner, account manager, contact parent, team membership).
- Client website must be `http(s)://`.
- Client tax profile: GSTIN format; GSTIN agrees with PAN and state code; registered types require a GSTIN; GSTIN unique per org. (Checksum is verified in the app layer.)
- One primary contact per client; one default address per kind; 6-digit PIN.
- Activity belongs to exactly one parent (lead or client).
- One open follow-up per lead; completion requires an outcome.
- Sessions store 32-byte token hashes only; OTP attempts capped at 5.

## Decisions

- **Lead carries the pipeline stage** in Sprints 1–6; a quotation belongs to a client or a lead (at least one). An `opportunities` table is still planned for clients with several concurrent deals.
- **Calls and meetings are `activities` rows** (`type = call|meeting`) rather than separate tables until calendar sync needs extra fields.
- `leads.next_follow_up_at` is a denormalised mirror of the single open `follow_ups` row, maintained in the same transaction, so list queries stay index-only.

### Ledger and document invariants (verified by backend tests)

- `journal_entry_check(entry)` runs as a **deferred constraint trigger** on both `journal_entries` and `journal_lines`: at commit, every entry must have ≥ 2 lines and debits = credits. Lines are debit-xor-credit and non-negative.
- Journal entries and lines cannot be updated or deleted; corrections are reversing entries.
- Postings dated in a closed `fiscal_periods` month are rejected.
- Issued invoices, approved quotations and their lines reject updates to commercial fields. Approved document versions are immutable.
- `receipt_allocations` total per receipt ≤ receipt amount, and per invoice ≤ invoice total (deferred trigger).
- Numbering (`ZV/QT/2627/0001`, `ZV/INV/…`) comes from `number_sequences` with a row lock, inside the same transaction as the document, so a rolled-back issue never burns a number.
- `signoffs` and `audit_events` are append-only.
- `payroll_runs.approved_by <> prepared_by`.

## Planned (later sprints)

Opportunities (multiple concurrent deals per client), contracts with e-signature, file attachments (object storage), client portal users, custom roles, and payment-gateway webhook events.

Never run migrations against production without a tested backup/restore and explicit approval.
