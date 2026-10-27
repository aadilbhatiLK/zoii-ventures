import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { FastifyRequest } from "fastify";
import type { Config } from "../config";

/**
 * The web tier (src/proxy.ts on Vercel) forwards /api/v1 calls and adds
 * `x-zoii-client-ip: <ip>;<unix seconds>;<base64url HMAC-SHA256(secret, "ip|ts")>`.
 * nginx only ever sees Vercel's address, so this signed value is how the API learns the
 * real client IP for rate limits and audit logs. Without a valid signature it falls back
 * to the socket / trusted-proxy address (req.ip), which can't be spoofed either.
 */
export const CLIENT_IP_HEADER = "x-zoii-client-ip";
const MAX_SKEW_S = 120;

export function signClientIp(secret: string, ip: string, nowS = Math.floor(Date.now() / 1000)) {
  return `${ip};${nowS};${createHmac("sha256", secret).update(`${ip}|${nowS}`).digest("base64url")}`;
}

export function verifyClientIp(secret: string, header: string, nowS: number): string | null {
  const [ip, ts, sig, extra] = header.split(";");
  if (extra !== undefined || !ip || !ts || !sig || !isIP(ip) || !/^\d{1,12}$/.test(ts)) return null;
  if (Math.abs(nowS - Number(ts)) > MAX_SKEW_S) return null;
  const want = createHmac("sha256", secret).update(`${ip}|${ts}`).digest();
  const got = Buffer.from(sig, "base64url");
  return got.length === want.length && timingSafeEqual(got, want) ? ip : null;
}

const cache = new WeakMap<FastifyRequest, string>();

export function clientIp(req: FastifyRequest, config: Pick<Config, "clientIpSecret">, now: () => Date): string {
  const hit = cache.get(req);
  if (hit) return hit;
  const raw = req.headers[CLIENT_IP_HEADER];
  const signed = config.clientIpSecret && typeof raw === "string" ? verifyClientIp(config.clientIpSecret, raw, Math.floor(now().getTime() / 1000)) : null;
  const ip = signed ?? req.ip;
  cache.set(req, ip);
  return ip;
}
