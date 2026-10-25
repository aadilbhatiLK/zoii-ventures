import { buildApp } from "../src/app";
import { loadConfig } from "../src/config";
import { createPgliteDb, type Db } from "../src/db";
import { syncRbac } from "../src/db/bootstrap";
import { seedDemo } from "../src/db/demo-seed";
import { migrate } from "../src/db/migrate";

export interface TestCtx {
  app: Awaited<ReturnType<typeof buildApp>>;
  db: Db;
  ids: Map<string, string>;
  sent: { channel: string; recipient: string; template: string; payload: Record<string, unknown> }[];
  clock: { now: Date };
}

export async function setup(opts: { seed?: boolean; now?: Date } = {}): Promise<TestCtx> {
  const config = loadConfig({ NODE_ENV: "test", AUTH_DEV_STATIC_CODES: "true", CORS_ORIGINS: "http://localhost:3000" } as NodeJS.ProcessEnv);
  const db = await createPgliteDb();
  await migrate(db);
  await syncRbac(db);
  const clock = { now: opts.now ?? new Date() };
  const r = opts.seed === false ? { ids: new Map<string, string>() } : await seedDemo(db, config, clock.now);
  const sent: TestCtx["sent"] = [];
  const app = await buildApp({
    db, config, logger: false, now: () => clock.now,
    messages: { async send(m) { sent.push(m); return true; } },
  });
  return { app, db, ids: "ids" in r ? r.ids! : new Map(), sent, clock };
}

export const H = { "x-requested-with": "zoii-web", "content-type": "application/json" };

/** Signs in a demo persona (password zoii-demo; MFA code 000000 in test) and returns its cookie header. */
export async function login(t: TestCtx, email: string): Promise<string> {
  const res = await t.app.inject({ method: "POST", url: "/api/v1/auth/login", headers: H, payload: { email, password: "zoii-demo" } });
  if (res.statusCode !== 200) throw new Error(`login ${email}: ${res.statusCode} ${res.body}`);
  let body = res.json().data;
  let cookieRes = res;
  if (body.status === "mfa_required") {
    cookieRes = await t.app.inject({ method: "POST", url: "/api/v1/auth/mfa/verify", headers: H, payload: { challengeId: body.challengeId, code: "000000" } });
    if (cookieRes.statusCode !== 200) throw new Error(`mfa ${email}: ${cookieRes.body}`);
    body = { status: "ok" };
  }
  const set = cookieRes.headers["set-cookie"];
  const c = (Array.isArray(set) ? set[0] : set)!.split(";")[0];
  return c;
}

export function client(t: TestCtx, cookie: string) {
  const call = async (method: string, url: string, payload?: unknown, extra: Record<string, string> = {}) => {
    const res = await t.app.inject({ method: method as "GET", url: `/api/v1${url}`, headers: { ...(method === "GET" ? {} : H), cookie, ...extra }, payload: payload as object });
    let json: { data?: unknown; error?: { code: string; message: string; details?: Record<string, string[]> } } = {};
    try { json = res.json(); } catch { /* 204 or binary */ }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: assertions narrow the shape
    return { status: res.statusCode, data: json.data as any, error: json.error, raw: res };
  };
  return {
    get: (u: string) => call("GET", u),
    post: (u: string, b?: unknown, h?: Record<string, string>) => call("POST", u, b ?? {}, h),
    patch: (u: string, b: unknown) => call("PATCH", u, b),
    put: (u: string, b: unknown) => call("PUT", u, b),
    del: (u: string) => call("DELETE", u),
  };
}

export const EMAIL = {
  founder: "founder@demo.zoii.in", admin: "admin@demo.zoii.in", salesmgr: "sales.manager@demo.zoii.in",
  sales1: "neha@demo.zoii.in", sales2: "kabir@demo.zoii.in", am: "pooja@demo.zoii.in", fin: "finance@demo.zoii.in",
  pm: "pm@demo.zoii.in", hr: "hr@demo.zoii.in", auditor: "auditor@demo.zoii.in", acct: "accounts@demo.zoii.in", dev: "dev@demo.zoii.in",
};
