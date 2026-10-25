# Security baseline

Status legend: **Implemented & tested** · **Implemented (reviewed)** · **Implemented** · **Open**.
Nothing here claims the system is "secure"; it records what exists and what was checked.

## Frontend (Sprint 1)

| Control                                                                                                                                                                     | Status                          | Evidence                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------- |
| Production refuses to run without explicit data mode; demo blocked in production unless `NEXT_PUBLIC_ALLOW_DEMO_IN_PRODUCTION=true`; config errors render a hard error page | Implemented & tested            | `tests/unit/config.test.ts`                                   |
| Demo mode permanently labelled (banner, "Demo data/fixture" tags, CSV banner line)                                                                                          | Implemented & tested            | e2e steps 2, 15                                               |
| No secrets in `NEXT_PUBLIC_*`; `.env*` git-ignored except `.env.example`                                                                                                    | Implemented                     | secret scan (below)                                           |
| Security headers: CSP, X-Frame-Options DENY, frame-ancestors none, nosniff, Referrer-Policy, Permissions-Policy, HSTS, COOP; `X-Powered-By` removed                         | Implemented & checked with curl | `next.config.ts`                                              |
| Open-redirect protection on `?next=` (control characters, backslashes, dot-segment normalisation to `//host`)                                                               | Implemented & tested            | `safeNextPath` + review regression tests                      |
| MFA enforced for privileged roles on every sign-in path (password and OTP); shell signs out any privileged session without `mfaSatisfied`                                   | Implemented & tested            | review regression #1                                          |
| Login/OTP rate limits per account/number (one account's success never resets another's counter); unknown numbers behave like known ones                                     | Implemented & tested            | review regression #14                                         |
| Optimistic concurrency on edits (409 on stale writes)                                                                                                                       | Implemented & tested            | review regression #9                                          |
| Lead export requires `leads.export`, is capped and audited                                                                                                                  | Implemented & tested            | review regression #13                                         |
| User directory returns public fields only                                                                                                                                   | Implemented & tested            | review regression #5                                          |
| CSV formula-injection protection on exports                                                                                                                                 | Implemented & tested            | `csv` tests                                                   |
| Service worker caches only static assets + offline page; never API or authenticated pages                                                                                   | Implemented (reviewed)          | `public/sw.js`                                                |
| No tokens in browser storage (api mode uses httpOnly cookie); demo session in sessionStorage holds only a user id                                                           | Implemented                     | `lib/auth/*`                                                  |
| UI hides actions per permission; every demo-adapter call re-checks permission + record scope; out-of-scope records return 404                                               | Implemented & tested            | `tests/unit/demo-adapter.test.ts`, e2e "not reachable by URL" |
| Duplicate check doesn't leak other teams' leads (count only)                                                                                                                | Implemented & tested            | adapter test                                                  |
| Dependencies audited; `zod` upgraded from 3.25 to 4.6.7 for GHSA-mrhx-c7xc-m3w5 (memory exhaustion)                                                                         | Implemented                     | `npm audit` → 0 vulnerabilities                               |

**Known limitation:** CSP allows `'unsafe-inline'` scripts because Next.js injects inline bootstrap scripts and there is no per-request nonce yet. Move to a nonce-based CSP in `proxy.ts` once the app is served dynamically with the backend (Sprint 2).

**The demo auth adapter is not a security boundary.** It exists to exercise UI states (MFA, OTP expiry/reuse, rate limits, non-enumerating reset).

## Backend (Sprints 2–6)

Evidence column: `S2` = `backend/tests/s2-auth-crm.test.ts`, `S3-6` = `backend/tests/s3-s6-flows.test.ts`. Both run against real Postgres (PGlite).

