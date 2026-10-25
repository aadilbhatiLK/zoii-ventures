# Zoii Business OS

One operating system for Zoii Ventures: leads, pipeline, clients, and (in later sprints) quotations, delivery, finance and people, across every product line: e-commerce, POS, Kuicko solutions, social media marketing, custom software, Jewellery CRM, outdoor media CRM and wedding-card ERP.

**Status: Sprint 1 (frontend foundation).** The UI runs against a clearly labelled in-browser demo adapter with fictional data. There is no backend or database connection yet; production builds refuse to start in demo mode unless explicitly allowed for review.

## Quick start

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open http://localhost:3000. The sign-in page lists the demo accounts (password `zoii-demo`; OTP/MFA code `000000`). Founder, finance and auditor accounts go through the MFA step. Use **Account menu → Switch demo persona** to see how each role's navigation and permissions change.

## Scripts

| Command                   | What it does                                                         |
| ------------------------- | -------------------------------------------------------------------- |
| `npm run dev`             | Development server (demo mode by default)                            |
| `npm run build` / `start` | Production build / server                                            |
| `npm run typecheck`       | Route type generation + `tsc --noEmit`                               |
| `npm run lint` / `format` | ESLint / Prettier                                                    |
| `npm test`                | Unit + component tests (Vitest)                                      |
| `npm run db:verify`       | Applies SQL migrations to in-process Postgres and checks constraints |
| `npm run docs:rbac`       | Regenerates `docs/rbac-matrix.md` and the permission seed from code  |
| `npm run e2e`             | Browser smoke test against `BASE_URL`                                |
| `npm run check`           | typecheck + lint + test + db:verify + build                          |

## What's in Sprint 1

- Application shell with grouped, permission-filtered navigation, breadcrumbs, command palette (Ctrl/⌘K), Create menu, notifications, light/dark theme and mobile drawer.
- Sign-in with email + password, MFA for privileged roles, phone OTP and password reset.
- Role-aware dashboard (company, team, own, or non-sales roles).
- **Leads:** server-driven table with search, filters, sorting, pagination, saved views, column controls, bulk assign and stage change, CSV export, and duplicate detection. Detail pages cover the stage stepper, activity timeline, follow-ups and convert-to-client.
- **Pipeline board** with drag-and-drop, plus a **Follow-ups** queue.
- **Clients:** list, profile with GST tax profile (checksum-validated GSTIN), contacts and a unified timeline.
- Typed API contracts, demo and HTTP adapters, RBAC registry (14 roles, 31 permissions), PostgreSQL migrations for the foundation and CRM, and a PWA.

Modules not built yet appear in the navigation with their sprint number and open an honest "not built yet" page. They never show fake screens or numbers.

## Docs

- [Architecture](docs/architecture.md)
- [API contracts](docs/api-contracts.md)
- [Database design](docs/database-design.md)
- [RBAC matrix](docs/rbac-matrix.md) (generated)
- [Security baseline](docs/security-baseline.md)
- [Deployment](docs/deployment.md)
- [Implementation checklist](CHECKLIST.md)

## Roadmap

| Sprint | Scope                                                                                                              |
| ------ | ------------------------------------------------------------------------------------------------------------------ |
| 2      | NestJS backend, Postgres, real auth (sessions, MFA, SMS OTP), CRM APIs, authorization tests, switch UI to api mode |
| 3      | Product catalogue & pricing, discovery, BRD/PRD with versioned approvals, quotations + PDF                         |
| 4      | Contracts/sales orders, subscriptions, projects, tasks, change requests, UAT, sign-off, AMC, client portal         |
| 5      | Double-entry ledger, invoices, receipts, expenses, banking & reconciliation, GST reports, P&L/BS/cash flow         |
| 6      | HR (employees, attendance, leave, payroll prep), support tickets & SLAs, automations                               |
