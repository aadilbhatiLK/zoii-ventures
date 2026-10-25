import { z } from "zod";
import type { FastifyReply } from "fastify";
import { SESSION_COOKIE, type Router } from "../../app";
import type { Deps } from "../../lib/context";
import { parse } from "../../lib/errors";
import { getUserRow, toUser } from "../users/repo";
import { AuthService, type SignInResult } from "./service";

const authLimit = { max: 30, timeWindow: "1 minute" };

export function authRoutes(r: Router, deps: Deps) {
  const svc = new AuthService(deps);
  const meta = (c: { req: { ip: string; headers: Record<string, unknown> } }) => ({ ip: c.req.ip ?? null, userAgent: String(c.req.headers["user-agent"] ?? "") });
  const setCookie = (reply: FastifyReply, token: string) =>
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true, secure: deps.config.cookieSecure, sameSite: "lax", path: "/",
      domain: deps.config.cookieDomain, maxAge: deps.config.sessionHours * 3600,
    });
  const out = (reply: FastifyReply, res: SignInResult) => {
    if (res.status === "ok") {
      setCookie(reply, res.token);
      return { status: "ok", session: res.session };
    }
    return res;
  };

  r.get("/auth/session", async ({ actor }) => {
    const row = await deps.db.query<{ created_at: Date; expires_at: Date; mfa_satisfied: boolean }>(
      `SELECT created_at, expires_at, mfa_satisfied FROM sessions WHERE id = $1`, [actor.sessionId],
    );
    const user = await getUserRow(deps.db, actor.userId);
    const s = row.rows[0];
    return { user: toUser(user!), issuedAt: new Date(s.created_at).toISOString(), expiresAt: new Date(s.expires_at).toISOString(), mfaSatisfied: s.mfa_satisfied };
  });

  r.public.post("/auth/login", async (c) => {
    const b = parse(z.object({ email: z.string().trim().min(3).max(200), password: z.string().min(1).max(200) }), c.body);
    return out(c.reply, await svc.login(b.email, b.password, meta(c)));
  }, { rateLimit: authLimit });

  r.public.post("/auth/mfa/verify", async (c) => {
    const b = parse(z.object({ challengeId: z.string().max(64), code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code") }), c.body);
    const { token, session } = await svc.verifyMfa(b.challengeId, b.code, meta(c));
    setCookie(c.reply, token);
    return session;
  }, { rateLimit: authLimit });

  r.public.post("/auth/otp/request", async (c) => {
    const b = parse(z.object({ phone: z.string().trim().min(8).max(20) }), c.body);
    return svc.requestOtp(b.phone, meta(c));
  }, { rateLimit: { max: 10, timeWindow: "1 minute" } });

  r.public.post("/auth/otp/verify", async (c) => {
    const b = parse(z.object({ challengeId: z.string().max(64), code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code") }), c.body);
    return out(c.reply, await svc.verifyOtp(b.challengeId, b.code, meta(c)));
  }, { rateLimit: authLimit });

  r.public.post("/auth/password/forgot", async (c) => {
    const b = parse(z.object({ email: z.string().trim().max(200) }), c.body);
    await svc.forgotPassword(b.email, meta(c)).catch((e) => {
      // Rate limiting is the only error surfaced; everything else looks identical (no enumeration).
      if ((e as { code?: string }).code === "RATE_LIMITED") throw e;
    });
    return undefined;
  }, { rateLimit: { max: 10, timeWindow: "1 minute" } });

  r.public.post("/auth/password/reset", async (c) => {
    const b = parse(z.object({ token: z.string().min(20).max(200), password: z.string().max(200) }), c.body);
    await svc.resetPassword(b.token, b.password);
    return undefined;
  }, { rateLimit: authLimit });

  r.post("/auth/password/change", async ({ actor, body }) => {
    const b = parse(z.object({ currentPassword: z.string().max(200), newPassword: z.string().max(200) }), body);
    await svc.changePassword(actor.userId, b.currentPassword, b.newPassword, actor.sessionId);
    return undefined;
  });

  // Public so an expired session can still clear its cookie.
  r.public.post("/auth/logout", async ({ req, reply }) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await svc.logoutToken(token);
    reply.clearCookie(SESSION_COOKIE, { path: "/", domain: deps.config.cookieDomain });
    return undefined;
  });
}
