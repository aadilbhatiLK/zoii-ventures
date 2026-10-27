import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { randomUUID } from "node:crypto";
import type { Config } from "./config";
import type { Db } from "./db";
import { type Actor, type Deps, type MessageSender, makeActor } from "./lib/context";
import { HttpError, mapPgError } from "./lib/errors";
import { sha256 } from "./lib/crypto";
import { requiresMfa, type Role } from "@/lib/permissions";
import { registerModules } from "./modules";
import { isUuid } from "./lib/query";
import { clientIp } from "./lib/client-ip";

/** Every `:id` route parameter is a uuid; anything else is simply not found (never a 500). */
function checkIdParams(req: FastifyRequest) {
  const p = (req.params ?? {}) as Record<string, string>;
  if (p.id !== undefined && !isUuid(p.id)) throw new HttpError("NOT_FOUND", "Not found.");
}

export const SESSION_COOKIE = "zoii_session";

declare module "fastify" {
  interface FastifyRequest {
    actor?: Actor;
  }
}

export interface Ctx {
  actor: Actor;
  body: unknown;
  query: Record<string, unknown>;
  params: Record<string, string>;
  req: FastifyRequest;
  reply: FastifyReply;
}
export type PublicCtx = Omit<Ctx, "actor">;

export interface Router {
  get(path: string, h: (c: Ctx) => Promise<unknown>): void;
  post(path: string, h: (c: Ctx) => Promise<unknown>, opts?: RouteOpts): void;
  patch(path: string, h: (c: Ctx) => Promise<unknown>, opts?: RouteOpts): void;
  put(path: string, h: (c: Ctx) => Promise<unknown>, opts?: RouteOpts): void;
  delete(path: string, h: (c: Ctx) => Promise<unknown>, opts?: RouteOpts): void;
  public: {
    get(path: string, h: (c: PublicCtx) => Promise<unknown>, opts?: RouteOpts): void;
    post(path: string, h: (c: PublicCtx) => Promise<unknown>, opts?: RouteOpts): void;
  };
  /** Raw route returning non-JSON (PDF, CSV). Handler must send the reply itself. */
  raw(method: "GET" | "POST", path: string, h: (c: Ctx) => Promise<void>): void;
}
interface RouteOpts { status?: number; rateLimit?: { max: number; timeWindow: string } }

export interface BuildOptions {
  db: Db;
  config: Config;
  now?: () => Date;
  messages?: MessageSender;
  logger?: boolean;
}

