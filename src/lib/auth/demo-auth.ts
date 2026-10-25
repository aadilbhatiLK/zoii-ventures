import type { Session, User } from "@/lib/api/contracts";
import { ApiError } from "@/lib/api/errors";
import { DEMO_OTP, DEMO_PASSWORD, DEMO_USERS } from "@/lib/mock/seed";
import type { AuthAdapter, OtpChallenge, SignInResult } from "./adapter";

const SESSION_KEY = "zoii.demo.session";
const SESSION_HOURS = 8;
const MAX_FAILURES = 5;
const WINDOW_MS = 10 * 60_000;

interface StoredSession {
  userId: string;
  issuedAt: string;
  expiresAt: string;
  mfaSatisfied: boolean;
}

interface Challenge {
  id: string;
  userId: string;
  kind: "otp" | "mfa";
  expiresAt: number;
  attempts: number;
  used: boolean;
}

/**
 * DEMO AUTHENTICATION — not a security boundary. It exists so screens and flows can
 * be exercised before the backend auth module exists. It mimics the production
 * behaviours the UI must handle: MFA for privileged users, single-use expiring OTPs,
 * attempt limits and non-enumerating password reset.
 */
export function createDemoAuthAdapter(
  opts: { now?: () => number; storage?: Storage | null } = {},
): AuthAdapter {
  const now = opts.now ?? (() => Date.now());
  const storage =
    opts.storage !== undefined
      ? opts.storage
      : typeof window !== "undefined"
        ? window.sessionStorage
        : null;
  const challenges = new Map<string, Challenge>();
  const failures: number[] = [];
  let memorySession: StoredSession | null = null;

  const read = (): StoredSession | null => {
    try {
      const raw = storage?.getItem(SESSION_KEY);
      return raw ? (JSON.parse(raw) as StoredSession) : memorySession;
    } catch {
      return memorySession;
    }
  };
  const write = (s: StoredSession | null) => {
    memorySession = s;
    try {
      if (s) storage?.setItem(SESSION_KEY, JSON.stringify(s));
      else storage?.removeItem(SESSION_KEY);
    } catch {
      /* in-memory fallback */
    }
  };
  const toSession = (s: StoredSession): Session | null => {
    const user = DEMO_USERS.find((u) => u.id === s.userId);
    if (!user) return null;
    return {
      user: { ...user },
      issuedAt: s.issuedAt,
      expiresAt: s.expiresAt,
      mfaSatisfied: s.mfaSatisfied,
    };
  };
  const start = (user: User, mfaSatisfied: boolean): Session => {
    const issued = now();
    const stored: StoredSession = {
      userId: user.id,
      issuedAt: new Date(issued).toISOString(),
      expiresAt: new Date(issued + SESSION_HOURS * 3_600_000).toISOString(),
      mfaSatisfied,
    };
    write(stored);
    return toSession(stored)!;
  };
  const guardRate = () => {
    const cutoff = now() - WINDOW_MS;
    while (failures.length && failures[0]! < cutoff) failures.shift();
    if (failures.length >= MAX_FAILURES) {
      throw new ApiError(
        { code: "RATE_LIMITED", message: "Too many attempts. Try again in a few minutes." },
        429,
      );
    }
  };
  const fail = (message: string): never => {
    failures.push(now());
    throw new ApiError({ code: "UNAUTHENTICATED", message }, 401);
  };
  const newChallenge = (userId: string, kind: Challenge["kind"]): Challenge => {
    const c: Challenge = {
      id: `${kind}_${Math.random().toString(36).slice(2)}`,
      userId,
      kind,
      expiresAt: now() + 5 * 60_000,
      attempts: 0,
      used: false,
    };
    challenges.set(c.id, c);
    return c;
  };
  const consume = (challengeId: string, kind: Challenge["kind"], code: string): User => {
    guardRate();
    const c = challenges.get(challengeId);
    if (!c || c.kind !== kind || c.used || c.expiresAt < now()) {
      throw new ApiError(
        { code: "UNAUTHENTICATED", message: "This code has expired. Request a new one." },
        401,
      );
    }
    c.attempts++;
    if (c.attempts > 5) {
      c.used = true;
      throw new ApiError(
        { code: "RATE_LIMITED", message: "Too many incorrect codes. Request a new one." },
        429,
      );
    }
    if (code.trim() !== DEMO_OTP) fail("That code is incorrect.");
    c.used = true;
    return DEMO_USERS.find((u) => u.id === c.userId)!;
  };
  const isPrivileged = (u: User) =>
    u.roles.some(
      (r) =>
        r === "super_admin" ||
        r === "founder" ||
        r === "finance_manager" ||
        r === "hr_manager" ||
        r === "auditor",
    );

  return {
    mode: "demo",
    async getSession() {
      const s = read();
      if (!s) return null;
      if (Date.parse(s.expiresAt) <= now()) {
        write(null);
        return null;
      }
      return toSession(s);
    },
    async signInWithPassword(email, password): Promise<SignInResult> {
      guardRate();
      const user = DEMO_USERS.find((u) => u.email === email.trim().toLowerCase());
      if (!user || password !== DEMO_PASSWORD) return fail("Email or password is incorrect.");
      failures.length = 0;
      if (isPrivileged(user) && user.mfaEnrolled) {
        return { status: "mfa_required", challengeId: newChallenge(user.id, "mfa").id };
      }
      return { status: "ok", session: start(user, false) };
    },
    async verifyMfa(challengeId, code) {
      return start(consume(challengeId, "mfa", code), true);
    },
    async requestPhoneOtp(phone): Promise<OtpChallenge> {
      guardRate();
      const digits = phone.replace(/\D/g, "").slice(-10);
      const user = DEMO_USERS.find((u) => (u.phone ?? "").replace(/\D/g, "").slice(-10) === digits);
      // Same response whether or not the number exists; an unknown number simply never verifies.
      const c = newChallenge(user?.id ?? "__none__", "otp");
      return {
        challengeId: c.id,
        expiresAt: new Date(c.expiresAt).toISOString(),
        demoCode: DEMO_OTP,
      };
    },
    async verifyPhoneOtp(challengeId, code) {
      const c = challenges.get(challengeId);
      if (c?.userId === "__none__") return fail("That code is incorrect.");
      const user = consume(challengeId, "otp", code);
      return start(user, false);
    },
    async requestPasswordReset() {
      guardRate();
    },
    async signOut() {
      write(null);
    },
    demoPersonas: () => DEMO_USERS.map((u) => ({ ...u })),
    async switchPersona(userId) {
      const user = DEMO_USERS.find((u) => u.id === userId);
      if (!user) throw new ApiError({ code: "NOT_FOUND", message: "Unknown persona." }, 404);
      return start(user, true);
    },
  };
}
