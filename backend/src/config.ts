import { isIP } from "node:net";

/**
 * Backend configuration. Secrets come only from the environment (never from NEXT_PUBLIC_*).
 * Unsafe combinations are refused at startup rather than degraded silently.
 */
export interface Config {
  env: "development" | "test" | "production";
  port: number;
  host: string;
  databaseUrl: string | null;
  /** PGlite data directory when DATABASE_URL is unset (dev only). "memory" = in-memory. */
  pgliteDir: string;
  databaseSsl: boolean;
  corsOrigins: string[];
  cookieSecure: boolean;
  cookieDomain: string | undefined;
  sessionHours: number;
  /** 32-byte key (base64) for encrypting TOTP secrets and bank details at rest. */
  dataEncryptionKey: Buffer;
  /** Dev/test only: accept 000000 for OTP and MFA so seeded demo accounts can sign in. */
  devStaticCodes: boolean;
  smsProvider: "console" | "none";
  emailProvider: "console" | "none";
  appBaseUrl: string;
  /**
   * Which proxies may set X-Forwarded-For: false (none) or comma-separated addresses/CIDRs
   * (Fastify trustProxy). `true` trusts any sender and is refused in production.
   */
  trustProxy: boolean | string;
  /** Shared with the web tier's proxy: verifies the signed client-IP header (lib/client-ip.ts). */
  clientIpSecret: string | null;
  workerIntervalMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const errors: string[] = [];
  // Every production safeguard keys off NODE_ENV, so a typo ("prod") must not quietly mean development.
  const nodeEnv = env.NODE_ENV?.trim() || "development";
  if (!["development", "test", "production"].includes(nodeEnv)) errors.push(`NODE_ENV must be development, test or production (got "${nodeEnv}").`);
  const mode = (nodeEnv === "production" ? "production" : nodeEnv === "test" ? "test" : "development") as Config["env"];
  const prod = mode === "production";

  const databaseUrl = env.DATABASE_URL?.trim() || null;
  if (prod && !databaseUrl) errors.push("DATABASE_URL is required in production.");

  let key: Buffer;
  if (env.DATA_ENCRYPTION_KEY) {
    key = Buffer.from(env.DATA_ENCRYPTION_KEY, "base64");
    if (key.length !== 32) errors.push("DATA_ENCRYPTION_KEY must be 32 bytes, base64-encoded.");
  } else if (prod || databaseUrl) {
    // The built-in key is public; data in a real Postgres must never be encrypted with it.
    errors.push(prod ? "DATA_ENCRYPTION_KEY is required in production." : "DATA_ENCRYPTION_KEY is required when DATABASE_URL is set (the built-in key is for embedded PGlite only).");
    key = Buffer.alloc(32);
  } else {
    // Fixed, clearly-non-secret development key so dev data survives restarts.
    key = Buffer.from("zoii-dev-only-key-not-for-production!!".slice(0, 32));
  }

  const devStaticCodes = env.AUTH_DEV_STATIC_CODES === "true";
  if (prod && devStaticCodes) errors.push("AUTH_DEV_STATIC_CODES must not be enabled in production.");

  const corsOrigins = (env.CORS_ORIGINS ?? (prod ? "" : "http://localhost:3000"))
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (prod && corsOrigins.length === 0) errors.push("CORS_ORIGINS is required in production.");
  if (prod && corsOrigins.some((o) => !o.startsWith("https://"))) errors.push("CORS_ORIGINS must be https in production.");

  const smsProvider = (env.SMS_PROVIDER ?? (prod ? "none" : "console")) as Config["smsProvider"];
  const emailProvider = (env.EMAIL_PROVIDER ?? (prod ? "none" : "console")) as Config["emailProvider"];
  if (prod && (smsProvider === "console" || emailProvider === "console"))
    errors.push("Console message providers are for development only.");

  const appBaseUrl = env.APP_BASE_URL?.trim() || (prod ? "" : "http://localhost:3000");
  if (prod && !appBaseUrl.startsWith("https://")) errors.push("APP_BASE_URL is required in production and must be https (reset and invite links use it).");
  if (prod && env.COOKIE_SECURE === "false") errors.push("COOKIE_SECURE=false is not allowed in production; remove it.");
  if (prod && env.SEED_DEMO === "true") errors.push("SEED_DEMO must not be enabled in production.");

  const trustProxy = parseTrustProxy(env.TRUST_PROXY, prod, errors);
  const clientIpSecret = env.CLIENT_IP_SIGNING_SECRET?.trim() || null;
  if (clientIpSecret && clientIpSecret.length < 32) errors.push("CLIENT_IP_SIGNING_SECRET must be at least 32 characters.");
  const port = intIn(env.PORT, 4000, 1, 65_535, "PORT", errors);
  const sessionHours = intIn(env.SESSION_HOURS, 8, 1, 72, "SESSION_HOURS", errors);
  const workerIntervalMs = intIn(env.WORKER_INTERVAL_MS, 60_000, 1_000, 86_400_000, "WORKER_INTERVAL_MS", errors);

  if (errors.length) throw new Error(`Invalid backend configuration:\n - ${errors.join("\n - ")}`);

  return {
    env: mode,
    port,
    host: env.HOST ?? (prod ? "0.0.0.0" : "127.0.0.1"),
    databaseUrl,
    pgliteDir: env.PGLITE_DIR ?? ".data/pglite",
    databaseSsl: env.DATABASE_SSL === "true",
    corsOrigins,
    cookieSecure: prod || env.COOKIE_SECURE === "true",
    cookieDomain: env.COOKIE_DOMAIN || undefined,
    sessionHours,
    dataEncryptionKey: key,
    devStaticCodes,
    smsProvider,
    emailProvider,
    appBaseUrl,
    trustProxy,
    clientIpSecret,
    workerIntervalMs,
  };
}

function intIn(raw: string | undefined, fallback: number, min: number, max: number, name: string, errors: string[]) {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) errors.push(`${name} must be a whole number from ${min} to ${max}.`);
  return n;
}

const PROXY_KEYWORDS = new Set(["loopback", "linklocal", "uniquelocal"]);

/**
 * Behind nginx on the same host, use TRUST_PROXY=127.0.0.1: the client address is then the
 * entry nginx appended to X-Forwarded-For, and anything a client wrote before it is ignored.
 */
function parseTrustProxy(raw: string | undefined, prod: boolean, errors: string[]): Config["trustProxy"] {
  const v = raw?.trim() ?? "";
  if (v === "" || v === "false") return false;
  if (v === "true") {
    if (prod) errors.push("TRUST_PROXY=true trusts X-Forwarded-For from anyone, so clients can spoof their IP. Set the proxy address instead, e.g. TRUST_PROXY=127.0.0.1.");
    return true;
  }
  const parts = v.split(",").map((p) => p.trim()).filter(Boolean);
  const ok = (p: string) => {
    if (PROXY_KEYWORDS.has(p)) return true;
    const [addr, bits, extra] = p.split("/");
    if (extra !== undefined || !isIP(addr)) return false;
    if (bits === undefined) return true;
    const max = isIP(addr) === 4 ? 32 : 128;
    return /^\d+$/.test(bits) && Number(bits) <= max;
  };
  const bad = parts.filter((p) => !ok(p));
  if (!parts.length || bad.length) errors.push(`TRUST_PROXY must be false or the proxy addresses/CIDRs (bad: ${bad.join(", ") || "empty"}).`);
  return parts.join(",");
}
