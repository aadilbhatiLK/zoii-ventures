"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getRuntime } from "@/lib/api";
import type { Session, User } from "@/lib/api/contracts";
import type { OtpChallenge, SignInResult } from "@/lib/auth/adapter";
import { can as canFn, type Permission } from "@/lib/permissions";

type Status = "loading" | "authenticated" | "unauthenticated";

interface AuthContextValue {
  status: Status;
  session: Session | null;
  user: User | null;
  signInWithPassword(email: string, password: string): Promise<SignInResult>;
  verifyMfa(challengeId: string, code: string): Promise<void>;
  requestPhoneOtp(phone: string): Promise<OtpChallenge>;
  verifyPhoneOtp(challengeId: string, code: string): Promise<SignInResult>;
  requestPasswordReset(email: string): Promise<void>;
  signOut(reason?: "expired" | "user"): Promise<void>;
  switchPersona?: (userId: string) => Promise<void>;
  personas?: User[];
  can(permission: Permission): boolean;
  lastSignOutReason: "expired" | "user" | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const runtime = getRuntime();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [lastSignOutReason, setReason] = useState<"expired" | "user" | null>(null);
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const apply = useCallback(
    (s: Session | null) => {
      runtime.setPrincipal(s?.user ?? null);
      setSession(s);
      setStatus(s ? "authenticated" : "unauthenticated");
    },
    [runtime],
  );

  const signOut = useCallback(
    async (reason: "expired" | "user" = "user") => {
      try {
        await runtime.auth.signOut();
      } finally {
        queryClient.clear();
        setReason(reason);
        apply(null);
      }
    },
    [runtime, queryClient, apply],
  );

  useEffect(() => {
    let alive = true;
    runtime.auth
      .getSession()
      .then((s) => alive && apply(s))
      .catch(() => alive && apply(null));
    return () => {
      alive = false;
    };
  }, [runtime, apply]);

  // Sign out at session expiry so stale sessions never keep showing data.
  useEffect(() => {
    if (expiryTimer.current) clearTimeout(expiryTimer.current);
    if (!session) return;
    const ms = Date.parse(session.expiresAt) - Date.now();
    expiryTimer.current = setTimeout(
      () => void signOut("expired"),
      Math.max(0, Math.min(ms, 2_147_000_000)),
    );
    return () => {
      if (expiryTimer.current) clearTimeout(expiryTimer.current);
    };
  }, [session, signOut]);

  const value = useMemo<AuthContextValue>(() => {
    const user = session?.user ?? null;
    const start = (s: Session) => {
      queryClient.clear();
      setReason(null);
      apply(s);
    };
    return {
      status,
      session,
      user,
      lastSignOutReason,
      async signInWithPassword(email, password) {
        const result = await runtime.auth.signInWithPassword(email, password);
        if (result.status === "ok") start(result.session);
        return result;
      },
      async verifyMfa(challengeId, code) {
        start(await runtime.auth.verifyMfa(challengeId, code));
      },
      requestPhoneOtp: (phone) => runtime.auth.requestPhoneOtp(phone),
      async verifyPhoneOtp(challengeId, code) {
        const result = await runtime.auth.verifyPhoneOtp(challengeId, code);
        if (result.status === "ok") start(result.session);
        return result;
      },
      requestPasswordReset: (email) => runtime.auth.requestPasswordReset(email),
      signOut,
      personas: runtime.auth.demoPersonas?.(),
      switchPersona: runtime.auth.switchPersona
        ? async (userId: string) => {
            start(await runtime.auth.switchPersona!(userId));
          }
        : undefined,
      can: (permission) => canFn(user, permission),
    };
  }, [status, session, lastSignOutReason, runtime, queryClient, apply, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

/** Hides children unless the user has the permission. UI only — the API enforces too. */
export function Can({
  permission,
  children,
  fallback = null,
}: {
  permission: Permission | Permission[];
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { can } = useAuth();
  const ok = Array.isArray(permission) ? permission.some(can) : can(permission);
  return <>{ok ? children : fallback}</>;
}
