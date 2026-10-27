import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Forwards /api/v1/* to the API with a signed client IP (x-zoii-client-ip), so the API can rate
 * limit and audit per real client instead of per Vercel egress address. The API verifies the
 * HMAC (backend/src/lib/client-ip.ts) and ignores the header without a valid signature.
 *
 * Off unless API_PROXY_ORIGIN is set (server-only env). Then the vercel.json rewrite for
 * /api/v1 is no longer needed. CLIENT_IP_SIGNING_SECRET must match the API's.
 *
 * The client address comes from x-real-ip / x-forwarded-for, which Vercel sets itself and
 * overwrites on every request. Self-hosted, put this behind a proxy that does the same.
 */
export const config = { matcher: "/api/v1/:path*" };

const HEADER = "x-zoii-client-ip";

function clientAddress(req: NextRequest): string | null {
  const candidates = [req.headers.get("x-real-ip"), req.headers.get("x-forwarded-for")?.split(",")[0]];
  for (const c of candidates) {
    const ip = c?.trim();
    if (ip && isIP(ip)) return ip;
  }
  return null;
}

export function proxy(req: NextRequest) {
  const origin = process.env.API_PROXY_ORIGIN;
  if (!origin) return NextResponse.next();
  const target = new URL(req.nextUrl.pathname + req.nextUrl.search, origin);
  const headers = new Headers(req.headers);
  headers.delete(HEADER); // never pass a client-supplied value through
  const secret = process.env.CLIENT_IP_SIGNING_SECRET;
  const ip = clientAddress(req);
  if (secret && ip) {
    const ts = Math.floor(Date.now() / 1000);
    headers.set(HEADER, `${ip};${ts};${createHmac("sha256", secret).update(`${ip}|${ts}`).digest("base64url")}`);
  }
  return NextResponse.rewrite(target, { request: { headers } });
}
