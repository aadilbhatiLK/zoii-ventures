# Deployment

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_DATA_MODE` | **Yes in production** | `api` for real use. `demo` uses fictional in-browser data. Defaults to `demo` only in development. |
| `NEXT_PUBLIC_API_BASE_URL` | When mode = `api` | Absolute `https://` URL of the backend (paths are `/api/v1/...`). |
| `NEXT_PUBLIC_ALLOW_DEMO_IN_PRODUCTION` | Only for review builds | Must be exactly `true` for a production build to run in demo mode. A banner stays visible. |

All three are public (inlined into the browser bundle). Never add secrets with the `NEXT_PUBLIC_` prefix.

If the configuration is invalid, every page renders "Zoii Business OS isn't configured" with the reason. It never falls back to demo data.

## Vercel (frontend)

1. Import the repository; framework preset Next.js; Node 20.9+.
2. **Design-review preview:** `NEXT_PUBLIC_DATA_MODE=demo`, `NEXT_PUBLIC_ALLOW_DEMO_IN_PRODUCTION=true`.
3. **Production (after Sprint 2):** `NEXT_PUBLIC_DATA_MODE=api`, `NEXT_PUBLIC_API_BASE_URL=https://api.<domain>`; remove the demo latch.
4. The backend must allow the Vercel origin via CORS with credentials, and set cookies for the shared parent domain (e.g. `app.zoii.in` + `api.zoii.in`).

Vercel hosts only the frontend. It does not provide the backend API, PostgreSQL, OTP/SMS delivery, background workers or file storage.

## Backend (Sprint 2 plan)

| Piece | Suggested | Notes |
|---|---|---|
| API | NestJS on Azure App Service / Container Apps (or Render/Railway) | Same region as the database; health check endpoint |
| Database | Managed PostgreSQL 16 (Azure Flexible Server / Neon / Supabase) | Private networking, PITR backups, separate migration role |
| Jobs | BullMQ worker + Redis | Reminders, notifications, imports |
| Files | Private blob storage | Signed, short-lived download URLs |
| SMS/OTP | DLT-registered Indian SMS provider | Sender ID + template approval needed before go-live |
| Monitoring | Sentry (or equivalent) + uptime checks | Alerts on auth failures and job errors |

## Local development

```bash
cp .env.example .env.local   # demo mode by default
npm install
npm run dev                  # http://localhost:3000 — demo accounts listed on the sign-in screen
npm run check                # typecheck, lint, tests, migration verify, production build
```

E2E smoke (needs a running server):

```bash
NEXT_PUBLIC_DATA_MODE=demo NEXT_PUBLIC_ALLOW_DEMO_IN_PRODUCTION=true npm run build
npx next start -p 3100 &
BASE_URL=http://localhost:3100 npm run e2e
```
