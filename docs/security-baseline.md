# Security baseline

Status legend: **Implemented & tested** · **Implemented (untested)** · **Designed (backend, Sprint 2)** · **Open**.
Nothing here claims the system is "secure"; it records what exists and what was checked.

## Frontend (Sprint 1)

| Control | Status | Evidence |
|---|---|---|
| Production refuses to run without explicit data mode; demo blocked in production unless `NEXT_PUBLIC_ALLOW_DEMO_IN_PRODUCTION=true`; config errors render a hard error page | Implemented & tested | `tests/unit/config.test.ts` |
| Demo mode permanently labelled (banner, "Demo data/fixture" tags, CSV banner line) | Implemented & tested | e2e steps 2, 15 |
| No secrets in `NEXT_PUBLIC_*`; `.env*` git-ignored except `.env.example` | Implemented | secret scan (below) |
| Security headers: CSP, X-Frame-Options DENY, frame-ancestors none, nosniff, Referrer-Policy, Permissions-Policy, HSTS, COOP; `X-Powered-By` removed | Implemented & checked with curl | `next.config.ts` |
| Open-redirect protection on `?next=` | Implemented & tested | `safeNextPath` tests |
| CSV formula-injection protection on exports | Implemented & tested | `csv` tests |
| Service worker caches only static assets + offline page; never API or authenticated pages | Implemented (reviewed) | `public/sw.js` |
| No tokens in browser storage (api mode uses httpOnly cookie); demo session in sessionStorage holds only a user id | Implemented | `lib/auth/*` |
| UI hides actions per permission; every demo-adapter call re-checks permission + record scope; out-of-scope records return 404 | Implemented & tested | `tests/unit/demo-adapter.test.ts`, e2e "not reachable by URL" |
| Duplicate check doesn't leak other teams' leads (count only) | Implemented & tested | adapter test |
| Dependencies audited; `zod` upgraded from 3.25 to 4.6.7 for GHSA-mrhx-c7xc-m3w5 (memory exhaustion) | Implemented | `npm audit` → 0 vulnerabilities |

**Known limitation:** CSP allows `'unsafe-inline'` scripts because Next.js injects inline bootstrap scripts and there is no per-request nonce yet. Move to a nonce-based CSP in `proxy.ts` once the app is served dynamically with the backend (Sprint 2).

**The demo auth adapter is not a security boundary.** It exists to exercise UI states (MFA, OTP expiry/reuse, rate limits, non-enumerating reset).

## Backend (designed for Sprint 2 — not implemented)

- Auth via a vetted library (e.g. Better Auth / Lucia-style session tables already modelled in `0001_foundation.sql`), argon2id password hashing, server-side sessions with hashed tokens, revocation on logout/role change.
- OTP: 6 digits, 5-minute expiry, single use, max 5 attempts, per-number and per-IP rate limits, delivered via a DLT-registered SMS provider (India TRAI rules).
- MFA (TOTP) mandatory for super admin, founder, finance, HR, auditor.
- Authorization guard on every endpoint using the same permission registry + record scope; integration tests call endpoints directly as each role.
- CSRF: SameSite cookies + required `X-Requested-With` header on state changes.
- Rate limiting (login, OTP, password reset, search), request size limits, file-type sniffing + private object storage with short-lived signed URLs.
- Least-privilege DB roles (app role without DDL; migration role separate), private networking, encrypted backups with tested restore.
- Audit events for every sensitive write; structured logs without passwords, OTPs or tokens; error monitoring and security alerts.

## Checks run in Sprint 1

- `npm audit` — 0 vulnerabilities (after zod upgrade).
- Secret scan (`git grep` for keys/tokens/passwords patterns) — only the documented demo password `zoii-demo` and demo OTP `000000`, which are intentional fixtures.
- Header check via `curl -I` on the production build.
- Authorization: unit tests for role matrix and record scope; e2e direct-URL access to a restricted module and to another owner's lead.

Penetration testing is out of scope until the backend exists, and only in an authorised staging environment.
