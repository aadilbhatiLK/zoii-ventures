# Deploying Zoii Business OS (kuicko2 + Vercel)

Read this first when asked to "deploy". It records how the live copy was set up on 2026-10-25 and how to push changes to it. No secrets are in this file.

## What is live

| Piece | Where |
| ----- | ----- |
| Web (Next.js) | Vercel project `zoii-business-os` → https://zoii-business-os.vercel.app |
| API (Fastify) | Azure VM `kuicko2` (`ssh kuicko2`), pm2 process `zoii-bos-api`, `127.0.0.1:4200` |
| API public URL | https://zoii-bos-api.98.70.24.252.nip.io (nginx + certbot, site file `/etc/nginx/sites-available/zoii-bos-api.conf`) |
| Database | Postgres 16 on kuicko2, db and role `zoii_bos` (non-superuser, localhost only) |
| Server code | `/opt/apps/zoii-bos/repo` |
| Server secrets | `/opt/apps/zoii-bos/api.env` (mode 600). **Never print, commit or paste it.** |

How the pieces connect:
- The browser only talks to the Vercel origin. `vercel.json` rewrites `/api/v1/*` to the API, so login cookies stay same-origin.
- The API runs in production mode. It refuses demo seed data and the fixed `000000` code. The only user is the super admin, who enrols TOTP on first sign-in.
- SMS and email providers are `none`, so no OTP or invite messages are sent.
- `DATA_ENCRYPTION_KEY` lives only in `api.env`. If it is lost, every user must re-enrol MFA and employee bank details are unreadable. Back it up separately.

Other apps on the same VM that must not be touched: `kuicko-*`, `somnath-sales-api`, `zoii-api` (the POS), `zoii-mock-kuicko`. Ports 3010–3019, 3041, 4100, 4199 are taken. This app uses 4200.

## Local files that are not in git

- `vercel.json` (the `/api/v1` rewrite) and `.vercel/` (link to the Vercel project). If the repo is re-cloned, recreate them:
  ```bash
  cat > vercel.json <<'EOF'
  { "rewrites": [ { "source": "/api/v1/:path*", "destination": "https://zoii-bos-api.98.70.24.252.nip.io/api/v1/:path*" } ] }
  EOF
  npx vercel link --yes --project zoii-business-os
  ```
- Vercel production env vars (already set): `NEXT_PUBLIC_DATA_MODE=api`, `NEXT_PUBLIC_API_BASE_URL=https://zoii-business-os.vercel.app`.

## Security rules for production changes

From the permanent Zoii security policy. Before any change to the database, server config or secrets:
1. Say what changes, the risk, the downtime and the rollback.
2. Take a backup and confirm it reads back.
3. Get the owner's explicit approval (a plain "deploy" request counts for a code deploy; destructive actions, firewall, DNS, secrets and DB permissions need their own approval).
4. Apply, verify, keep the evidence.

Never restore a backup over production without explicit authorization.

## Deploy the API

Use Node 22 locally. Work from the repo root (`~/Developer/zoii-ventures`).

1. Check it builds and passes locally:
   ```bash
   export PATH=~/.nvm/versions/node/v22.23.1/bin:$PATH
   npm run typecheck && npm run api:typecheck && npm test && npm run api:test
   ```
2. If the change includes new files under `database/migrations/`, take a backup first (see below).
3. Upload the code. This leaves `node_modules`, builds and secrets alone:
   ```bash
   rsync -az --delete --exclude node_modules --exclude .git --exclude .next --exclude .data \
     --exclude 'backend/dist' --exclude .vercel --exclude '.env*' ./ kuicko2:/opt/apps/zoii-bos/repo/
   ```
4. Install and build on the server:
   ```bash
   ssh kuicko2 'cd /opt/apps/zoii-bos/repo && npm ci --no-audit --no-fund && cd backend && npm ci --no-audit --no-fund && npm run build'
   ```
5. Migrate (only if there are new migrations). `npm run migrate` builds `dist/cli.mjs` with esbuild and runs it (fixed 2026-10-27; tested on Postgres 16 locally):
   ```bash
   ssh kuicko2 'cd /opt/apps/zoii-bos/repo/backend && set -a && . /opt/apps/zoii-bos/api.env && set +a && npm run migrate'
   ```
   Migrations are forward-only and checksummed. Never edit one that has already been applied; add a new file.
6. Before restarting, check `api.env` passes the startup validation. It prints `Configuration ok` or the list of problems, never the values:
   ```bash
   ssh kuicko2 'cd /opt/apps/zoii-bos/repo/backend && set -a && . /opt/apps/zoii-bos/api.env && set +a && npm run -s cli -- check-config'
   ```
7. Restart and check:
   ```bash
   ssh kuicko2 'pm2 restart zoii-bos-api --update-env && sleep 3 && curl -s localhost:4200/healthz && pm2 logs zoii-bos-api --lines 15 --nostream'
   ```

## Deploy the web app

```bash
export PATH=~/.nvm/versions/node/v22.23.1/bin:$PATH
npx vercel --prod --yes
```
It is aliased to https://zoii-business-os.vercel.app. If `NEXT_PUBLIC_*` values change, update them with `npx vercel env` first, since they are baked in at build time.

## Backup before migrating

