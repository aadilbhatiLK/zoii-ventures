# API contracts (v1)

Source of truth: the Zod schemas in `src/lib/api/contracts.ts` (CRM) and `src/lib/api/modules/*.ts` (sales, delivery, finance, people). The backend in `backend/src/modules/*/routes.ts` parses every body and query with the same schemas. This page lists every route and the permission it needs; the route files are authoritative.

## Conventions

- Base: `${NEXT_PUBLIC_API_BASE_URL}/api/v1`. JSON only.
- Success: `{ "data": <T> }`. Error: `{ "error": { code, message, details?, requestId? } }` with HTTP 4xx/5xx.
- Error codes: `UNAUTHENTICATED` 401 · `FORBIDDEN` 403 · `NOT_FOUND` 404 (also for records outside the caller's scope) · `VALIDATION` 422 (field → messages in `details`) · `CONFLICT` 409 · `RATE_LIMITED` 429 · `INTERNAL` 500.
- Auth: httpOnly, `Secure`, `SameSite=Lax` session cookie set by the backend; browser sends `credentials: include`. State-changing requests carry `X-Requested-With: zoii-web`; the backend rejects state changes without it (CSRF defence alongside SameSite).
- Money: decimal strings (`"125000.00"`). Timestamps: ISO 8601 UTC.
- Lists: `?page=1&pageSize=20` (10|20|50), filters as repeated params, `sort={"field":"createdAt","dir":"desc"}`. Response `Paginated<T> = { items, total, page, pageSize }`.
- `Idempotency-Key` is **required** on `POST /receipts` and `POST /bills/:id/payments`; a replay with the same body returns the original result, a different body returns 409.
- Rate limits: 600 requests/min per IP globally; tighter per-route limits on auth, OTP, reset and duplicate checks (in-memory per instance).
- Updates (`PATCH /leads/:id`, `PATCH /clients/:id`) accept `expectedUpdatedAt`; if the record changed since, the API returns **409** instead of overwriting.
- Lead lists also return `totalValue` — the summed `estimatedValue` of **all** matching leads (for board/stage totals).
- Login, OTP verify: privileged roles (super admin, founder, finance, HR, auditor) always get `mfa_required`; an OTP is never a second factor. A privileged user without MFA enrolment is refused (403) until enrolled.

## Auth — `/auth`

| Method | Path | Body | Returns |
| ------ | ---- | ---- | ------- |
| GET | `/auth/session` | — | `Session` or 401 |
| POST | `/auth/login` | `{ email, password }` | `{ status: "ok", session }` · `{ status: "mfa_required", challengeId }` · `{ status: "mfa_enrollment_required", challengeId, otpauthUrl }` |
| POST | `/auth/mfa/verify` | `{ challengeId, code }` | `Session`. For enrolment challenges, this also confirms and stores the encrypted secret. |
| POST | `/auth/otp/request` | `{ phone }` | `{ challengeId, expiresAt }`, identical whether or not the number exists |
| POST | `/auth/otp/verify` | `{ challengeId, code }` | `Session`, or `mfa_required` for privileged roles |
| POST | `/auth/password/forgot` | `{ email }` | 204 always |
| POST | `/auth/password/reset` | `{ token, password }` | 204; revokes all sessions of that user |
| POST | `/auth/password/change` | `{ currentPassword, newPassword }` | 204 |
| POST | `/auth/logout` | — | 204, revokes the server session |

Failures are throttled: 5 per account or challenge and 50 per IP, within 10 minutes. Throttled requests return 429.

## Leads — `/leads`

| Method   | Path                             | Notes                                                                                                                                                                                     |
| -------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET      | `/leads`                         | `LeadListQuery`: `search, stage[], productLine[], ownerId[], source[], priority[], view (all\|mine\|open\|due_today\|overdue\|hot), sort, page, pageSize`. Scoped by role (own/team/all). |
| GET      | `/leads/:id`                     | 404 when outside scope                                                                                                                                                                    |
| POST     | `/leads`                         | `LeadInput`. Owner ≠ caller requires `leads.assign` and an in-scope owner.                                                                                                                |
| PATCH    | `/leads/:id`                     | `LeadInput`. Owner change requires `leads.assign`.                                                                                                                                        |
| POST     | `/leads/assign`                  | `{ ids[], ownerId }` — all-or-nothing                                                                                                                                                     |
| POST     | `/leads/stage`                   | `{ ids[], stage }` — bulk, all-or-nothing; `won`/`lost` not allowed in bulk                                                                                                               |
| POST     | `/leads/:id/stage`               | `{ stage, lostReason? }` — `lost` requires a reason; **`won` is rejected (409): only `/convert` can set it**; converted leads can't leave `won`                                           |
| POST     | `/leads/export`                  | `LeadListQuery` → `{ rows, total, truncated }`. Requires `leads.export`; capped at 5,000 rows; writes an audit event                                                                      |
| POST     | `/leads/duplicates`              | `{ phone?, email?, company?, excludeId? }` → `{ matches[], hiddenMatchCount }`. Requires `leads.create` or `leads.update`; rate-limited                                                   |
| GET/POST | `/leads/:id/activities`          | `LogActivityInput { type: note\|call\|meeting\|email, summary, body?, occurredAt? }`                                                                                                      |
| POST     | `/leads/:id/follow-ups`          | `{ at, note? }`                                                                                                                                                                           |
| POST     | `/leads/:id/follow-ups/complete` | `{ outcome, nextAt \| null }`                                                                                                                                                             |
| POST     | `/leads/:id/convert`             | `ConvertLeadInput` → `{ lead, client }` in **one transaction**                                                                                                                            |

## Clients — `/clients`

| Method       | Path                       | Notes                                                                   |
| ------------ | -------------------------- | ----------------------------------------------------------------------- |
| GET          | `/clients`                 | `search, status[], category[], page, pageSize`                          |
| GET          | `/clients/:id`             |                                                                         |
| POST / PATCH | `/clients`, `/clients/:id` | `ClientInput` (GSTIN validated incl. checksum; unique per organisation) |
| GET          | `/clients/:id/timeline`    | client activities + source-lead activities the caller may see           |

## Other

| Method | Path                                         | Notes                                                                                                                                          |
| ------ | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/users/assignable`                          | users the caller may assign to                                                                                                                 |
| GET    | `/users`                                     | directory: `PublicUser` = id, name, title, roles, teamId, avatarHue (no email, phone or MFA status)                                            |
| GET    | `/dashboard/summary`                         | `DashboardSummary`; scope follows the caller's lead scope; `revenueSeries` only with `dashboard.view_company_metrics` and only from the ledger |
| GET    | `/search?q=`                                 | authorised leads + clients                                                                                                                     |
| GET    | `/notifications`, POST `/notifications/read` |                                                                                                                                                |

## Sales (Sprint 3)

| Method | Path | Permission / notes |
| ------ | ---- | ------------------ |
| GET/POST | `/products`, GET/PUT `/products/:id`, GET `/products/:id/price-history` | `catalogue.view` / `catalogue.manage`. Price changes are recorded in history. |
| GET/POST | `/tax-rules`, GET `/tax-rules/lookup?hsn=&date=` | `catalogue.view` / `tax.manage`. Overlapping validity is rejected; lookup uses the longest HSN prefix. |
| GET/POST | `/documents`, GET `/documents/:id` | `documents.view` / `documents.create` (BRD, PRD, SOW) |
| PUT | `/documents/:id/draft` · POST `/documents/:id/versions` · `/submit` · `/withdraw` | Draft editing, new version; submit needs `documents.submit_review`, approval `documents.approve` |
| GET | `/approvals` · POST `/approvals/:id/decide` | `{ decision: approve\|reject, comment }`. Needs the approve permission of the entity type; the requester cannot decide their own request. |
| GET/POST | `/quotations`, GET/PUT `/quotations/:id` | `quotations.view` / `quotations.create`, scoped by `commercialScope`. PUT needs `expectedUpdatedAt` and works only in draft. |
| POST | `/quotations/:id/submit` · `/send` · `/client-decision` · `/revise` · `/cancel`, GET `/revisions` | Send needs `quotations.send`. Approval (`quotations.approve`) is needed above the discount/value thresholds in settings. Accepting creates the sales order in the same transaction. |
| GET | `/quotations/:id/pdf` | `application/pdf`. Watermarked when not approved. |

## Delivery (Sprint 4)

| Method | Path | Notes |
| ------ | ---- | ----- |
| GET | `/sales-orders`, `/sales-orders/:id` · POST `/sales-orders/:id/status` | `orders.view` / `orders.manage` |
| GET/POST | `/projects`, GET/PATCH `/projects/:id` | `projects.view` / `projects.manage`; members see their own projects |
| POST | `/projects/:id/activate` | `projects.activate`; needs an approved BRD linked to the project's order |
| POST | `/projects/:id/milestones` · `/milestones/:id/status` · `/milestones/:id/uat` · `/uat/:id/result` · `/milestones/:id/sign-off` | Sign-off needs all UAT items passed; append-only |
| GET/POST | `/projects/:id/tasks` · PATCH `/tasks/:id` · POST `/tasks/:id/move` · GET `/tasks/mine` | Board ordering |
| POST | `/projects/:id/change-requests` · `/change-requests/:id/submit` | Approved CRs adjust scope/value via approvals |
| GET/POST | `/subscriptions`, GET `/subscriptions/:id` · POST `/:id/status` · `/:id/renew` | `orders.view` / `orders.manage` |

## Finance (Sprint 5)

| Method | Path | Notes |
| ------ | ---- | ----- |
| GET/POST | `/finance/accounts` · GET `/finance/accounts/:id/ledger` | `finance.view`; creating accounts needs `finance.journal.post` |
| GET/POST | `/finance/journals`, GET `/:id` · POST `/:id/reverse` | `finance.journal.post`. Manual journals go through approval; reversal replaces editing |
| GET | `/finance/periods` · `/finance/periods/:month/checks` · POST `/:month/close` · `/:month/reopen` | `finance.period.close`. Close blocks postings; reopen is audited |
| GET/POST | `/invoices`, GET/PUT/DELETE `/invoices/:id` (draft only) | `finance.view` / `finance.invoice.issue` |
| POST | `/invoices/from-sales-order/:id` · `/from-milestone/:id` · `/run-billing` | Drafts from delivery; `run-billing` bills due subscriptions |
| POST | `/invoices/:id/issue` · `/invoices/:id/credit-notes` · GET `/invoices/:id/pdf` | Issue assigns a gap-free number and posts the journal |
| GET/POST | `/receipts` (Idempotency-Key), GET `/receipts/:id` · POST `/:id/allocate` | `finance.receipt.record`. TDS deducted by the client is booked as a receivable |
| GET/POST | `/vendors` · `/bills`, GET `/bills/:id` · POST `/bills/:id/payments` | `finance.bill.manage`. Input GST (ITC) and TDS payable |
| POST | `/bank/import` · GET `/bank/lines` · `/bank/summary` · POST `/bank/lines/:id/match` · `/categorize` · `/ignore` | `finance.bank.reconcile`. CSV import with duplicate-line detection |
| GET | `/reports/trial-balance` · `/profit-and-loss` · `/balance-sheet` · `/cash-flow` · `/gst-summary` · `/receivables-ageing` · `/payables-ageing` | `finance.view`; computed from the ledger only |

## People, support, automation, admin (Sprint 6)

| Method | Path | Notes |
| ------ | ---- | ----- |
| GET/POST | `/hr/departments` · `/hr/holidays` · `/hr/leave-types` | `hr.manage` to write |
| GET/POST | `/hr/employees`, GET/PUT `/:id` · POST `/:id/exit` · GET/POST `/:id/salary` | Bank account accepted in full, stored encrypted, returned as last 4 only. Salary needs `hr.payroll.manage`. |
| GET/POST | `/hr/attendance` · `/hr/leave`, POST `/hr/leave/:id/cancel` · GET `/hr/leave/balances` · `/hr/me` | `hr.self_service` for own records, `hr.view` for others; leave approval needs `hr.leave.approve`; approvals go through `/approvals` |
| GET/POST | `/payroll/runs`, GET `/:id` · POST `/:id/submit` · `/:id/post` · GET `/payroll/my-payslips` | `hr.payroll.manage`. Prepare → submit → approve (another person) → post to ledger |
| GET/POST | `/tickets`, GET/PATCH `/tickets/:id` · POST `/:id/comments` · GET `/tickets/sla-policies` | `support.view` / `support.manage`. SLA due times are set from the policy at creation |
| GET/POST | `/automations`, PUT/DELETE `/:id` · GET `/automations/triggers` · `/runs` · POST `/run-now` | `automations.manage` |
| GET/PUT | `/admin/settings` · GET `/org/profile` | `settings.manage` (profile is readable by any signed-in user). Organisation profile, numbering, approval thresholds, payroll rates |
| GET/POST | `/admin/users`, PATCH `/:id` · POST `/:id/reset-mfa` · `/:id/send-reset` · GET `/admin/roles` · POST `/admin/teams` · GET `/teams` | `users.manage_roles` |
| GET | `/admin/outbox` · `/audit` · `/reports/sales` · `/reports/hr` · `/reports/support` | `settings.manage` (outbox), `audit.view` (audit), `reports.view` (reports). Outbox shows `blocked` messages when no provider is set |
| GET | `/healthz` (no prefix) | Liveness |
