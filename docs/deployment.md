# Deployment

**The live deployment (Vercel + the kuicko2 VM) and how to update it are in [`DEPLOY.md`](../DEPLOY.md).** This page is the configuration reference. Which integrations are still missing: [`integrations.md`](integrations.md).

## Frontend environment (public — inlined into the browser bundle)

| Variable | Required | Notes |
| -------- | -------- | ----- |
| `NEXT_PUBLIC_DATA_MODE` | **Yes in production** | `api` for real use; `demo` = fictional in-browser data. |
| `NEXT_PUBLIC_API_BASE_URL` | When mode = `api` | Absolute `https://` URL of the API. Plain `http` is accepted only for `localhost`/`127.0.0.1`, so production builds can be verified locally. |
| `NEXT_PUBLIC_ALLOW_DEMO_IN_PRODUCTION` | Review builds only | Must be exactly `true` for a production build to run in demo mode. |
| `NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS` | Never in production | Lists the seeded dev accounts on the sign-in page. |
| `API_PROXY_ORIGIN` | Optional (server-only) | When set, `src/proxy.ts` forwards `/api/v1/*` to this API origin itself (replacing the `vercel.json` rewrite) and adds a signed client IP. |
| `CLIENT_IP_SIGNING_SECRET` | With `API_PROXY_ORIGIN` (server-only) | Same value as the API's. Never `NEXT_PUBLIC_`. |

Never put secrets in `NEXT_PUBLIC_*`. If the configuration is invalid, every page renders a configuration error and the app never falls back to demo data.

## API environment (server-side only) — see `backend/.env.example`

| Variable | Production requirement |
| -------- | ---------------------- |
| `NODE_ENV` | `production`. Anything other than development/test/production is refused. |
| `DATABASE_URL`, `DATABASE_SSL` | Required. Managed PostgreSQL 16+. Use SSL. |
| `DATA_ENCRYPTION_KEY` | Required in production and whenever `DATABASE_URL` is set. 32 random bytes, base64. Encrypts TOTP secrets and employee bank accounts. **Back it up separately; losing it means re-enrolling MFA and re-entering bank details.** |
| `CORS_ORIGINS`, `APP_BASE_URL` | Required, https only (checked at startup). `APP_BASE_URL` is where invite and reset links point. |
| `COOKIE_SECURE=true`, `COOKIE_DOMAIN` | Shared parent domain, for example `app.zoii.in` and `api.zoii.in`. |
| `TRUST_PROXY` | The proxy's address(es)/CIDR, e.g. `127.0.0.1` behind nginx on the same host. `true` is refused in production (it lets clients spoof their IP). |
| `CLIENT_IP_SIGNING_SECRET` | Optional, 32+ characters. Verifies the client IP signed by the web tier. |
| `COOKIE_SECURE` | Leave unset. `false` is refused in production. |
| `PORT`, `SESSION_HOURS`, `WORKER_INTERVAL_MS` | Whole numbers (1–65535, 1–72, ≥1000). Malformed values are refused. |
| `SMS_PROVIDER`, `EMAIL_PROVIDER` | `none` until a provider is integrated. `console` is refused in production. |
| `AUTH_DEV_STATIC_CODES`, `SEED_DEMO` | Must be unset/false. The API refuses to start otherwise (both checked). |
| `MIGRATE_ON_START` | Leave unset. Migrate as a release step. |

## Release procedure

```bash
cd backend
npm ci && npm run build                 # → dist/server.mjs (esbuild bundle)
npm run migrate                         # release step (builds dist/cli.mjs, then runs it); after a verified backup
ADMIN_PASSWORD='…' npm run create-admin -- --email you@zoii.in --name "…" --gstin …   # first deploy only; read password from a secret store, not shell history
# Later users: Settings → Users → Invite. With EMAIL_PROVIDER=none the admin gets a one-time link to hand over.
NODE_ENV=production node dist/server.mjs
```

- Migrations are forward-only and checksummed. An already-applied file that has been edited makes the runner refuse to continue.
- **Never run migrations against production without a tested backup/restore and explicit approval.**
- Health check: `GET /healthz`.
- The worker runs inside the API process. Before running more than one API instance:
  - move the worker into its own single-instance process;
  - move the rate-limit store to Redis.
  
  Automations are already exactly-once at the DB level, but outbox dispatch and rate limits are per instance.

## Suggested hosting

| Piece | Suggested | Notes |
| ----- | --------- | ----- |
| Frontend | Vercel | `NEXT_PUBLIC_DATA_MODE=api`, `NEXT_PUBLIC_API_BASE_URL=https://api.<domain>` |
| API | Azure Container Apps / Render / Railway (Node 20+) | Same region as the DB (India) |
| Database | Azure Flexible Server / Neon / Supabase (PG 16+) | PITR backups, private networking, separate migration role |
| SMS/OTP | DLT-registered Indian provider | Sender ID + template approval before go-live |
| Email | SES / Postmark | SPF/DKIM on the domain |
| Monitoring | Sentry + uptime check on `/healthz` | Alerts on auth failures and worker errors |

## Local verification

```bash
cd backend && npm run build && node --env-file=.env dist/server.mjs     # :4000
# frontend, with .env.local in api mode:
npm run build && npx next start -p 3000
node tests/e2e/modules.cjs && node tests/e2e/flow.cjs
```
