# Implementation checklist

Legend: [x] done and verified · [~] partial · [ ] not started

"Verified" means covered by an automated test that was run: backend integration tests on real Postgres (PGlite), frontend unit tests, `db:verify`, or the browser e2e scripts. Nothing here has been tested against a deployed environment yet.

## Sprint 1 — Foundation & premium frontend

- [x] Next.js 16 App Router, TypeScript strict, Tailwind 4, ESLint, Prettier, Vitest
- [x] Environment guard: demo/api modes, production latch, hard config-error screen
- [x] Design tokens, UI primitives, app shell, command palette, notifications, mobile drawer
- [x] Permission registry, permission-filtered nav, generated RBAC matrix
- [x] Auth screens, role-aware dashboard, leads, pipeline, follow-ups, clients
- [x] PWA (static + offline only)
- [x] Independent review: 18 findings fixed or documented
- [ ] Vercel preview deployment — needs Vercel access

## Sprint 2 — Backend & real CRM

- [x] Backend service (Fastify 5 instead of NestJS — smaller surface, same module boundaries), config validation, `/healthz`
- [x] Migration runner: ordered, checksummed, immutable once applied; Postgres via `DATABASE_URL`, PGlite for dev/tests
- [x] Auth: argon2id, hashed session tokens in httpOnly cookie, TOTP MFA (enrolment + verify, secrets AES-256-GCM encrypted), OTP, password reset, logout revokes session
- [x] Throttling per account/challenge and per IP (DB-backed), non-enumerating OTP/reset
- [x] CSRF: required `X-Requested-With` + origin allowlist on state changes
- [x] Every route checks permission + record scope on the server; out-of-scope → 404 (tested per role)
- [x] Audit event on every write; optimistic concurrency (409)
- [x] Leads, clients, activities, follow-ups, convert (one transaction), search, notifications, dashboard
- [x] Frontend switched to api mode; `create-admin` CLI for the first real user
- [ ] SMS provider (DLT-registered) — no provider configured; OTP messages are marked "blocked"
- [ ] Email provider — same
- [ ] Lead CSV import
- [ ] Nonce-based CSP

## Sprint 3 — Catalogue, documents, quotations

- [x] Products with price history; versioned tax rules (no overlap, longest HSN-prefix match)
- [x] BRD/PRD documents: versions, submit/withdraw, maker-checker approval, approved versions immutable
- [x] Quotations: integer-paise money, CGST/SGST vs IGST by place of supply, discounts, approval thresholds, revisions, freeze after approval, gap-free numbering per FY, PDF
- [ ] E-signature on quotations
- [ ] Opportunities table (lead still carries the stage)

## Sprint 4 — Delivery

- [x] Sales order from accepted quotation (exactly one per quote)
- [x] Projects: activation requires an approved BRD; members, milestones, tasks (board), change requests via approvals
- [x] UAT items and results; append-only client sign-off
- [x] Subscriptions with renewals and scheduled billing
- [ ] Client portal (clients sign off through staff today)
- [ ] File attachments / object storage

## Sprint 5 — Finance

- [x] Chart of accounts, fiscal periods, journals that must balance at commit (DB trigger), append-only; reversal instead of edit
- [x] Invoices from sales order / milestone / subscription; frozen after issue; gap-free numbering; PDF
- [x] Credit notes; receipts with Idempotency-Key, TDS, allocation bounded by the invoice balance
- [x] Vendors and bills with input GST and TDS payable; bill payments
- [x] Bank CSV import with dedupe, match / categorise / ignore
- [x] Period close with checks; postings into closed periods blocked
- [x] Trial balance, P&L, balance sheet, cash flow, GST summary, receivables/payables ageing — tie-outs tested
- [ ] E-invoice IRN (IRP) — not integrated; PDFs say so
- [ ] GST return filing / portal integration
- [ ] Payment gateway webhooks

## Sprint 6 — People, support, automation

- [x] Departments, employees (bank account encrypted, last 4 shown), holidays, attendance, leave types/requests/balances
- [x] Salary structures; payroll prepare → submit → approve (different person) → post to ledger; payslips
- [~] Payroll statutory deductions: PF/ESI/PT computed from configured rates; **TDS is a manual estimate** — rates need CA confirmation before real use
- [x] Support tickets with SLA policies, comments, breach tracking
- [x] Automation rules on domain events and scheduled scans, exactly-once per rule + key; run history
- [x] Admin: users, roles, MFA reset, settings, outbox, audit log, reports hub
- [ ] Custom roles (14 fixed roles today)

## Cross-cutting

- [x] 48 backend integration tests, 78 frontend unit/component tests, migration checks, two browser e2e scripts — all passing locally
- [x] `npm audit`: 0 vulnerabilities in root and backend
- [~] Independent review of Sprint 2–6 code — see docs/security-baseline.md
- [ ] Managed Postgres, hosting, backups with tested restore — need credentials
- [ ] Shared rate-limit store (in-memory per instance today) and a separate worker process for multi-instance deploys
