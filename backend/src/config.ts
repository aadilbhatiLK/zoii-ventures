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
  trustProxy: boolean;
  workerIntervalMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const mode = (env.NODE_ENV === "production" ? "production" : env.NODE_ENV === "test" ? "test" : "development") as Config["env"];
  const prod = mode === "production";
  const errors: string[] = [];

  const databaseUrl = env.DATABASE_URL?.trim() || null;
  if (prod && !databaseUrl) errors.push("DATABASE_URL is required in production.");

  let key: Buffer;
  if (env.DATA_ENCRYPTION_KEY) {
    key = Buffer.from(env.DATA_ENCRYPTION_KEY, "base64");
    if (key.length !== 32) errors.push("DATA_ENCRYPTION_KEY must be 32 bytes, base64-encoded.");
  } else if (prod) {
    errors.push("DATA_ENCRYPTION_KEY is required in production.");
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

  if (errors.length) throw new Error(`Invalid backend configuration:\n - ${errors.join("\n - ")}`);

  return {
    env: mode,
    port: Number(env.PORT ?? 4000),
    host: env.HOST ?? (prod ? "0.0.0.0" : "127.0.0.1"),
    databaseUrl,
    pgliteDir: env.PGLITE_DIR ?? ".data/pglite",
    databaseSsl: env.DATABASE_SSL === "true",
    corsOrigins,
    cookieSecure: prod || env.COOKIE_SECURE === "true",
    cookieDomain: env.COOKIE_DOMAIN || undefined,
    sessionHours: Number(env.SESSION_HOURS ?? 8),
    dataEncryptionKey: key,
    devStaticCodes,
    smsProvider,
    emailProvider,
    appBaseUrl: env.APP_BASE_URL ?? "http://localhost:3000",
    trustProxy: env.TRUST_PROXY === "true",
    workerIntervalMs: Number(env.WORKER_INTERVAL_MS ?? 60_000),
  };
}
