# Integrations and features not yet built

Last checked against the code on 2026-10-27. This lists what is **not** connected, what users see, and the workaround. Nothing here is simulated in API mode: where an integration is missing, the app says so.

## External integrations

| Integration | Status | What users see | Workaround today |
| --- | --- | --- | --- |
| Email (invites, password reset, automation emails) | **Not built.** Providers are `console` (dev) or `none` (production). | Invite and reset messages are recorded in Settings → Outbox as *blocked*. | The admin gets a **one-time link** when inviting a user or issuing a reset (Settings → Users) and hands it over. It works once, expires (invite 72 h, reset 24 h), is stored only as a hash, and is audited. |
| SMS / phone OTP sign-in | **Not built.** Needs a DLT-registered Indian provider. | "Phone sign-in isn't available yet. Use email and password." | Email + password (+ TOTP for privileged roles). |
| E-invoice IRN (IRP) | **Not built.** | Invoice PDFs state that no IRN was generated. | Generate the IRN on the government portal if you are above the threshold. |
| GST return filing | **Not built.** | The GST summary is labelled a working paper. | File GSTR-1/3B from the summary on the GST portal. |
| Payment gateway / webhooks | **Not built.** | — | Record receipts manually (Finance → Receipts). |
| File attachments / object storage | **Not built.** | No upload controls exist. | Keep files outside the app; reference them in notes. |
| E-signature on quotations | **Not built.** | Acceptance is recorded by staff with an evidence note. | Keep the signed PO/email; paste its reference as evidence. |
| Client portal | **Not built.** | `/portal` shows a "not built yet" page. | Clients sign off through staff (UAT sign-off is append-only). |
| Error tracking / uptime alerts | **Not set up.** | — | `GET /healthz` and `/readyz` exist for an external monitor. |

## Features inside the app

| Feature | Status |
| --- | --- |
| Meetings, campaigns | Not built: `/meetings` and `/campaigns` show a "not built yet" page. |
| Lead CSV import | Not built (bank CSV import exists). |
| Custom roles | Not built: 14 fixed roles. |
| Opportunities table | Not built: the lead carries the stage. |
| Scheduled subscription billing | **Manual.** Finance runs it from Invoices → *Run billing*; the worker does not schedule it. |
| Payroll TDS | **Manual estimate** typed in by HR. PF/ESI/PT come from configured rates; confirm all rates with a CA before real payroll. |
| Housekeeping | Expired sessions, auth attempts, challenges and processed events are never purged. |
| Client page totals | The client's Commercial/Projects/Support tabs list live records; lifetime value isn't totalled. |
| Dashboards for finance, delivery and HR roles | Link to the live modules; they don't summarise them yet. |

## Demo mode

`NEXT_PUBLIC_DATA_MODE=demo` uses fictional in-browser data for leads, pipeline, clients, dashboard, search and notifications only, behind a visible banner. Every other module shows "This module needs the backend". Production builds refuse demo mode unless `NEXT_PUBLIC_ALLOW_DEMO_IN_PRODUCTION=true`, and API mode never falls back to demo data.
