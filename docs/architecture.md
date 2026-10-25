# Architecture

Zoii Business OS is a **modular monolith**:

- One Next.js frontend.
- One Fastify API in `backend/`.
- One PostgreSQL database.

Modules share the database and its transactions, but each one owns its own tables and services.

```
Browser ──► Next.js (App Router)
              │  features/* screens ──► apiFetch / useApi (lib/api/request.ts, hooks.ts)
              │                         └─► Fastify /api/v1 ──► PostgreSQL (pg in production, PGlite in dev/tests)
              │  CRM screens ──► ApiClient interface ─┬─ HttpApiClient (api mode)
              │                                       └─ DemoApiClient (demo mode, labelled, browser-only)
              └─ AuthAdapter — http (httpOnly session cookie) | demo
API process ──► in-process worker (automation engine, scheduled scans, outbox) every WORKER_INTERVAL_MS
```

## Backend layout (`backend/src`)

| Path | Responsibility |
| ---- | -------------- |
| `config.ts` | Validates the environment. Refuses unsafe production settings: dev static codes, console messaging, http CORS origins, missing key or DB. |
| `app.ts` | `buildApp`: CORS, cookies, rate limit, CSRF check, error envelope. The Router helpers `get/post/patch/put/delete` authenticate and parse with Zod. `public.*` is unauthenticated; `raw` streams files. |
| `db/` | `Db` interface over `pg` or PGlite; migration runner; RBAC sync; demo seed (dev only); CLI (`migrate`, `create-admin`, `seed-demo`). |
| `lib/context.ts` | `Actor`, `need(permission)`, `audit`, `emit` (domain events), `nextNumber` (gap-free per FY), `notify`, settings, `commercialScope`. |
| `modules/<area>/` | Service + routes per area: auth, users, crm, sales, delivery, finance, people, support, automation, admin. |
| `worker.ts` | Background tick that runs the automation engine and outbox. |

Shared code: the backend imports the **same Zod contracts and pure libraries** as the frontend through the `@/*` alias. These are `src/lib/api/modules/*`, `src/lib/money` (integer paise), `src/lib/tax/gst.ts` and `src/lib/permissions/registry.ts`. GST math, money rounding and the permission map therefore cannot drift between client and server.

## Key design rules

1. **The server decides.** Every route calls `need(permission)` and applies record scope (`own/team/all` for leads; `commercialScope` for quotations, orders and subscriptions). The UI hiding a button is a convenience, not a control.
2. **Money is integer paise** in code (`bigint`) and `numeric(15,2)` in SQL. It crosses JSON as a decimal string. Tax is computed per line; CGST and SGST are each rate/2, rounded separately.
3. **Transactions are re-entrant.** `db.tx` stores the transaction client in AsyncLocalStorage, so any `db.query` inside it joins the same transaction. Multi-step flows (convert, accept → SO, invoice issue → journal) are atomic.
4. **The database enforces the invariants that matter most:**
   - balanced journals (deferred constraint trigger);
   - append-only journals, sign-offs and audit;
   - frozen documents after approval or issue;
   - no postings into closed periods;
   - allocations bounded by the balance;
   - one SO per quotation.
5. **Maker-checker** runs through one `approval_requests` table. Handlers are registered per entity type (document, quotation, change request, payroll run, journal). The requester can never approve their own request.
6. **Events, not callbacks.** Writes `emit` domain events. The automation engine consumes them and scheduled scans exactly once (unique `rule_id + dedupe_key`). Outbound email/SMS goes to `outbox_messages`; with no provider configured, messages are marked `blocked`, never silently dropped.

## Frontend layout

| Path | Responsibility |
| ---- | -------------- |
| `src/app` | Routes only. Pages are thin server components; components that read params sit inside `<Suspense>` (Cache Components). |
| `src/features/<module>` | Screens per module: auth, dashboard, leads, clients, sales, delivery, finance, people, support, admin. |
| `src/components/module` | Module kit: `ModulePage` (permission + api-mode gate), tables, status badges, money, pickers. |
| `src/lib/api` | Contracts (Zod), `request.ts` (`apiFetch` sends credentials + CSRF header), `hooks.ts` (TanStack Query wrappers). |
| `src/lib/permissions` | Registry: 49 permissions, 14 roles. It is the source of truth, synced into the DB on API boot. |

In demo mode, modules beyond CRM show an honest "needs the backend" panel; they never show fabricated finance or HR data.

## Why Fastify instead of NestJS

The master prompt allowed "NestJS or equivalent". Fastify plus plain service modules gives the same module boundaries and guards with far less framework surface. That means fewer dependencies to audit and a single esbuild bundle (`dist/server.mjs`). Migrating to NestJS later is mechanical: each `modules/<area>/routes.ts` maps to a controller.