| Control | Status | Evidence |
| ------- | ------ | -------- |
| Config refuses unsafe production settings: missing `DATABASE_URL` / `DATA_ENCRYPTION_KEY`, http CORS origins, `AUTH_DEV_STATIC_CODES`, console SMS/email, demo seed | Implemented | `backend/src/config.ts` |
| Passwords hashed with argon2id; session tokens are 32 random bytes, only the SHA-256 hash is stored; httpOnly, SameSite=Lax cookie, `Secure` when configured | Implemented & tested | S2 |
| TOTP MFA (RFC 6238, ±1 step) mandatory for privileged roles. Enrolment is forced at first login. Secrets are AES-256-GCM encrypted at rest. An OTP never counts as a second factor. | Implemented & tested | S2 |
| Throttling: 5 failures per account/challenge and 50 per IP in 10 minutes (DB-backed), plus per-route rate limits | Implemented & tested | S2 |
| OTP request and password reset are non-enumerating. Reset tokens are single-use and hashed, and a reset revokes all sessions. | Implemented & tested | S2 |
| CSRF: state-changing requests require `X-Requested-With: zoii-web` and an allow-listed `Origin` | Implemented & tested | S2 |
| Authorization on every route (`need` + record scope); out-of-scope records return 404; tested by calling the API directly as different roles | Implemented & tested | S2, S3-6 |
| Optimistic concurrency (409) on lead, client, quotation and settings edits | Implemented & tested | S2, S3-6 |
| Maker-checker: requesters cannot approve their own documents, quotations, change requests, leave or payroll; payroll approver ≠ preparer is also a DB `CHECK` | Implemented & tested | S3-6 |
| Financial integrity in the DB: balanced journals (deferred trigger), append-only journals, sign-offs and audit, frozen issued documents, closed-period lock, bounded allocations | Implemented & tested | S3-6, `db:verify` |
| Idempotency-Key on receipts and bill payments (replay returns the original, different body → 409) | Implemented & tested | S3-6 |
| Employee bank account numbers encrypted (AES-256-GCM); API returns last 4 only | Implemented & tested | S3-6 |
| Audit event on every write; audit table append-only (UPDATE/DELETE raise) | Implemented & tested | S2, S3-6 |
| No passwords, OTPs or tokens in logs. Console messaging is refused in production; Fastify logger redacts the cookie and authorization headers. | Implemented (reviewed) | `app.ts`, `config.ts` |
| Request body limit 2 MB; bank CSV import capped | Implemented | `app.ts` |
| PDFs generated server-side from DB data; no user HTML is rendered | Implemented | `sales/pdf.ts` |
| Dependencies audited (root + backend) | Implemented | `npm audit` → 0 vulnerabilities |

### Known limitations (backend)

- **Rate limits are in-memory per instance.** Multiple API instances need a shared store (Redis). The DB-backed auth throttle is already shared.
- **The worker runs inside the API process.** Run a single dedicated worker before scaling out.
- **CSP is still static** with `'unsafe-inline'` scripts. A nonce-based CSP via `proxy.ts` is still open.
- **No SMS/email provider.** OTP login and password-reset emails cannot reach users in production until one is integrated; messages queue as `blocked`.
- **Payroll TDS is entered manually**, and PF/ESI/PT rates come from settings. A CA must confirm the statutory configuration before real payroll runs.
- **No e-invoice IRN / GST portal integration.** PDFs state that no IRN was generated.
- **No penetration test yet.** Run one only against an authorised staging environment.
- The least-privilege DB role split (app role without DDL, separate migration role) is documented in deployment, but not enforced by code.

## Independent review

An independent review of the Sprint 1 code found 18 issues: 3 high, 9 medium, 6 low. All are fixed, and each has a regression test in `tests/unit/review-fixes.test.ts` or a check in `db:verify`, except these:

- **CSV `+` prefix:** cells starting with `+` (for example `+91…` phone numbers) are still prefixed with `'` in exports. Formula-injection safety was chosen over cosmetics.
- **Duplicate-check rate limiting:** designed for the backend. The demo does not implement it.
- **Trigram search indexes:** deferred to Sprint 2, pending the managed Postgres extension list.

While writing those tests, a further redirect bypass was found and fixed: `/ /../..//evil.com` normalised to `//evil.com`.

## Checks run in Sprint 1

- `npm audit` — 0 vulnerabilities (after zod upgrade).
- Secret scan (`git grep` for keys/tokens/passwords patterns) — only the documented demo password `zoii-demo` and demo OTP `000000`, which are intentional fixtures.
- Header check via `curl -I` on the production build.
- Authorization: unit tests for role matrix and record scope; e2e direct-URL access to a restricted module and to another owner's lead.

Penetration testing is out of scope until the backend exists, and only in an authorised staging environment.
