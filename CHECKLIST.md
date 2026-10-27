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
- [ ] SMS provider (DLT-registered) — no provider configured; phone OTP sign-in is off
- [ ] Email provider — none; admins hand over one-time invite/reset links instead (see docs/integrations.md)
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

- [x] 90 backend integration tests (PGlite by default; the same suite passes on Postgres 16 with `PG_TEST_URL`), 85 frontend unit/component tests, migration checks, three browser e2e scripts — all passing locally
- [x] `npm audit`: 0 vulnerabilities in root and backend
- [~] Independent review of Sprint 2–6 code — see docs/security-baseline.md
- [~] Hosting live on Vercel + kuicko2 (see DEPLOY.md). Backup/restore drilled on a local Postgres 16 copy only; no scheduled backups yet
- [ ] Shared rate-limit store (in-memory per instance today) and a separate worker process for multi-instance deploys

## Stabilization (2026-10-27)

Each item has a regression test in `backend/tests/stabilization-phase1.test.ts`, `stabilization-phase2.test.ts` or `tests/unit/stabilization.test.tsx` that failed on the previous code.

- [x] Partial updates no longer apply create-time defaults (project team, task priority, user title)
- [x] Quotation edits keep the lead and BRD links unless explicitly cleared
- [x] HR managers can't unlink their own employee record to change their bank details or salary
- [x] Proxy trust is an explicit address list; spoofed `X-Forwarded-For` is ignored; optional HMAC-signed client IP from the web tier
- [x] MFA: per account+IP and account-wide limits counted inside the transaction, TOTP replay protection
- [x] Sign-in lockout per account+IP (5) with an account-wide ceiling (25); forgot-password throttled per IP
- [x] Production config validated at startup (`npm run cli -- check-config` to check before a restart)
- [x] Approval links open real pages; approval decisions refresh leave, documents, projects and ledger lists
- [x] Invoice draft edits validate client and sales order; billing cap scoped to the organisation; journal party ids checked
- [x] Document drafts editable only by owner, author or approver; edits and team changes audited
- [x] Admin-issued one-time invite/reset links when no email provider is configured
- [x] `npm run dev` / `migrate` / `seed:demo` / `create-admin` work (esbuild instead of tsx)
- [x] Stale "arrives in Sprint N" placeholders replaced; client tabs show live records; dashboard labels real ledger data correctly
- [x] Period close/reopen is maker-checker (migration 0009); accountants require MFA; retention purges in the worker
- [x] `vercel.json` tracked, without the stray `services` block
- [ ] Scheduled subscription billing — deferred until there are paying subscriptions (drafts only, off by default)
- [ ] Scheduled, off-VM database backups — waiting on a destination
