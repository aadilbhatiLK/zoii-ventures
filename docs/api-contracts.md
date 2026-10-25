# API contracts (v1)

Source of truth: `src/lib/api/contracts.ts` (zod) and `src/lib/api/client.ts` (interface). This page lists the HTTP mapping the Sprint 2 backend must implement. The `HttpApiClient` already calls these paths.

## Conventions

- Base: `${NEXT_PUBLIC_API_BASE_URL}/api/v1`. JSON only.
- Success: `{ "data": <T> }`. Error: `{ "error": { code, message, details?, requestId? } }` with HTTP 4xx/5xx.
- Error codes: `UNAUTHENTICATED` 401 · `FORBIDDEN` 403 · `NOT_FOUND` 404 (also for records outside the caller's scope) · `VALIDATION` 422 (field → messages in `details`) · `CONFLICT` 409 · `RATE_LIMITED` 429 · `INTERNAL` 500.
- Auth: httpOnly, `Secure`, `SameSite=Lax` session cookie set by the backend; browser sends `credentials: include`. State-changing requests carry `X-Requested-With: zoii-web`; the backend rejects state changes without it (CSRF defence alongside SameSite).
- Money: decimal strings (`"125000.00"`). Timestamps: ISO 8601 UTC.
- Lists: `?page=1&pageSize=20` (10|20|50), filters as repeated params, `sort={"field":"createdAt","dir":"desc"}`. Response `Paginated<T> = { items, total, page, pageSize }`.
- Writes accept `Idempotency-Key` (required for imports and payment webhooks from Sprint 5).
- Updates (`PATCH /leads/:id`, `PATCH /clients/:id`) accept `expectedUpdatedAt`; if the record changed since, the API returns **409** instead of overwriting.
- Lead lists also return `totalValue` — the summed `estimatedValue` of **all** matching leads (for board/stage totals).
- Login, OTP verify: privileged roles (super admin, founder, finance, HR, auditor) always get `mfa_required`; an OTP is never a second factor. A privileged user without MFA enrolment is refused (403) until enrolled.

## Auth — `/auth`

| Method | Path                    | Body                    | Returns                                                                       |
| ------ | ----------------------- | ----------------------- | ----------------------------------------------------------------------------- |
| GET    | `/auth/session`         | —                       | `Session` or 401                                                              |
| POST   | `/auth/login`           | `{ email, password }`   | `{ status: "ok", session }` or `{ status: "mfa_required", challengeId }`      |
| POST   | `/auth/mfa/verify`      | `{ challengeId, code }` | `Session`                                                                     |
| POST   | `/auth/otp/request`     | `{ phone }`             | `{ challengeId, expiresAt }` (same response whether or not the number exists) |
| POST   | `/auth/otp/verify`      | `{ challengeId, code }` | `Session`                                                                     |
| POST   | `/auth/password/forgot` | `{ email }`             | 204 always (no enumeration)                                                   |
| POST   | `/auth/logout`          | —                       | 204, revokes the server session                                               |

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
