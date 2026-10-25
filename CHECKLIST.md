# Implementation checklist

Legend: [x] done and verified · [~] partial · [ ] not started

## Sprint 1 — Foundation & premium frontend

- [x] Next.js 16 App Router, TypeScript strict, Tailwind 4, ESLint, Prettier, Vitest
- [x] Environment guard: demo/api modes, production latch, hard config-error screen
- [x] Design tokens (light/dark), Inter + Inter Display (self-hosted), validated chart palette
- [x] UI primitives: button, inputs/field, select, dialog, sheet, confirm, menus, popover, tooltip, tabs, segmented, badge, avatar, skeleton, kbd
- [x] App shell: collapsible grouped sidebar, breadcrumbs, global search / command palette (Ctrl/⌘K), Create menu, notifications, user menu (theme, demo persona switch, sign out), mobile drawer
- [x] Permission registry (31 permissions, 14 roles), record-level lead scope, permission-filtered nav, generated RBAC matrix
- [x] Typed contracts (zod) + ApiClient interface + demo adapter + HTTP adapter
- [x] Auth screens: email/password, MFA step, phone OTP with resend timer, password reset (non-enumerating); demo auth adapter
- [x] Role-aware dashboard (company / team / own / non-sales), KPI tiles, charts with table view, demo labels
- [x] Leads: server-driven table (search, facets, sort, pagination, selection, resize, column visibility, saved views), bulk assign / stage change with confirmation, CSV export, create/edit sheet with duplicate detection and unsaved-changes guard
- [x] Lead detail: stage stepper, next step, activity timeline, log activity, follow-ups, reassign, mark lost (reason), convert to client
- [x] Pipeline board (drag-and-drop + keyboard-accessible arrows), Follow-ups (overdue/today/upcoming)
- [x] Clients: list, profile (tax profile, GSTIN checksum, contacts, unified timeline), create/edit
- [x] Planned modules route to an honest roadmap page (no fake screens)
- [x] PWA: manifest, icons, service worker (static + offline only), offline page
- [x] SQL migrations 0001/0002 + permission seed, verified on PGlite
- [x] Tests: 54 unit/component, 21-step browser e2e; docs set
- [ ] Vercel preview deployment — needs repository + Vercel access

## Sprint 2 — Backend & real CRM

- [ ] NestJS service, config validation, health check
- [ ] Apply migrations to managed Postgres (staging), seed permissions/roles
- [ ] Auth module (sessions, argon2id, MFA TOTP, OTP via SMS provider, rate limits)
- [ ] Leads/clients/activities/follow-ups/search/notifications endpoints per docs/api-contracts.md
- [ ] Authorization guard + direct-API access tests per role
- [ ] Audit events on every write; idempotency keys
- [ ] Switch frontend to `NEXT_PUBLIC_DATA_MODE=api`; nonce-based CSP via proxy.ts
- [ ] Lead import (CSV) with duplicate handling

## Sprint 3–6

See README roadmap: documents & quotations → delivery → finance ledger & GST → HR, support, automations.
