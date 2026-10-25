import type { Session, User } from "@/lib/api/contracts";
import type { DataMode } from "@/lib/config/env";

export type SignInResult =
  { status: "ok"; session: Session } | { status: "mfa_required"; challengeId: string };

export interface OtpChallenge {
  challengeId: string;
  expiresAt: string;
  /** Demo adapter only: the fixed demo code, shown on screen. Never present in api mode. */
  demoCode?: string;
}

/**
 * Authentication contract. The production implementation talks to the backend's
 * auth module (Sprint 2), which owns password hashing, OTP delivery, MFA, rate
 * limiting and httpOnly session cookies. The browser never stores credentials.
 */
export interface AuthAdapter {
  readonly mode: DataMode;
  getSession(): Promise<Session | null>;
  signInWithPassword(email: string, password: string): Promise<SignInResult>;
  verifyMfa(challengeId: string, code: string): Promise<Session>;
  requestPhoneOtp(phone: string): Promise<OtpChallenge>;
  /** Privileged roles get `mfa_required`: an OTP alone never satisfies MFA. */
  verifyPhoneOtp(challengeId: string, code: string): Promise<SignInResult>;
  /** Always resolves the same way whether or not the account exists (no enumeration). */
  requestPasswordReset(email: string): Promise<void>;
  signOut(): Promise<void>;
  /** Demo only. */
  demoPersonas?(): User[];
  switchPersona?(userId: string): Promise<Session>;
}