export async function buildApp(opts: BuildOptions): Promise<FastifyInstance & { deps: Deps }> {
  const { config, db } = opts;
  const deps: Deps = {
    db,
    config,
    now: opts.now ?? (() => new Date()),
    messages: opts.messages ?? consoleMessages(config),
  };
  const app = Fastify({
    logger: opts.logger === false ? false : {
      level: config.env === "production" ? "info" : "warn",
      redact: ["req.headers.cookie", "req.headers.authorization", "res.headers['set-cookie']"],
    },
    trustProxy: config.trustProxy,
    bodyLimit: 2 * 1024 * 1024,
    genReqId: () => randomUUID(),
  }) as unknown as FastifyInstance & { deps: Deps };
  app.decorate("deps", deps);

  await app.register(cookie);
  await app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin)),
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "X-Requested-With", "Idempotency-Key", "Accept"],
    maxAge: 600,
  });
  await app.register(rateLimit, {
    global: true,
    keyGenerator: (req) => clientIp(req, config, deps.now),
    max: config.env === "test" ? 10_000 : 600,
    timeWindow: "1 minute",
    errorResponseBuilder: (req) => ({
      statusCode: 429,
      error: { code: "RATE_LIMITED", message: "Too many requests. Please slow down.", requestId: req.id },
    }),
  });

  app.addHook("onRequest", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Request-Id", req.id);
    const m = req.method;
    if (m !== "GET" && m !== "HEAD" && m !== "OPTIONS") {
      // CSRF: a custom header can't be sent cross-site without passing CORS preflight,
      // and preflight only succeeds for allow-listed origins.
      if (req.headers["x-requested-with"] !== "zoii-web") {
        throw new HttpError("FORBIDDEN", "Missing request header.");
      }
      const origin = req.headers.origin;
      if (origin && !config.corsOrigins.includes(origin)) throw new HttpError("FORBIDDEN", "Origin not allowed.");
    }
  });

  app.setErrorHandler((err, req, reply) => {
    const e = err as Error & { statusCode?: number; code?: string; validation?: unknown };
    let http: HttpError | null = e instanceof HttpError ? e : mapPgError(e);
    if (!http && e.statusCode === 429) http = new HttpError("RATE_LIMITED", "Too many requests. Please slow down.");
    if (!http && e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      http = new HttpError("VALIDATION", e.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE" ? "Send JSON." : "The request could not be read.");
    }
    if (!http) {
      req.log.error({ err: e, requestId: req.id }, "unhandled error");
      if (config.env === "test" && process.env.DEBUG_ERRORS) console.error(e);
      http = new HttpError("INTERNAL", "Something went wrong on our side. The error has been logged.");
    }
    reply.status(http.status).send({
      error: { code: http.code, message: http.message, details: http.details, requestId: req.id },
    });
  });
  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({ error: { code: "NOT_FOUND", message: "No such endpoint.", requestId: req.id } });
  });

  app.get("/healthz", async () => ({ ok: true }));
  app.get("/readyz", async () => {
    await db.query("SELECT 1");
    return { ok: true };
  });

  const authenticate = async (req: FastifyRequest): Promise<Actor> => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) throw new HttpError("UNAUTHENTICATED", "Sign in to continue.");
    const r = await db.query<{
      session_id: string; user_id: string; organization_id: string; team_id: string | null;
      mfa_satisfied: boolean; roles: Role[] | null; last_seen_at: Date;
    }>(
      `SELECT s.id AS session_id, u.id AS user_id, u.organization_id, u.team_id, s.mfa_satisfied, s.last_seen_at,
              array_agg(r.key) FILTER (WHERE r.key IS NOT NULL) AS roles
         FROM sessions s
         JOIN users u ON u.id = s.user_id AND u.status = 'active'
         LEFT JOIN user_role_assignments ura ON ura.user_id = u.id
         LEFT JOIN roles r ON r.id = ura.role_id
        WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > $2
        GROUP BY s.id, u.id`,
      [sha256(token), deps.now()],
    );
    const row = r.rows[0];
    if (!row) throw new HttpError("UNAUTHENTICATED", "Your session has ended. Please sign in again.");
    const roles = row.roles ?? [];
    // Defence in depth: a privileged account can never act on a session without MFA.
    if (requiresMfa({ roles }) && !row.mfa_satisfied) throw new HttpError("UNAUTHENTICATED", "Two-step verification required.");
    if (deps.now().getTime() - new Date(row.last_seen_at).getTime() > 5 * 60_000) {
      await db.query(`UPDATE sessions SET last_seen_at = $2 WHERE id = $1`, [row.session_id, deps.now()]);
    }
    return makeActor({ ...row, roles }, req.id, clientIp(req, config, deps.now));
  };

  const ctxOf = (req: FastifyRequest, reply: FastifyReply) => ({
    body: req.body,
    query: (req.query ?? {}) as Record<string, unknown>,
    params: (req.params ?? {}) as Record<string, string>,
    req,
    reply,
  });

  await app.register(
    async (api) => {
      const add = (method: string, path: string, handler: (c: Ctx) => Promise<unknown>, isPublic: boolean, o: RouteOpts = {}) => {
        api.route({
          method: method as "GET",
          url: path,
          config: o.rateLimit && config.env !== "test" ? { rateLimit: o.rateLimit } : undefined,
          handler: async (req, reply) => {
            const base = ctxOf(req, reply);
            const actor = isPublic ? (undefined as unknown as Actor) : await authenticate(req);
            req.actor = actor;
            checkIdParams(req);
            const data = await handler({ ...base, actor });
            if (reply.sent) return reply;
            if (data === undefined) return reply.status(204).send();
            return reply.status(o.status ?? (method === "POST" ? 200 : 200)).send({ data });
          },
        });
      };
      const router: Router = {
        get: (p, h) => add("GET", p, h, false),
        post: (p, h, o) => add("POST", p, h, false, o),
        patch: (p, h, o) => add("PATCH", p, h, false, o),
        put: (p, h, o) => add("PUT", p, h, false, o),
        delete: (p, h, o) => add("DELETE", p, h, false, o),
        public: {
          get: (p, h, o) => add("GET", p, h as (c: Ctx) => Promise<unknown>, true, o),
          post: (p, h, o) => add("POST", p, h as (c: Ctx) => Promise<unknown>, true, o),
        },
        raw: (method, path, h) => {
          api.route({
            method,
            url: path,
            handler: async (req, reply) => {
              const actor = await authenticate(req);
              checkIdParams(req);
              await h({ ...ctxOf(req, reply), actor });
              return reply;
            },
          });
        },
      };
      registerModules(router, deps);
    },
    { prefix: "/api/v1" },
  );

  return app;
}

function consoleMessages(config: Config): MessageSender {
  return {
    async send(msg) {
      const provider = msg.channel === "sms" ? config.smsProvider : config.emailProvider;
      if (provider !== "console") return false;
      if (config.env !== "test") {
        // Development only (refused in production by loadConfig).
        console.log(`[dev-${msg.channel}] to=${msg.recipient} template=${msg.template} ${JSON.stringify(msg.payload)}`);
      }
      return true;
    },
  };
}
