# Zoii Business OS

One operating system for Zoii Ventures: CRM, sales (catalogue, BRD/PRD, quotations), delivery (orders, projects, UAT, sign-off, subscriptions), finance (double-entry ledger, GST invoices, receipts, bills, banking, reports), people (HR, attendance, leave, payroll) and support. It covers every product line: e-commerce, POS, Kuicko solutions, social media marketing, custom software, Jewellery CRM, outdoor media CRM and wedding-card ERP.

**Status: Sprints 1–6 built and verified locally.**

- A Next.js frontend talks to a Fastify + PostgreSQL backend in `backend/`.
- Every module screen reads and writes the real API.
- The in-browser demo adapter still exists for design review. It is clearly labelled, and modules that need the backend show "needs the backend" there instead of fake data.
- Not deployed yet: hosting and managed Postgres credentials are needed (see [Deployment](docs/deployment.md)).

## Quick start (full stack, local)

```bash
npm install && (cd backend && npm install)
cp backend/.env.example backend/.env          # dev defaults: embedded PGlite, demo seed, console messages
npm run api:dev                               # API on http://127.0.0.1:4000 (migrates + seeds dev data)
```

In a second terminal:

```bash
cat > .env.local <<'EOF'
NEXT_PUBLIC_DATA_MODE=api
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS=true
EOF
npm run dev                                   # http://localhost:3000
```

**Demo accounts (development seed only, fictional data):**

- Password: `zoii-demo`.
- OTP/MFA: `000000`, accepted only because `AUTH_DEV_STATIC_CODES=true`, which the API refuses in production.
- Accounts include founder, sales manager, sales executive, accounts (`accounts@demo.zoii.in`), employee (`dev@demo.zoii.in`) and others listed on the sign-in screen.
- Privileged roles must enrol TOTP MFA on first sign-in; the QR code is rendered locally.

Demo-only frontend (no backend): leave `.env.local` as copied from `.env.example`.

## Scripts

| Command                    | What it does                                                          |
| -------------------------- | --------------------------------------------------------------------- |
| `npm run dev`              | Frontend dev server                                                   |
| `npm run api:dev`          | Backend dev server (watch mode, PGlite)                               |
| `npm run build` / `start`  | Frontend production build / server                                    |
| `npm run typecheck`        | Frontend route types + `tsc --noEmit`                                 |
| `npm run api:typecheck`    | Backend `tsc --noEmit`                                                |
| `npm run lint` / `format`  | ESLint / Prettier                                                     |
| `npm test`                 | Frontend unit + component tests (Vitest)                              |
| `npm run api:test`         | Backend integration tests against real Postgres (PGlite)              |
| `npm run db:verify`        | Applies SQL migrations to in-process Postgres and checks constraints  |
| `npm run docs:rbac`        | Regenerates `docs/rbac-matrix.md` and the permission seed from code   |
| `npm run check`            | All of the above + production build                                  |
| `cd backend && npm run …`  | `build`, `start`, `migrate`, `create-admin`, `seed:demo`              |

E2E (needs both servers running against a production frontend build): `node tests/e2e/modules.cjs` (page sweep per role) and `node tests/e2e/flow.cjs` (quote → invoice → receipt → ledger through the UI).

## What's built

| Sprint | Scope |
| ------ | ----- |
| 1 | Shell, design system, auth screens, dashboard, leads, pipeline, follow-ups, clients, PWA |
| 2 | Backend: sessions (argon2id, hashed tokens, httpOnly cookie), TOTP MFA, OTP, throttling, CSRF, RBAC on every route, CRM APIs, audit |
| 3 | Product catalogue with price history, versioned GST tax rules, BRD/PRD documents with maker-checker approval, quotations (GST math, revisions, freeze on approval, PDF) |
| 4 | Sales orders from accepted quotes, projects (activation needs approved BRD), milestones, tasks, change requests, UAT, append-only client sign-off, subscriptions |
| 5 | Chart of accounts, balanced journals (enforced in the DB), gap-free GST invoices + PDF, credit notes, idempotent receipts with TDS, vendor bills with ITC/TDS, bank import + matching, period close, TB/P&L/BS/cash flow/GST/ageing reports |
| 6 | Employees (bank details encrypted), attendance, leave, payroll with maker-checker posting to the ledger, support tickets with SLAs, automation rules (exactly-once), notifications + outbox, admin (users, settings, audit) |

Not built (Sprint 7+): client portal, meetings/calendar sync, campaigns, custom roles. See [CHECKLIST](CHECKLIST.md) for the honest list of gaps.

## Docs

- [Architecture](docs/architecture.md)
- [API contracts](docs/api-contracts.md)
- [Database design](docs/database-design.md)
- [RBAC matrix](docs/rbac-matrix.md) (generated)
- [Security baseline](docs/security-baseline.md)
- [Deployment](docs/deployment.md)
- [Implementation checklist](CHECKLIST.md)
