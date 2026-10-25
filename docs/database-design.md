# Database design

PostgreSQL 16+. Migrations in `database/migrations` are plain SQL applied in filename order; `npm run db:verify` applies them to an in-process Postgres (PGlite, PG 17 compatible) and asserts 20+ integrity rules.

## Conventions

- `uuid` keys (`gen_random_uuid()`), `timestamptz` everywhere, `numeric(15,2)` for money + explicit `currency`.
- Every business table carries `organization_id` (single org today, multi-org ready).
- `updated_at` maintained by trigger. Enumerations are `CHECK` constraints (or reference tables when users may extend them, e.g. `product_lines`).
- Secrets never stored in plaintext: passwords as argon2id hashes, session tokens and OTPs as hashes.
- `audit_events` is append-only (UPDATE/DELETE raise `42501`); users are deactivated, never hard-deleted.
- **Organisation integrity:** parent tables expose `UNIQUE (organization_id, id)` and every reference is a composite `(organization_id, x_id)` foreign key, so a row can never point at another organisation's user, client, lead or team. Child tables carry `organization_id` too, ready for row-level security.

## Implemented (Sprint 1 → applied in Sprint 2)

| Migration                    | Tables                                                                                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0001_foundation.sql`        | organizations, teams, users, permissions, roles, role_permissions, user_role_assignments, sessions, auth_challenges, audit_events, idempotency_keys         |
| `0002_crm.sql`               | product_lines, clients, client_tax_profiles, client_addresses, client_contacts, client_product_lines, leads, lead_product_interests, activities, follow_ups |
| `seeds/0001_permissions.sql` | permissions + 14 system roles, generated from the code registry                                                                                             |

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

- **Lead carries the pipeline stage** in Sprint 1–2. An `opportunities` table is introduced with quotations (Sprint 3) when a client can hold several concurrent deals; leads then convert into client + first opportunity.
- **Calls and meetings are `activities` rows** (`type = call|meeting`) rather than separate tables until calendar sync needs extra fields.
- `leads.next_follow_up_at` is a denormalised mirror of the single open `follow_ups` row, maintained in the same transaction, so list queries stay index-only.

## Planned (later sprints)

Sprint 3: products, product_plans, pricing_rules, tax_rules (versioned), document_templates, documents, document_versions (immutable approved snapshots), document_approvals, quotations, quotation_items, quotation_tax_lines, opportunities.
Sprint 4: contracts, sales_orders, subscriptions, projects, project_members, milestones, tasks, task_comments, change_requests, uat_cycles, uat_test_cases, client_signoffs, support_tickets.
Sprint 5: chart_of_accounts, financial_periods, journal_entries, journal_lines (balanced-entry constraint via deferred trigger), invoices, invoice_lines, credit/debit notes, payments, payment_allocations, expenses, purchase_bills, bank_accounts, bank_statement_lines, bank_reconciliations, webhook_events.
Sprint 6: employees, departments, attendance_records, leave_requests, salary_structures, payroll_runs, automation_definitions, automation_runs, notification_outbox.

Never run migrations against production without a tested backup/restore and explicit approval.