```bash
ssh kuicko2 'f=/opt/apps/zoii-bos/backups/zoii_bos_$(date +%Y%m%d_%H%M).dump; mkdir -p /opt/apps/zoii-bos/backups; sudo -u postgres pg_dump -Fc zoii_bos > $f && ls -l $f && pg_restore -l $f | wc -l'
```
This makes a dump and checks it can be read back. There is no scheduled backup yet, and no tested restore, so the dump is only as trustworthy as that check.

## Verify after a deploy

```bash
curl -s https://zoii-bos-api.98.70.24.252.nip.io/healthz          # {"ok":true}
curl -s -o /dev/null -w "%{http_code}\n" https://zoii-business-os.vercel.app/login   # 200
```
The API rejects requests without the header `x-requested-with: zoii-web` (CSRF check). When testing login with curl, also send `origin: https://zoii-business-os.vercel.app`.
```bash
curl -s -H 'content-type: application/json' -H 'origin: https://zoii-business-os.vercel.app' -H 'x-requested-with: zoii-web' \
  -d '{"email":"<admin email>","password":"<password>"}' https://zoii-business-os.vercel.app/api/v1/auth/login
```
A good login returns `mfa_enrollment_required` (first time) or `mfa_required`. The super admin is `aadilbhati@localkonnect.com`. The current test password is in the Claude memory notes / was given in chat. It is a simple test password, so change it before real data goes in.

## Config changes

Required `api.env` values since 2026-10-27 (the API refuses to start without them):
- `NODE_ENV=production`
- `APP_BASE_URL=https://zoii-business-os.vercel.app` (https; invite and reset links use it)
- `TRUST_PROXY=127.0.0.1` (nginx on the same host). `true` is refused. nginx must send `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`.
- No `COOKIE_SECURE=false`, `SEED_DEMO=true` or `AUTH_DEV_STATIC_CODES=true`.

Optional, for per-user rate limits behind Vercel (see "Real client IP" below): `CLIENT_IP_SIGNING_SECRET`.

- API settings: edit `/opt/apps/zoii-bos/api.env` on the server, then `pm2 restart zoii-bos-api --update-env`. Rules the API enforces at startup: `CORS_ORIGINS` and `APP_BASE_URL` must be https, `AUTH_DEV_STATIC_CODES` and `SEED_DEMO` must be unset, console message providers are refused.
- New admin user without the UI: `ADMIN_PASSWORD='…' node dist/cli.mjs create-admin --email … --name …` (from `backend`, with `api.env` loaded). Read the password from a file, not shell history.
- Reset a password directly in the DB: hash with `@node-rs/argon2` default settings and `UPDATE users SET password_hash=…, password_changed_at=now() WHERE email=…`.

## Adding users (no email provider)

Settings → Users → Invite user. Because `EMAIL_PROVIDER=none`, the API returns a one-time link instead of emailing it; the admin copies it and hands it over over a trusted channel. Invite links last 72 h, reset links 24 h, work once, are stored only as a hash and are audited (`user.invite_link`, `user.reset_link`). Only a super admin can issue a link for a super admin or founder. Privileged roles still enrol TOTP at first sign-in.

## Real client IP (optional switch-over)

Today Vercel's `vercel.json` rewrite proxies `/api/v1`, so nginx sees Vercel's egress IPs and rate limits are shared per Vercel address. `src/proxy.ts` can take over the proxying and add an HMAC-signed client IP that the API verifies. To switch (code is deployed but inactive until the env vars exist):
1. Generate a secret: `openssl rand -base64 48`. Add `CLIENT_IP_SIGNING_SECRET=<it>` to `api.env`, restart the API.
2. In Vercel (production, server-side, **not** `NEXT_PUBLIC_`): `API_PROXY_ORIGIN=https://zoii-bos-api.98.70.24.252.nip.io` and the same `CLIENT_IP_SIGNING_SECRET`. Deploy a **preview** first and sign in through it.
3. Remove the `/api/v1` rewrite from `vercel.json` and deploy to production.
4. Check: failed sign-ins in `auth_attempts` show real client IPs, not Vercel's.
Roll back by unsetting `API_PROXY_ORIGIN` in Vercel and restoring the `vercel.json` rewrite, then redeploying. With `API_PROXY_ORIGIN` unset the proxy passes requests through untouched.

## Rollback

- Code: rsync the previous commit (`git checkout <sha>`), rebuild, `pm2 restart zoii-bos-api`. For the web app, promote the previous deployment in Vercel (`npx vercel rollback`).
- Database: migrations are forward-only. If one must be undone, restore the pre-migration dump into a scratch database first, check it, and get explicit approval before touching the live one.

## Known gaps (as of 2026-10-27)

- No scheduled backups. The dump/restore procedure above was drilled on a local Postgres 16 copy with demo data (75 tables, identical row counts, triggers intact); it has not been run against production.
- The app's DB role owns the database and runs migrations; the security policy prefers separate roles for app, migrations and reporting.
- Rate limits are in memory, so run a single API instance only. The worker runs inside the API process.
- Subscription billing is manual (Invoices → Run billing); expired sessions and auth attempts are never purged.
- Not penetration-tested. No error tracking or uptime alerts.
- No SMS or email provider: OTP sign-in is off and invites/resets are handed over as one-time links. Full list: `docs/integrations.md`.
