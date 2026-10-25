# Architecture

Zoii Business OS is a **modular monolith**: one Next.js frontend (Vercel) and, from Sprint 2, one NestJS backend with PostgreSQL. Modules share a database and transactions but own their tables and services.

```
Browser ──► Next.js (App Router, Vercel)
              │  features/* (UI + hooks)  ──►  ApiClient interface (lib/api/client.ts)
              │                                   ├─ DemoApiClient  (lib/mock)  — Sprint 1, browser-only, labelled
              │                                   └─ HttpApiClient  (lib/api/http-adapter.ts) ─► NestJS /api/v1 ─► PostgreSQL
              └─ AuthAdapter (lib/auth)  — demo | http (httpOnly session cookie)
```

## Frontend layout

| Path | Responsibility |
|---|---|
| `src/app` | Routes only. `(auth)` = sign-in screens, `(workspace)` = authenticated app shell. Pages are thin. |
| `src/features/<module>` | Screens, dialogs and TanStack Query hooks per module (auth, dashboard, leads, clients, workspace). |
| `src/components/ui` | Design-system primitives (Radix-based): button, inputs, dialog/sheet, menus, select, tabs, badge. |
| `src/components/layout` | Shell: sidebar, topbar, breadcrumbs, command palette, global create sheets. |
| `src/components/data-table` | Server-driven table (sorting, pagination, selection, resize, column visibility) + toolbar. |
| `src/lib/api` | **Contracts** (zod schemas + types), `ApiClient` interface, HTTP adapter, errors, runtime factory. |
| `src/lib/permissions` | Permission registry, role map, record-level access helpers. |
| `src/lib/config/env.ts` | Runtime configuration guard (demo vs api, production latch). |
| `src/lib/mock` | Demo seed + demo adapter. Never imported by production api mode at runtime. |

Business logic (validation, authorization, scoring, money formatting) lives in `lib/` and is unit-tested; components only render and dispatch.

## Data flow rules

1. UI → hooks → `getRuntime().api` → adapter. Components never call `fetch` directly.
2. Every request/response shape is a zod schema in `contracts.ts`; the backend implements the same contract.
3. Lists are **server-driven** (filter/sort/paginate in the API) so they scale past demo size.
4. Mutations invalidate exactly the affected query keys (lead, lists, dashboard, notifications).
5. Money crosses the boundary as a decimal string; the database stores `NUMERIC(15,2)`.

## Rendering

Next 16 with Cache Components + Partial Prefetching. The workspace shell is client-rendered behind auth and streams inside `<Suspense>`; static shells (sign-in, offline) prerender. There is no server-side data fetching in Sprint 1 because there is no backend yet.

## Why a modular monolith

One team, one deploy, transactional integrity across CRM → quotation → project → invoice → ledger. Modules are separated by folder and service boundaries so one can be extracted later if load demands it.
